import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  Agent,
  EchoProvider,
  FileTraceStore,
  HandoffProtocol,
  HandoffQualityEvaluator,
  HandoffState,
  HandoffValidationError,
  ProviderToolAdapter,
  ReplayRunner,
  RetryPolicy,
  RunTrace,
  Team,
  ToolRegistry,
  ValidationIssue,
  ValidationReport,
  defineTool,
  loadReportJSON,
  writeReportFiles,
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

test("agent and team async runtime mirrors sync flow", async () => {
  const team = new Team({
    agents: [new Agent({ name: "Architect" }), new Agent({ name: "Coder" })],
  });

  const result = await team.arun("Build a template.");

  assert.equal(result.success, true);
  assert.equal(result.stepResults.length, 2);
  assert.equal(result.handoffs.length, 1);
  assert.match(result.finalOutput, /Echo/);
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

test("file trace store and report utilities write deterministic files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-core-"));
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
  assert.ok(listed.some((path) => path.endsWith("latest.json")));
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

test("tool registry executes sync and async tools", async () => {
  const add = defineTool({
    name: "add",
    parameters: { type: "object" },
    execute: ({ a, b }) => a + b,
  });
  const upper = defineTool({
    name: "upper",
    parameters: { type: "object" },
    execute: async ({ text }) => text.toUpperCase(),
  });
  const registry = new ToolRegistry([add, upper]);

  assert.equal(registry.execute({ name: "add", arguments: { a: 2, b: 4 } }).output, 6);
  assert.equal((await registry.aexecute({ name: "upper", arguments: { text: "ok" } })).output, "OK");
  assert.equal(registry.execute({ name: "missing", arguments: {} }).success, false);
});

test("provider tool adapter converts schemas and parses provider calls", () => {
  const tool = defineTool({
    name: "search",
    description: "Search docs.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    execute: ({ query }) => query,
  });
  const adapter = new ProviderToolAdapter();

  assert.equal(adapter.toolsToProviderFormat([tool], "openai")[0].function.name, "search");
  assert.equal(adapter.toolsToProviderFormat([tool], "anthropic")[0].input_schema.type, "object");

  const openaiCalls = adapter.parseToolCalls({
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "search", arguments: "{\"query\":\"docs\"}" } },
    ],
  }, "openai");
  const anthropicCalls = adapter.parseToolCalls({
    content: [{ id: "toolu_1", type: "tool_use", name: "search", input: { query: "docs" } }],
  }, "anthropic");

  assert.equal(openaiCalls[0].callId, "call_1");
  assert.equal(openaiCalls[0].arguments.query, "docs");
  assert.equal(anthropicCalls[0].callId, "toolu_1");
});

test("agent runWithTools executes parsed tool calls", () => {
  const add = defineTool({
    name: "add",
    parameters: { type: "object" },
    execute: ({ a, b }) => a + b,
  });
  const result = new Agent({ name: "ToolUser" }).runWithTools("Use a tool.", {
    tools: [add],
    toolCalls: [{ name: "add", arguments: { a: 10, b: 5 }, callId: "c1" }],
  });

  assert.equal(result.success, true);
  assert.equal(result.toolResults[0].output, 15);
  assert.equal(result.toolResults[0].callId, "c1");
});

test("retry policy retries retryable failures only", async () => {
  let attempts = 0;
  const policy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 1 });
  const value = await policy.run(async () => {
    attempts += 1;
    if (attempts < 2) {
      const error = new Error("slow down");
      error.status = 429;
      throw error;
    }
    return "ok";
  });

  assert.equal(value, "ok");
  assert.equal(attempts, 2);
  assert.equal(policy.shouldRetry({ status: 401 }, 1), false);
});
