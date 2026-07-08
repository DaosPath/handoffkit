import assert from "node:assert/strict";
import test from "node:test";

import {
  Agent,
  EchoProvider,
  HandoffProtocol,
  HandoffQualityEvaluator,
  HandoffState,
  HandoffValidationError,
  ReplayRunner,
  RunTrace,
  Team,
  ValidationIssue,
  ValidationReport,
  defineTool,
} from "../src/index.js";

test("validation report serializes and raises", () => {
  const issue = new ValidationIssue({
    code: "missing_task",
    field: "task",
    message: "task is required",
  });
  const report = ValidationReport.fromIssues([issue]);

  assert.equal(report.success, false);
  assert.match(report.toJSONString(), /missing_task/);
  assert.match(report.toMarkdown(), /Validation Report/);
  assert.throws(() => report.raiseIfFailed(), HandoffValidationError);
});

test("handoff state validates and roundtrips", () => {
  const state = new HandoffState({
    task: "Build a CLI",
    fromAgent: "Architect",
    toAgent: "Coder",
    summary: "Use argparse and keep operations pure.",
    decisions: ["Use argparse"],
    importantFiles: ["calculator.py"],
    nextSteps: ["Implement calculator.py"],
    metadata: { errorsChecked: true },
  });

  assert.equal(state.validate(), state);
  assert.equal(HandoffState.fromJSON(state.toJSONString()).task, "Build a CLI");
});

test("handoff protocol creates validated state", () => {
  const protocol = new HandoffProtocol({ mode: "hybrid_state" });
  const state = protocol.transfer({
    fromAgent: "Architect",
    toAgent: "Coder",
    task: "Build",
    summary: "Plan is ready.",
    decisions: ["Use tests"],
    nextSteps: ["Code"],
  });

  assert.equal(state.metadata.protocolMode, "hybrid_state");
  assert.equal(state.fromAgent, "Architect");
});

test("agent and team run offline with structured handoffs", () => {
  const team = new Team({
    agents: [
      new Agent({ name: "Architect", role: "Plan.", provider: new EchoProvider({ model: "test" }) }),
      new Agent({ name: "Coder", role: "Code.", provider: new EchoProvider({ model: "test" }) }),
      new Agent({ name: "Tester", role: "Test.", provider: new EchoProvider({ model: "test" }) }),
    ],
  });

  const result = team.run("Build a calculator.");

  assert.equal(result.success, true);
  assert.equal(result.stepResults.length, 3);
  assert.equal(result.handoffs.length, 2);
  assert.equal(result.handoffs[0].toAgent, "Coder");
});

test("quality evaluator scores handoffs deterministically", () => {
  const state = new HandoffState({
    task: "Build a CLI",
    summary: "Use argparse and preserve tests for the next agent.",
    decisions: ["Use argparse"],
    importantFiles: ["calculator.py"],
    errors: ["divide-by-zero checked"],
    nextSteps: ["Run pytest -q"],
  });
  const report = new HandoffQualityEvaluator().evaluate(state);

  assert.equal(report.success, true);
  assert.equal(report.grade, "A");
  assert.match(report.toMarkdown(), /Handoff Quality Report/);
});

test("run trace and replay summary do not execute work", () => {
  const team = new Team({
    agents: [new Agent({ name: "A" }), new Agent({ name: "B" })],
  });
  const result = team.run("Trace me.");
  const trace = RunTrace.fromTeamResult(result, { name: "demo" });
  const replay = new ReplayRunner(RunTrace.fromJSON(trace.toJSONString())).summary();

  assert.equal(trace.steps.length, 2);
  assert.equal(replay.stepCount, 2);
  assert.equal(replay.handoffCount, 1);
  assert.equal(replay.metadata.replayed, true);
});

test("defineTool creates provider-ready schema shape", () => {
  const add = defineTool({
    name: "add",
    description: "Add two numbers.",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    execute: ({ a, b }) => a + b,
  });

  assert.equal(add.execute({ a: 2, b: 3 }), 5);
  assert.equal(add.toSchema().name, "add");
});
