#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
let playwrightCli;
try {
  playwrightCli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
} catch {
  console.error("Playwright is not installed. Add it explicitly, then rerun install-chromium.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [playwrightCli, "install", "chromium"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
