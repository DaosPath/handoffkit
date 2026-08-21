#!/usr/bin/env node
/**
 * Lite extract/index microbench. Archives numbers only; not a 9/10 soak.
 * Usage: node scripts/js/browser-lite-bench.mjs
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { htmlToMarkdown, ProjectWebIndex } from "../../packages/js/browser/src/index.js";

const html = `<html><head><title>Bench</title>
<meta charset="utf-8">
<script type="application/ld+json">{"@type":"Article","name":"Bench"}</script>
</head><body>
<main>
<h1>Heading</h1>
<p>Evidence paragraph about widgets and grounding.</p>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<ul><li>One</li><li>Two</li></ul>
<pre><code>const x = 1;</code></pre>
</main>
</body></html>`;

function timed(fn) {
  const started = process.hrtime.bigint();
  const value = fn();
  const elapsedNs = Number(process.hrtime.bigint() - started);
  return { value, elapsed_ms: elapsedNs / 1e6 };
}

const extract = timed(() => htmlToMarkdown(html, { baseUrl: "https://example.org/bench" }));
const root = await mkdtemp(path.join(tmpdir(), "handoffkit-index-bench-"));
const index = new ProjectWebIndex({ root, enabled: true });
await index.open();
const ingestStarted = process.hrtime.bigint();
const ingested = await index.ingest({
  url: "https://example.org/bench",
  title: "Bench",
  markdown: extract.value,
});
const ingestMs = Number(process.hrtime.bigint() - ingestStarted) / 1e6;
const queryStarted = process.hrtime.bigint();
const found = await index.search("widgets");
const queryMs = Number(process.hrtime.bigint() - queryStarted) / 1e6;
await index.close();
await rm(root, { recursive: true, force: true });

const report = {
  generated_at: new Date().toISOString(),
  product: "lite",
  notice: "Lite microbench only. Browser Real navigation p50/p95/p99 is not claimed.",
  extract_markdown_ms: Number(extract.elapsed_ms.toFixed(3)),
  index_ingest_ms: Number(ingestMs.toFixed(3)),
  index_query_ms: Number(queryMs.toFixed(3)),
  index_hits: found.hits?.length ?? 0,
  ingest_ok: ingested?.ok === true,
};

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "reports",
  "BROWSER_1.20_LITE_BENCH_20260813.json",
);
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
