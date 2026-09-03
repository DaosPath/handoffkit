import { randomUUID } from "node:crypto";

const SECURE_ARGS = Object.freeze([
  "--disable-quic",
  "--disable-features=WebRTC,ServiceWorker,InterestGroupStorage,InterestCohortAPI",
  "--disable-sync",
  "--disable-background-networking",
]);

function nodeMajor() {
  return Number.parseInt(String(process.versions.node).split(".")[0], 10);
}

export class ChromiumSupervisor {
  constructor({ engine = null, executablePath = "" } = {}) {
    this.engineOverride = engine;
    this.executablePath = executablePath;
    this.sharedBrowser = null;
    this.sharedServer = null;
    this.pid = null;
    this.ownedPids = new Set();
  }

  async attachPlaywright() {
    if (this.engineOverride) return null;
    if (nodeMajor() < 24) {
      const { BrowserCoreError } = await import("@handoffkit/browser-core");
      throw new BrowserCoreError("Browser Real requires Node.js 24+", { code: "engine_unsupported" });
    }
    try {
      return await import("playwright");
    } catch {
      const { BrowserCoreError } = await import("@handoffkit/browser-core");
      throw new BrowserCoreError("Playwright/Chromium is not installed. Run install-chromium explicitly.", {
        code: "engine_unsupported",
      });
    }
  }

  async launch({ headless = true, userDataDir = "", persistent = false, proxy = null } = {}) {
    if (this.engineOverride?.launch) {
      const handle = await this.engineOverride.launch({ headless, userDataDir, persistent, proxy });
      const page = handle.page;
      const pageId = randomUUID();
      return {
        browser: handle.browser ?? null,
        server: handle.server ?? null,
        context: handle.context ?? null,
        page,
        pages: new Map(page ? [[pageId, page]] : []),
        activePageId: page ? pageId : "",
        pid: handle.pid ?? null,
        created: Boolean(handle.browser || handle.close),
        async close() {
          await handle.close?.();
        },
      };
    }
    const playwright = await this.attachPlaywright();
    const launchOptions = {
      headless: headless !== false,
      args: [...SECURE_ARGS],
    };
    if (this.executablePath) launchOptions.executablePath = this.executablePath;
    if (persistent && userDataDir) {
      const context = await playwright.chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        proxy: proxy || undefined,
        serviceWorkers: "block",
      });
      const browser = context.browser();
      const pid = browser?.process?.()?.pid ?? null;
      if (pid) this.ownedPids.add(pid);
      const page = context.pages()[0] || await context.newPage();
      const pageId = randomUUID();
      return {
        browser,
        context,
        page,
        pages: new Map([[pageId, page]]),
        activePageId: pageId,
        pid,
        created: true,
        async close() {
          await context.close();
        },
      };
    }
    if (this.sharedBrowser && !this.isSharedBrowserAlive()) {
      await this.invalidateAfterCrash();
    }
    if (!this.sharedBrowser) {
      // BrowserServer exposes the owned Chromium process on platforms where
      // Browser.process() is intentionally unavailable. Keeping the server
      // handle lets the service detect and recover from a real process exit.
      this.sharedServer = await playwright.chromium.launchServer(launchOptions);
      this.sharedBrowser = await playwright.chromium.connect({
        wsEndpoint: this.sharedServer.wsEndpoint(),
      });
      this.pid = this.sharedServer.process?.()?.pid ?? null;
      if (this.pid) this.ownedPids.add(this.pid);
    }
    const context = await this.sharedBrowser.newContext({
      proxy: proxy || undefined,
      serviceWorkers: "block",
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();
    const pageId = randomUUID();
    const browser = this.sharedBrowser;
    return {
      browser,
      server: this.sharedServer,
      context,
      page,
      pages: new Map([[pageId, page]]),
      activePageId: pageId,
      pid: this.pid,
      created: true,
      async close() {
        await context.close();
      },
    };
  }

  isSharedBrowserAlive() {
    if (!this.sharedBrowser) return false;
    if (typeof this.sharedBrowser.isConnected === "function" && !this.sharedBrowser.isConnected()) {
      return false;
    }
    if (this.pid) {
      try {
        process.kill(this.pid, 0);
      } catch {
        return false;
      }
    }
    return true;
  }

  async invalidateAfterCrash() {
    const browser = this.sharedBrowser;
    const server = this.sharedServer;
    this.sharedBrowser = null;
    this.sharedServer = null;
    this.pid = null;
    let timer;
    try {
      await Promise.race([
        (async () => {
          try { await browser?.close?.(); } catch { /* disconnected browser */ }
          try { await server?.close?.(); } catch { /* already-exited process */ }
        })(),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 1000);
          timer.unref?.();
        }),
      ]);
    } catch {
      // A crashed browser is already unusable; the next launch starts clean.
    } finally {
      clearTimeout(timer);
    }
  }

  async closeOwned() {
    if (this.sharedBrowser) {
      await this.sharedBrowser.close().catch(() => {});
      this.sharedBrowser = null;
    }
    if (this.sharedServer) {
      await this.sharedServer.close().catch(() => {});
      this.sharedServer = null;
    }
    this.ownedPids.clear();
    this.pid = null;
  }
}
