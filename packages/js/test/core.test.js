import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  Agent,
  EchoProvider,
  FileTraceStore,
  HandoffProtocol,
  HandoffQualityEvaluator,
  HandoffQualityReport,
  HandoffState,
  HandoffValidationError,
  ProviderToolAdapter,
  ReplayRunner,
  RetryPolicy,
  RunTrace,
  Team,
  TeamRunResult,
  ToolCall,
  ToolRegistry,
  ToolResult,
  TraceEvent,
  TraceStep,
  ValidationIssue,
  ValidationReport,
  defineTool,
  loadReportJSON,
  writeReportFiles,
  OpenAIProvider,
  OllamaProvider,
  ContextDocument,
  ProjectIndexer,
  ContextRetriever,
  ContextPack,
  ContextRunResult,
} from "../src/index.js";

const contractsRoot = join(import.meta.dirname, "..", "..", "contracts");

async function readContractFixture(name) {
  return JSON.parse(await readFile(join(contractsRoot, "fixtures", name), "utf8"));
}

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

test("handoff state reads and writes shared Python/JS contract fixture", async () => {
  const fixture = await readContractFixture("handoff_state.json");
  const state = HandoffState.fromJSON(fixture);

  assert.deepEqual(state.toJSON(), fixture);
  assert.equal(state.fromAgent, "Architect");
  assert.equal(state.toCamelJSON().fromAgent, "Architect");
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

test("run trace reads and writes shared Python/JS contract fixture", async () => {
  const fixture = await readContractFixture("run_trace.json");
  const trace = RunTrace.fromJSON(fixture);

  assert.deepEqual(trace.toJSON(), fixture);
  assert.equal(trace.runId, "shared-contract-demo");
  assert.equal(trace.steps[1].handoff.fromAgent, "Architect");
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

test("validation report reads and writes shared Python/JS contract fixture", async () => {
  const fixture = await readContractFixture("validation_report.json");
  const report = ValidationReport.fromJSON(fixture);

  assert.equal(report.success, false);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].code, "missing_task");
  assert.deepEqual(report.toJSON(), fixture);
});

test("quality report reads and writes shared Python/JS contract fixture", async () => {
  const fixture = await readContractFixture("quality_report.json");
  const report = HandoffQualityReport.fromJSON(fixture);

  assert.equal(report.success, true);
  assert.equal(report.score, 0.85);
  assert.equal(report.metrics.length, 5);
  assert.equal(report.metrics[3].name, "traceability");
  assert.deepEqual(report.toJSON(), fixture);
});

test("tool call reads and writes shared Python/JS contract fixture", async () => {
  const fixture = await readContractFixture("tool_call.json");
  const call = ToolCall.fromJSON(fixture);

  assert.equal(call.name, "add");
  assert.equal(call.arguments.a, 5);
  assert.equal(call.callId, "call-12345");
  assert.deepEqual(call.toJSON(), fixture);
});

test("tool result reads and writes shared Python/JS contract fixture", async () => {
  const fixture = await readContractFixture("tool_result.json");
  const res = ToolResult.fromJSON(fixture);

  assert.equal(res.name, "add");
  assert.equal(res.success, true);
  assert.equal(res.output, 15);
  assert.equal(res.callId, "call-12345");
  assert.deepEqual(res.toJSON(), fixture);
});

test("hardened constructors safely handle null or non-array values", () => {
  // HandoffState
  const state = new HandoffState({
    task: "do something",
    decisions: null,
    importantFiles: null,
    errors: null,
    nextSteps: null,
    contextRefs: null,
  });
  assert.deepEqual(state.decisions, []);
  assert.deepEqual(state.importantFiles, []);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.nextSteps, []);
  assert.deepEqual(state.contextRefs, []);

  // RunTrace & TraceStep
  const step = new TraceStep({
    toolResults: null,
    events: null,
  });
  assert.deepEqual(step.toolResults, []);
  assert.deepEqual(step.events, []);

  const trace = new RunTrace({
    steps: null,
    handoffs: null,
  });
  assert.deepEqual(trace.steps, []);
  assert.deepEqual(trace.handoffs, []);

  // ValidationReport & HandoffQualityReport
  const valReport = new ValidationReport({
    issues: null,
  });
  assert.deepEqual(valReport.issues, []);

  const qualReport = new HandoffQualityReport({
    success: true,
    score: 1.0,
    grade: "A",
    metrics: null,
    recommendations: null,
    validation: null,
  });
  assert.deepEqual(qualReport.metrics, []);
  assert.deepEqual(qualReport.recommendations, []);

  // TeamRunResult
  const teamResult = new TeamRunResult({
    success: true,
    stepResults: null,
    handoffs: null,
  });
  assert.deepEqual(teamResult.stepResults, []);
  assert.deepEqual(teamResult.handoffs, []);

  // ToolRegistry & ProviderToolAdapter
  const registry = new ToolRegistry(null);
  assert.equal(registry.list().length, 0);

  const adapter = new ProviderToolAdapter();
  const format = adapter.toolsToProviderFormat(null);
  assert.deepEqual(format, []);
});

test("OpenAIProvider handles successful completions", async () => {
  const originalFetch = global.fetch;
  let fetchCall = null;
  global.fetch = async (url, options) => {
    fetchCall = { url, options };
    return {
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "Hello from mock OpenAI!" } }
        ]
      })
    };
  };

  try {
    const provider = new OpenAIProvider({ apiKey: "mock-key" });
    const response = await provider.agenerate("Hello");
    assert.equal(response, "Hello from mock OpenAI!");
    assert.equal(fetchCall.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(fetchCall.options.headers["Authorization"], "Bearer mock-key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("OllamaProvider handles successful completions", async () => {
  const originalFetch = global.fetch;
  let fetchCall = null;
  global.fetch = async (url, options) => {
    fetchCall = { url, options };
    return {
      ok: true,
      json: async () => ({
        response: "Hello from mock Ollama!"
      })
    };
  };

  try {
    const provider = new OllamaProvider();
    const response = await provider.agenerate("Hello");
    assert.equal(response, "Hello from mock Ollama!");
    assert.equal(fetchCall.url, "http://localhost:11434/api/generate");
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenAIProvider constructor requires API Key", () => {
  const origEnv = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => new OpenAIProvider(), /apiKey is required/);
  } finally {
    if (origEnv) process.env.OPENAI_API_KEY = origEnv;
  }
});

