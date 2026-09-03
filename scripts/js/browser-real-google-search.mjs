#!/usr/bin/env node
/**
 * Explicit Google Browser Real probe.
 *
 * This is a headless, network-dependent measurement. A challenge, empty page,
 * or missing Chromium is recorded as unavailable and exits non-zero. No HTTP
 * or DuckDuckGo fallback is used.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BrowserRealClient,
  BrowserRealService,
  createGoogleBrowserSearch,
} from "../../js/packages/browser-real/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const query = String(process.env.HANDOFFKIT_GOOGLE_BROWSER_QUERY || "HandoffKit browser").trim();
const outputPath = path.resolve(
  root,
  process.env.HANDOFFKIT_GOOGLE_BROWSER_OUTPUT
    || path.join("reports", "BROWSER_1.20_GOOGLE_BROWSER_LIVE.json"),
);
const started = Date.now();

async function save(report) {
  const full = {
    format: "handoffkit.browser.1.20.google_browser_live",
    format_version: 1,
    generated_at: new Date().toISOString(),
    query,
    elapsed_ms: Date.now() - started,
    browser_headless: true,
    provider: "google_browser",
    fallback_used: false,
    ...report,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(full, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(full, null, 2));
  return full;
}

let playwright;
try {
  const require = createRequire(import.meta.url);
  const packageRoot = path.join(root, "packages", "js", "browser-real");
  const resolved = require.resolve("playwright", { paths: [packageRoot] });
  const imported = await import(pathToFileURL(resolved).href);
  playwright = imported.default || imported;
} catch (error) {
  await save({ status: "unavailable", code: "engine_unsupported", error: String(error?.message || error) });
  process.exit(1);
}

let browser;
const service = new BrowserRealService({
  policy: { network: { allow_public: true, allow_loopback: false, allow_private: false } },
  engine: {
    async launch() {
      browser = await playwright.chromium.launch({ headless: true });
      const page = await browser.newPage();
      return {
        browser,
        page,
        pid: browser.process?.()?.pid ?? null,
        async close() { await browser?.close(); },
      };
    },
  },
});

try {
  const sessionId = "google-browser-live";
  const startedEvent = await service.dispatch({
    command_id: "google-browser-live-start",
    session_id: sessionId,
    name: "session.start",
    payload: {
      product: "real",
      session_id: sessionId,
      policy: { network: { allow_public: true, allow_loopback: false, allow_private: false } },
    },
  });
  if (startedEvent.name !== "session.started") {
    throw new Error(`session.start returned ${startedEvent.name}`);
  }
  const search = createGoogleBrowserSearch(new BrowserRealClient(service));
  const result = await search(query, { session_id: sessionId, maxResults: 8 });
  const hits = Array.isArray(result.hits) ? result.hits : [];
  if (result.error_code) {
    await save({
      status: result.error_code === "provider_challenge" ? "provider_challenge" : "unavailable",
      code: result.error_code,
      error: result.error || "Google Browser provider did not return results",
      hits,
    });
    process.exitCode = 1;
  } else if (!hits.length) {
    await save({ status: "unavailable", code: "no_results", error: "Google returned no organic results", hits });
    process.exitCode = 1;
  } else {
    await save({
      status: "pass",
      code: "",
      hits,
      organic_results: hits.length,
      notice: "Environmental live measurement only; Google availability and challenge state vary by runner.",
    });
  }
} catch (error) {
  await save({ status: "unavailable", code: String(error?.code || "provider_unavailable"), error: String(error?.message || error), hits: [] });
  process.exitCode = 1;
} finally {
  try {
    await service.dispatch({
      command_id: "google-browser-live-close",
      session_id: "google-browser-live",
      name: "session.close",
      payload: {},
    });
  } catch { /* best effort cleanup */ }
  await service.supervisor.closeOwned().catch(() => {});
  try {
    await browser?.close?.();
  } catch { /* best effort cleanup */ }
}
