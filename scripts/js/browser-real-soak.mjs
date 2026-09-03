#!/usr/bin/env node
/**
 * Browser Real soak harness.
 *
 * Default target: 4 hours and 1000 navigations against a local HTTP fixture.
 * Always writes JSON. Never treats skip as pass: missing Chromium or an
 * incomplete run exits 1 with status placeholder/unavailable/fail.
 *
 *   HANDOFFKIT_BROWSER_REAL_SOAK=1 node scripts/js/browser-real-soak.mjs
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserRealService } from "../../js/packages/browser-real/src/index.js";

const soakEnabled = process.env.HANDOFFKIT_BROWSER_REAL_SOAK === "1";
const navigationsTarget = Number(process.env.HANDOFFKIT_BROWSER_REAL_SOAK_NAVIGATIONS || 1000);
const soakMs = Number(process.env.HANDOFFKIT_BROWSER_REAL_SOAK_MS || 4 * 60 * 60 * 1000);
const outputPath = process.env.HANDOFFKIT_BROWSER_REAL_SOAK_OUTPUT || ".local-tests/browser-real-soak.json";
const started = Date.now();

function writeReport(report) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const body = {
    format: "handoffkit.browser.real.soak",
    format_version: 1,
    started_at: new Date(started).toISOString(),
    finished_at: new Date().toISOString(),
    elapsed_ms: Date.now() - started,
    navigations_target: navigationsTarget,
    soak_ms_target: soakMs,
    notice: "Environmental soak — not a performance guarantee. Windows ARM64 is not claimed.",
    ...report,
  };
  writeFileSync(outputPath, `${JSON.stringify(body, null, 2)}\n`);
  console.log(JSON.stringify(body));
  return body;
}

function fail(status, error, extra = {}) {
  const report = writeReport({
    status,
    navigations: extra.navigations ?? 0,
    orphans: extra.orphans ?? null,
    error: String(error?.message || error || status),
    ...extra,
  });
  process.exitCode = 1;
  return report;
}

if (!soakEnabled) {
  fail("placeholder", "HANDOFFKIT_BROWSER_REAL_SOAK is unset; soak is unavailable until a 4h/1000 run is archived");
  process.exit(1);
}

let playwright;
try {
  const require = createRequire(import.meta.url);
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "js", "packages", "browser-real");
  const resolved = require.resolve("playwright", { paths: [packageRoot] });
  const imported = await import(pathToFileURL(resolved).href);
  playwright = imported.default || imported;
} catch (error) {
  fail("unavailable", error, { reason: "playwright_missing" });
  process.exit(1);
}

const html = "<!doctype html><html><head><title>soak</title></head><body><main><p>soak</p></main></body></html>";
const httpServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${httpServer.address().port}`;

const service = new BrowserRealService({
  policy: { network: { allow_loopback: true } },
  engine: {
    async launch() {
      const browser = await playwright.chromium.launch({ headless: true });
      const page = await browser.newPage();
      return {
        browser,
        page,
        pid: browser.process?.()?.pid ?? null,
        async close() { await browser.close(); },
      };
    },
  },
});

let navigations = 0;
try {
  const session = await service.dispatch({
    command_id: "soak-start",
    session_id: "soak",
    name: "session.start",
    payload: {
      product: "real",
      session_id: "soak",
      policy: { network: { allow_loopback: true } },
    },
  });
  if (session.name !== "session.started") {
    throw new Error(`soak could not start a Browser Real session: ${session.name}`);
  }
  const deadline = started + soakMs;
  while (navigations < navigationsTarget || Date.now() < deadline) {
    if (Date.now() >= deadline && navigations < navigationsTarget) {
      throw new Error(`soak deadline reached after ${navigations}/${navigationsTarget} navigations`);
    }
    await service.dispatch({
      command_id: `soak-nav-${navigations}`,
      session_id: "soak",
      name: "navigate",
      payload: { url: origin },
    });
    navigations += 1;
  }
  const sessionState = service.sessions.get("soak");
  await sessionState?.handle?.close?.();
  await service.supervisor.closeOwned();
  const orphans = [...service.supervisor.ownedPids];
  httpServer.close();
  if (orphans.length) {
    fail("fail", `orphan pids remain: ${orphans.join(",")}`, { navigations, orphans });
    process.exit(1);
  }
  writeReport({ status: "pass", navigations, orphans: [] });
} catch (error) {
  try {
    await service.supervisor.closeOwned();
  } catch (closeError) {
    console.error(closeError);
  }
  httpServer.close();
  fail("fail", error, { navigations, orphans: [...service.supervisor.ownedPids] });
  process.exit(1);
}
