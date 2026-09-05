import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { HANDOFFKIT_BROWSER_VERSION, PLATFORM_SEARCH_PROVIDERS } from "../src/index.js";

test("lite re-exports the compatibility facade without Browser Real", async () => {
  assert.equal(HANDOFFKIT_BROWSER_VERSION, "1.20.0-alpha.2");
  assert.ok(PLATFORM_SEARCH_PROVIDERS.includes("google_browser"));
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /browser-real/);
});
