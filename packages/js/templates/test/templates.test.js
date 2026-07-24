import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TemplateScaffolder, builtinTemplates } from "../src/index.js";

test("builtin basic-agent template describes JS starter", () => {
  const template = builtinTemplates()[0];

  assert.equal(template.name, "basic-agent");
  assert.match(template.toMarkdown(), /main.js/);
});

test("template scaffolder writes files and skips without force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-js-template-"));
  const scaffolder = new TemplateScaffolder();

  const first = await scaffolder.scaffold("demo-agent", { output: dir });
  const second = await scaffolder.scaffold("demo-agent", { output: dir });
  const main = await readFile(join(dir, "demo-agent", "main.js"), "utf8");

  assert.equal(first.success, true);
  assert.equal(second.success, false);
  assert.ok(second.skipped.length > 0);
  assert.match(main, /@handoffkit\/core/);
});


test("template scaffolder rejects path traversal and invalid npm names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-template-safety-"));
  const scaffolder = new TemplateScaffolder();
  await assert.rejects(() => scaffolder.scaffold("../escape", { output: dir }), /safe directory|package name/);
  await assert.rejects(() => scaffolder.scaffold("Bad Name", { output: dir }), /lowercase npm-compatible/);
});

test("builtin template pins the current compatible core and writes no temporary files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-template-version-"));
  const result = await new TemplateScaffolder().scaffold("demo-agent", { output: dir });
  const manifest = JSON.parse(await readFile(join(result.root, "package.json"), "utf8"));
  const files = await import("node:fs/promises").then((fs) => fs.readdir(result.root));
  assert.equal(manifest.dependencies["@handoffkit/core"], "^1.14.2");
  assert.equal(manifest.scripts.check, "node --check main.js");
  assert.equal(files.some((name) => name.endsWith(".tmp")), false);
});
