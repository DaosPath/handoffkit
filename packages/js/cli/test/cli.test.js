import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  VERSION,
  initProject,
  listProviders,
  main,
  renderReport,
  runDemo,
  runRecipeDemo,
  runShowcase,
} from "../src/index.js";

const binPath = join(import.meta.dirname, "..", "src", "bin.js");

test("version and help work offline", async () => {
  const output = [];
  assert.equal(await main(["--version"], { stdout: (text) => output.push(text) }), 0);
  assert.equal(output[0], `handoffkit-js ${VERSION}`);

  const child = spawnSync(process.execPath, [binPath, "--version"], { encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /handoffkit-js 1\.9\.0/);
});

test("basic and recipe demos use JS core offline", () => {
  assert.match(runDemo(), /HandoffKit JS demo/);
  assert.match(runDemo(), /Handoffs: 2/);
  assert.match(runRecipeDemo(), /Recipe Run: js-release-checklist/);
});

test("showcase demos write runs/latest reports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-js-cli-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const coding = await runShowcase("coding-review");
    const support = await runShowcase("support");
    const research = await runShowcase("research");

    assert.match(coding, /Coding Agents/);
    assert.match(support, /Customer Support Escalation/);
    assert.match(research, /Research Workflow/);
    assert.match(await renderReport(join(dir, "runs", "latest")), /Research Workflow/);
    assert.match(await readFile(join(dir, "runs", "latest", "trace.json"), "utf8"), /research/);
  } finally {
    process.chdir(cwd);
  }
});

test("providers list stays offline and supports JSON", async () => {
  const text = await listProviders();
  const json = JSON.parse(await listProviders({ jsonOutput: true }));

  assert.match(text, /Mode: offline-core/);
  assert.equal(json.providers[0].name, "echo");
  assert.equal(json.providers[0].offline, true);
});

test("init basic-agent writes JS project", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-js-init-"));
  const output = await initProject("basic-agent", { output: dir });
  const mainSource = await readFile(join(dir, "basic-agent", "main.js"), "utf8");

  assert.match(output, /Scaffold Result/);
  assert.match(mainSource, /@handoffkit\/core/);
});

test("main routes requested commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-js-main-"));
  const cwd = process.cwd();
  const stdout = [];
  process.chdir(dir);
  try {
    for (const command of ["demo", "demo-coding-review", "demo-support", "demo-research"]) {
      const code = await main([command], { stdout: (text) => stdout.push(text) });
      assert.equal(code, 0);
    }
    assert.equal(await main(["providers", "list"], { stdout: (text) => stdout.push(text) }), 0);
    assert.equal(await main(["report", join(dir, "runs", "latest")], { stdout: (text) => stdout.push(text) }), 0);
    assert.equal(await main(["init", "agent-one", "--output", dir], { stdout: (text) => stdout.push(text) }), 0);
    assert.ok(stdout.some((text) => text.includes("HandoffKit JS providers")));
  } finally {
    process.chdir(cwd);
  }
});