test("HandoffState fromMarkdown roundtrip in JS", () => {
  const state = new HandoffState({
    task: "Build package",
    fromAgent: "Architect",
    toAgent: "Coder",
    summary: "Plan complete",
    decisions: ["Use ES Modules"],
    importantFiles: ["package.json"],
    errors: ["none"],
    nextSteps: ["Implement tests"],
  });

  const md = state.toMarkdown();
  const loaded = HandoffState.fromMarkdown(md);

  assert.equal(loaded.task, "Build package");
  assert.equal(loaded.fromAgent, "Architect");
  assert.equal(loaded.toAgent, "Coder");
  assert.equal(loaded.summary, "Plan complete");
  assert.deepEqual(loaded.decisions, ["Use ES Modules"]);
  assert.deepEqual(loaded.importantFiles, ["package.json"]);
  assert.deepEqual(loaded.errors, ["none"]);
  assert.deepEqual(loaded.nextSteps, ["Implement tests"]);
});

test("ProjectIndexer indexes files and ContextRetriever searches them in JS", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoffkit-context-test-"));
  await writeFile(join(dir, "a.txt"), "The quick brown fox jumps over the lazy dog.");
  await writeFile(join(dir, "b.py"), "def foo():\n    return 'bar'");
  // Ignored directory
  await mkdir(join(dir, "node_modules"));
  await writeFile(join(dir, "node_modules", "c.txt"), "ignoring this content");

  const indexer = new ProjectIndexer({ root: dir });
  const docs = indexer.index();

  assert.equal(docs.length, 2);
  assert.equal(docs[0].path, "a.txt");
  assert.equal(docs[1].path, "b.py");
  assert.match(docs[0].content, /quick brown fox/);

  const retriever = new ContextRetriever(docs);
  const searchResults = retriever.search("fox dog");
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].path, "a.txt");
});

test("RunTrace toTimeline works in JS", () => {
  const trace = new RunTrace({
    runId: "js-test-run",
    name: "JS Timeline Flow",
    success: true,
    steps: [
      {
        name: "step-1",
        agent: "Architect",
        task: "Design system",
        mode: "agent",
        success: true,
        output: "Initial design ready",
      }
    ]
  });

  const timeline = trace.toTimeline();
  assert.match(timeline, /Execution Timeline: JS Timeline Flow/);
  assert.match(timeline, /1. \[Architect\] -> Task: Design system/);
});



