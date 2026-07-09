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
