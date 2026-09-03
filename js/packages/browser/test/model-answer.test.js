import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { judgeModelAnswer } from "../src/model_answer.js";
import { judgeModelAnswer as judgeFromIndex } from "../src/index.js";

const fixture = JSON.parse(
  await readFile(
    join(import.meta.dirname, "..", "..", "..", "..", "shared", "contracts", "conformance", "model-answer-v1.json"),
    "utf8",
  ),
);

test("judgeModelAnswer is exported from the package index", () => {
  assert.equal(judgeFromIndex, judgeModelAnswer);
});

for (const { name, transcript, expected } of fixture.cases) {
  test(`model-answer fixture: ${name}`, () => {
    const report = judgeModelAnswer(transcript);
    assert.equal(report.format, "handoffkit.browser.model_answer_judgment");
    assert.equal(report.format_version, 1);
    assert.equal(report.verdict, expected.verdict);
    assert.equal(report.score, expected.score);
    assert.equal(report.gates.length, 5);
    if (expected.failing_gates) {
      const failed = report.gates.filter((gate) => gate.result === "fail").map((gate) => gate.id);
      assert.deepEqual(failed, expected.failing_gates);
    }
  });
}

test("judge rejects non-object input fail-closed", () => {
  const report = judgeModelAnswer(null);
  assert.equal(report.verdict, "fail");
});
