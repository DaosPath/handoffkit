import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  Agent,
  ContextRetriever,
  FileTraceStore,
  ProjectIndexer,
  RunTrace,
  Team,
  buildNodeContractParityReport,
  loadReportJSON,
  writeReportFiles,
  JsonMemoryStore,
} from "../src/index.js";

test("node package writes traces and reports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-node-"));
  const team = new Team({ agents: [new Agent({ name: "A" }), new Agent({ name: "B" })] });
  const trace = RunTrace.fromTeamResult(team.run("Persist me."), { name: "persist-demo" });
  const store = new FileTraceStore({ root: dir });

  const saved = await store.save(trace, "latest");
  const loaded = await store.load(saved);
  const reports = await writeReportFiles(loaded, "trace-report", dir);
  const reportJson = await loadReportJSON(reports.jsonPath);
  const listed = await store.list();

  assert.equal(loaded.name, "persist-demo");
  assert.equal(reportJson.name, "persist-demo");
  assert.ok(listed.some((filePath) => filePath.endsWith("latest.json")));
});

test("node package indexes project files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-context-"));
  await writeFile(join(dir, "a.txt"), "The quick brown fox jumps over the lazy dog.");
  await writeFile(join(dir, "b.py"), "def foo():\n    return 'bar'");
  await mkdir(join(dir, "node_modules"));
  await writeFile(join(dir, "node_modules", "c.txt"), "ignoring this content");

  const docs = new ProjectIndexer({ root: dir }).index();
  const results = new ContextRetriever(docs).search("fox dog");

  assert.equal(docs.length, 2);
  assert.equal(results.length, 1);
  assert.equal(results[0].path, "a.txt");
});

test("node package can inspect monorepo contract inventory", async () => {
  const contractsRoot = join(import.meta.dirname, "..", "..", "..", "contracts");
  const report = await buildNodeContractParityReport({
    runtime: "node",
    version: "1.13.0",
    contractsRoot,
  });

  assert.equal(report.success, true);
  assert.equal(report.fixtureCount, 7);
  assert.equal(report.schemaCount, 7);
  assert.match(report.toMarkdown(), /Contract Parity Report/);
});

test("node package reexports core API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-node-reexport-"));
  const trace = RunTrace.fromTeamResult(new Team({ agents: [new Agent({ name: "Solo" })] }).run("Trace."));
  const reportPath = (await writeReportFiles(trace, "latest", dir)).jsonPath;
  const content = JSON.parse(await readFile(reportPath, "utf8"));

  assert.equal(content.steps.length, 1);
});

test("node package JsonMemoryStore persists data to disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-json-memory-"));
  const filePath = join(dir, "memory_store.json");
  
  const store1 = new JsonMemoryStore(filePath);
  store1.add("Persisted facts are awesome", { kind: "fact", tags: ["cool"] });
  
  const store2 = new JsonMemoryStore(filePath);
  const list = store2.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].content, "Persisted facts are awesome");
});
