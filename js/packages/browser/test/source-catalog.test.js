import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { makeFixtureMapTransport, ProjectWebIndex, SourceCatalog, webSearch } from "../src/index.js";

async function rmRoot(root) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== "EBUSY" || attempt === 4) {
        if (error?.code === "EBUSY") console.warn(`cleanup skipped (locked): ${root}`);
        else throw error;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "hk-catalog-"));
  const index = new ProjectWebIndex({ root, enabled: true });
  await index.open();
  await index.ingest({ url: "https://docs.example.test/a", title: "Alpha", markdown: "alpha widgets guide" });
  await index.ingest({ url: "https://blog.example.test/b", title: "Beta", markdown: "beta widgets widgets widgets" });
  const catalog = new SourceCatalog(root);
  await catalog.load();
  await catalog.add({ url: "https://docs.example.test/a", category: "docs", weight: 5 });
  await catalog.add({ url: "https://blog.example.test/b", category: "blog", weight: 1 });
  return { root, index, catalog };
}

test("catalog add/list/weigh/remove round-trips", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hk-catalog-"));
  try {
    const catalog = new SourceCatalog(root);
    await catalog.load();
    assert.deepEqual(await catalog.list(), []);
    await catalog.add({ url: "https://docs.example.test/a", category: "docs", weight: 2 });
    assert.equal((await catalog.list())[0].weight, 2);
    assert.equal((await catalog.list({ category: "docs" })).length, 1);
    assert.equal(await catalog.setWeight("https://docs.example.test/a", 7), true);
    assert.equal((await catalog.list())[0].weight, 7);
    assert.equal(await catalog.remove("https://docs.example.test/a"), true);
    assert.deepEqual(await catalog.list(), []);
    const reloaded = await new SourceCatalog(root).load();
    assert.deepEqual(await reloaded.list(), []);
  } finally {
    await rmRoot(root);
  }
});

test("catalog search prefers higher weights", async () => {
  const { root, index, catalog } = await setup();
  try {
    const found = await catalog.search(index, "widgets");
    assert.equal(found.hits[0].url, "https://docs.example.test/a");
    assert.equal(found.hits[0].weight, 5);
    const scoped = await catalog.search(index, "widgets", { category: "blog" });
    assert.deepEqual(scoped.hits.map((hit) => hit.url), ["https://blog.example.test/b"]);
    const empty = await new SourceCatalog(root).load();
    await empty.remove("https://docs.example.test/a");
    await empty.remove("https://blog.example.test/b");
    const missing = await empty.search(index, "widgets");
    assert.equal(missing.error_code, "catalog_empty");
    await index.close();
  } finally {
    await rmRoot(root);
  }
});

test("webSearch catalog provider uses weighted sources fail-closed", async () => {
  const { root, index, catalog } = await setup();
  const transport = makeFixtureMapTransport();
  try {
    const result = await webSearch("widgets", {
      transport,
      providers: ["catalog"],
      catalog: { index, catalog },
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.providers_used, ["catalog"]);
    assert.equal(result.results[0].url, "https://docs.example.test/a");
    const missing = await webSearch("widgets", { transport, providers: ["catalog"] });
    assert.equal(missing.success, false);
    const trace = missing.provider_trace.find((t) => t.provider === "catalog");
    assert.equal(trace.error_code, "catalog_not_configured");
    await index.close();
  } finally {
    await rmRoot(root);
  }
});
