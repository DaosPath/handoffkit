import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { HANDOFFKIT_BROWSER_VERSION, PLATFORM_SEARCH_PROVIDERS } from "../src/index.js";
import { CONTRACT_VERSION } from "../src/core/index.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

async function sourceFiles(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(child)));
    else if (/\.(?:js|mjs|cjs|d\.ts)$/.test(entry.name)) out.push(child);
  }
  return out;
}

test("@handoffkit/browser (Lite) and @handoffkit/browser/core never import Browser Real", async () => {
  assert.equal(HANDOFFKIT_BROWSER_VERSION, "1.20.0");
  assert.equal(CONTRACT_VERSION, "1.20.0");
  assert.ok(PLATFORM_SEARCH_PROVIDERS.includes("google_browser"));
  const files = await sourceFiles(join(packageRoot, "src"));
  assert.ok(files.some((file) => file.endsWith(join("core", "index.js"))));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /@handoffkit\/browser-real|playwright/, `${file} must not reference Browser Real`);
  }
});

test("package manifest keeps Lite and Core free of Browser Real dependencies", async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const dependencyNames = Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });
  assert.ok(!dependencyNames.includes("@handoffkit/browser-real"));
  assert.ok(!dependencyNames.includes("playwright"));
  assert.deepEqual(Object.keys(manifest.exports), [".", "./core"]);
});
