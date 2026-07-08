import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_PROTOCOL_MODE = "hybrid_state";

export class HandoffValidationError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "HandoffValidationError";
    this.report = report;
  }
}

export class ValidationIssue {
  constructor({ code, message, field = "", severity = "error" }) {
    this.code = String(code);
    this.message = String(message);
    this.field = field ? String(field) : "";
    this.severity = severity === "warning" ? "warning" : "error";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      field: this.field,
      severity: this.severity,
    };
  }
}

export class ValidationReport {
  constructor({ success = true, issues = [], metadata = {} } = {}) {
    this.success = Boolean(success);
    this.issues = issues.map((issue) =>
      issue instanceof ValidationIssue ? issue : new ValidationIssue(issue),
    );
    this.metadata = { ...metadata };
  }

  static fromIssues(issues, metadata = {}) {
    const normalized = issues.map((issue) =>
      issue instanceof ValidationIssue ? issue : new ValidationIssue(issue),
    );
    return new ValidationReport({
      success: normalized.every((issue) => issue.severity !== "error"),
      issues: normalized,
      metadata,
    });
  }

  toJSON() {
    return {
      success: this.success,
      issues: this.issues.map((issue) => issue.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const lines = [`# Validation Report`, "", `Success: ${this.success}`];
    if (this.issues.length === 0) {
      lines.push("", "No issues.");
      return lines.join("\n");
    }
    lines.push("", "| Severity | Code | Field | Message |", "|---|---|---|---|");
    for (const issue of this.issues) {
      lines.push(
        `| ${issue.severity} | ${issue.code} | ${issue.field || "-"} | ${issue.message} |`,
      );
    }
    return lines.join("\n");
  }

  raiseIfFailed() {
    if (!this.success) {
      throw new HandoffValidationError("Validation failed.", this);
    }
    return this;
  }
}

export class HandoffState {
  constructor({
    task,
    fromAgent = "",
    toAgent = "",
    summary = "",
    decisions = [],
    importantFiles = [],
    errors = [],
    nextSteps = [],
    contextRefs = [],
    metadata = {},
  } = {}) {
    this.task = task ?? "";
    this.fromAgent = fromAgent;
    this.toAgent = toAgent;
    this.summary = summary;
    this.decisions = [...decisions];
    this.importantFiles = [...importantFiles];
    this.errors = [...errors];
    this.nextSteps = [...nextSteps];
    this.contextRefs = [...contextRefs];
    this.metadata = { ...metadata };
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new HandoffState({
      task: data.task,
      fromAgent: data.fromAgent ?? data.from_agent,
      toAgent: data.toAgent ?? data.to_agent,
      summary: data.summary,
      decisions: data.decisions,
      importantFiles: data.importantFiles ?? data.important_files,
      errors: data.errors,
      nextSteps: data.nextSteps ?? data.next_steps,
      contextRefs: data.contextRefs ?? data.context_refs,
      metadata: data.metadata,
    });
  }

  validateReport() {
    const issues = [];
    if (!this.task || !String(this.task).trim()) {
      issues.push({ code: "missing_task", field: "task", message: "task is required" });
    }
    if (!this.summary || !String(this.summary).trim()) {
      issues.push({ code: "missing_summary", field: "summary", message: "summary is required" });
    }
    for (const [field, value] of Object.entries({
      decisions: this.decisions,
      importantFiles: this.importantFiles,
      errors: this.errors,
      nextSteps: this.nextSteps,
      contextRefs: this.contextRefs,
    })) {
      if (!Array.isArray(value)) {
        issues.push({ code: "invalid_array", field, message: `${field} must be an array` });
      }
    }
    if (this.decisions.length === 0) {
      issues.push({
        code: "empty_decisions",
        field: "decisions",
        message: "decisions is empty",
        severity: "warning",
      });
    }
    return ValidationReport.fromIssues(issues, {
      validator: "HandoffState.validateReport",
    });
  }

  validate() {
    this.validateReport().raiseIfFailed();
    return this;
  }

  toJSON() {
    return this.toWire();
  }

  toWire() {
    return {
      task: this.task,
      from_agent: this.fromAgent,
      to_agent: this.toAgent,
      summary: this.summary,
      decisions: [...this.decisions],
      important_files: [...this.importantFiles],
      errors: [...this.errors],
      next_steps: [...this.nextSteps],
      context_refs: [...this.contextRefs],
      metadata: { ...this.metadata },
    };
  }

  toCamelJSON() {
    return {
      task: this.task,
      fromAgent: this.fromAgent,
      toAgent: this.toAgent,
      summary: this.summary,
      decisions: [...this.decisions],
      importantFiles: [...this.importantFiles],
      errors: [...this.errors],
      nextSteps: [...this.nextSteps],
      contextRefs: [...this.contextRefs],
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    return [
      `# HandoffState`,
      "",
      `Task: ${this.task}`,
      `From: ${this.fromAgent || "-"}`,
      `To: ${this.toAgent || "-"}`,
      "",
      `## Summary`,
      this.summary || "-",
      "",
      listSection("Decisions", this.decisions),
      listSection("Files", this.importantFiles),
      listSection("Errors", this.errors),
      listSection("Next Steps", this.nextSteps),
    ].join("\n");
  }
}

export class BaseProvider {
  constructor({ model = "" } = {}) {
    this.model = model;
  }

  generate() {
    throw new Error(`${this.constructor.name}.generate() is not implemented.`);
  }

  async agenerate(prompt, kwargs = {}) {
    return this.generate(prompt, kwargs);
  }
}

export class EchoProvider extends BaseProvider {
  constructor({ model = "echo-js" } = {}) {
    super({ model });
  }

  generate(prompt) {
    return `Echo(${this.model}): ${prompt}`;
  }
}

export class Agent {
  constructor({ name, role = "", provider = new EchoProvider(), metadata = {} } = {}) {
    if (!name) {
      throw new TypeError("Agent name is required.");
    }
    this.name = name;
    this.role = role;
    this.provider = provider;
    this.metadata = { ...metadata };
  }

  run(task, { context = null } = {}) {
    const prompt = context ? `${this.role}\n\nTask: ${task}\n\nContext:\n${context}` : `${this.role}\n\nTask: ${task}`;
    const finalOutput = this.provider.generate(prompt, { agent: this, task, context });
    return new AgentRunResult({
      agentName: this.name,
      task,
      finalOutput,
      provider: this.provider.constructor?.name ?? "Provider",
      model: this.provider.model ?? "",
    });
  }

  async arun(task, { context = null } = {}) {
    const prompt = context ? `${this.role}\n\nTask: ${task}\n\nContext:\n${context}` : `${this.role}\n\nTask: ${task}`;
    const generate = this.provider.agenerate?.bind(this.provider) ?? this.provider.generate.bind(this.provider);
    const finalOutput = await generate(prompt, { agent: this, task, context });
    return new AgentRunResult({
      agentName: this.name,
      task,
      finalOutput,
      provider: this.provider.constructor?.name ?? "Provider",
      model: this.provider.model ?? "",
    });
  }

  runWithTools(task, { tools = [], toolCalls = [], providerAdapter = new ProviderToolAdapter() } = {}) {
    const result = this.run(task);
    const registry = new ToolRegistry(tools);
    const calls = Array.isArray(toolCalls) ? toolCalls : providerAdapter.parseToolCalls(toolCalls);
    const toolResults = calls.map((call) => registry.execute(call));
    return new ToolAgentRunResult({ agentResult: result, toolResults });
  }

  async arunWithTools(task, { tools = [], toolCalls = [], providerAdapter = new ProviderToolAdapter() } = {}) {
    const result = await this.arun(task);
    const registry = new ToolRegistry(tools);
    const calls = Array.isArray(toolCalls) ? toolCalls : providerAdapter.parseToolCalls(toolCalls);
    const toolResults = [];
    for (const call of calls) {
      toolResults.push(await registry.aexecute(call));
    }
    return new ToolAgentRunResult({ agentResult: result, toolResults });
  }
}

export class AgentRunResult {
  constructor({ agentName, task, finalOutput, success = true, provider = "", model = "" }) {
    this.agentName = agentName;
    this.task = task;
    this.finalOutput = finalOutput;
    this.success = Boolean(success);
    this.provider = provider;
    this.model = model;
  }

  toJSON() {
    return {
      agent_name: this.agentName,
      task: this.task,
      final_output: this.finalOutput,
      success: this.success,
      provider: this.provider,
      model: this.model,
    };
  }
}

export class HandoffProtocol {
  constructor({ mode = DEFAULT_PROTOCOL_MODE } = {}) {
    this.mode = mode;
  }

  transfer({ fromAgent, toAgent, task, summary, decisions = [], importantFiles = [], errors = [], nextSteps = [], contextRefs = [], metadata = {} }) {
    return new HandoffState({
      task,
      fromAgent: agentName(fromAgent),
      toAgent: agentName(toAgent),
      summary,
      decisions,
      importantFiles,
      errors,
      nextSteps,
      contextRefs,
      metadata: { protocolMode: this.mode, ...metadata },
    }).validate();
  }
}

export class Team {
  constructor({ agents = [], protocol = new HandoffProtocol(), metadata = {} } = {}) {
    if (agents.length === 0) {
      throw new TypeError("Team requires at least one agent.");
    }
    this.agents = [...agents];
    this.protocol = protocol;
    this.metadata = { ...metadata };
  }

  run(task) {
    const stepResults = [];
    const handoffs = [];
    let currentTask = task;
    let previousAgent = null;
    let previousResult = null;

    for (const agent of this.agents) {
      const result = agent.run(currentTask, {
        context: previousResult?.finalOutput ?? null,
      });
      stepResults.push(result);

      if (previousAgent) {
        handoffs.push(
          this.protocol.transfer({
            fromAgent: previousAgent,
            toAgent: agent,
            task: currentTask,
            summary: previousResult.finalOutput,
            decisions: [`${previousAgent.name} completed its step.`],
            nextSteps: [`${agent.name} should continue from structured state.`],
          }),
        );
      }

      previousAgent = agent;
      previousResult = result;
      currentTask = result.finalOutput;
    }

    return new TeamRunResult({
      success: stepResults.every((result) => result.success),
      task,
      finalOutput: stepResults.at(-1)?.finalOutput ?? "",
      stepResults,
      handoffs,
      metadata: this.metadata,
    });
  }

  async arun(task) {
    const stepResults = [];
    const handoffs = [];
    let currentTask = task;
    let previousAgent = null;
    let previousResult = null;

    for (const agent of this.agents) {
      const result = await agent.arun(currentTask, {
        context: previousResult?.finalOutput ?? null,
      });
      stepResults.push(result);

      if (previousAgent) {
        handoffs.push(
          this.protocol.transfer({
            fromAgent: previousAgent,
            toAgent: agent,
            task: currentTask,
            summary: previousResult.finalOutput,
            decisions: [`${previousAgent.name} completed its step.`],
            nextSteps: [`${agent.name} should continue from structured state.`],
          }),
        );
      }

      previousAgent = agent;
      previousResult = result;
      currentTask = result.finalOutput;
    }

    return new TeamRunResult({
      success: stepResults.every((result) => result.success),
      task,
      finalOutput: stepResults.at(-1)?.finalOutput ?? "",
      stepResults,
      handoffs,
      metadata: this.metadata,
    });
  }
}

export class TeamRunResult {
  constructor({ success, task, finalOutput, stepResults = [], handoffs = [], metadata = {} }) {
    this.success = Boolean(success);
    this.task = task;
    this.finalOutput = finalOutput;
    this.stepResults = [...stepResults];
    this.handoffs = [...handoffs];
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      success: this.success,
      task: this.task,
      final_output: this.finalOutput,
      step_results: this.stepResults.map((result) => result.toJSON()),
      handoffs: this.handoffs.map((handoff) => handoff.toJSON()),
      metadata: { ...this.metadata },
    };
  }
}

export class HandoffQualityEvaluator {
  constructor({ minScore = 0.6 } = {}) {
    this.minScore = minScore;
  }

  evaluate(state) {
    const handoff = state instanceof HandoffState ? state : HandoffState.fromJSON(state);
    const metrics = [
      scoreMetric("completeness", handoff.summary && handoff.task && handoff.nextSteps.length ? 1 : 0.4),
      scoreMetric("clarity", handoff.summary.length >= 20 ? 1 : 0.5),
      scoreMetric("actionability", handoff.nextSteps.length > 0 ? 1 : 0.3),
      scoreMetric("traceability", handoff.importantFiles.length || handoff.contextRefs.length ? 1 : 0.5),
      scoreMetric("errorAwareness", handoff.errors.length || handoff.metadata.errorsChecked ? 1 : 0.7),
    ];
    const score = round(metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / metrics.reduce((sum, metric) => sum + metric.weight, 0));
    return new HandoffQualityReport({
      success: score >= this.minScore,
      score,
      grade: grade(score),
      metrics,
      recommendations: score >= this.minScore ? [] : ["Add clearer next steps, files, context refs, or error notes."],
      validation: handoff.validateReport(),
    });
  }
}

export class HandoffQualityReport {
  constructor({ success, score, grade, metrics = [], recommendations = [], validation }) {
    this.success = Boolean(success);
    this.score = score;
    this.grade = grade;
    this.metrics = metrics;
    this.recommendations = recommendations;
    this.validation = validation;
  }

  toJSON() {
    return {
      success: this.success,
      score: this.score,
      grade: this.grade,
      metrics: this.metrics,
      recommendations: [...this.recommendations],
      validation: this.validation?.toJSON?.() ?? this.validation,
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    return [
      "# Handoff Quality Report",
      "",
      `Success: ${this.success}`,
      `Score: ${this.score}`,
      `Grade: ${this.grade}`,
      "",
      "| Metric | Score | Weight |",
      "|---|---:|---:|",
      ...this.metrics.map((metric) => `| ${metric.name} | ${metric.score} | ${metric.weight} |`),
    ].join("\n");
  }
}

export class TraceEvent {
  constructor({ kind, message, timestamp = new Date().toISOString(), metadata = {} }) {
    this.kind = kind;
    this.message = message;
    this.timestamp = timestamp;
    this.metadata = { ...metadata };
  }

  toJSON() {
    return { kind: this.kind, message: this.message, timestamp: this.timestamp, metadata: { ...this.metadata } };
  }
}

export class TraceStep {
  constructor(init) {
    const {
      name,
      agent = "",
      task = "",
      mode = "",
      success = true,
      output = "",
      handoff = null,
      toolResults = init?.tool_results ?? [],
      events = [],
      metadata = {},
    } = init ?? {};
    this.name = name;
    this.agent = agent;
    this.task = task;
    this.mode = mode;
    this.success = Boolean(success);
    this.output = output;
    this.handoff = handoff instanceof HandoffState ? handoff : (handoff ? HandoffState.fromJSON(handoff) : null);
    this.toolResults = [...toolResults];
    this.events = events.map((event) => event instanceof TraceEvent ? event : new TraceEvent(event));
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      name: this.name,
      agent: this.agent,
      task: this.task,
      mode: this.mode,
      success: this.success,
      output: this.output,
      handoff: this.handoff?.toJSON?.() ?? this.handoff,
      tool_results: this.toolResults.map((result) => result?.toJSON?.() ?? result),
      events: this.events.map((event) => event.toJSON()),
      metadata: { ...this.metadata },
    };
  }
}

export class RunTrace {
  constructor(init = {}) {
    const {
      runId,
      run_id,
      name = "run",
      success = true,
      finalOutput,
      final_output,
      steps = [],
      handoffs = [],
      metadata = {},
    } = init;
    this.runId = runId || run_id || cryptoRandomId();
    this.name = name;
    this.success = Boolean(success);
    this.finalOutput = finalOutput || final_output || "";
    this.steps = steps.map((step) => step instanceof TraceStep ? step : new TraceStep(step));
    this.handoffs = handoffs.map((handoff) => handoff instanceof HandoffState ? handoff : HandoffState.fromJSON(handoff));
    this.metadata = { ...metadata };
  }

  static fromTeamResult(result, { name = "team-run" } = {}) {
    return new RunTrace({
      name,
      success: result.success,
      finalOutput: result.finalOutput,
      steps: result.stepResults.map((step, index) => new TraceStep({
        name: `step-${index + 1}`,
        agent: step.agentName,
        task: step.task,
        mode: "agent",
        success: step.success,
        output: step.finalOutput,
        handoff: result.handoffs[index - 1] ?? null,
      })),
      handoffs: result.handoffs,
      metadata: result.metadata,
    });
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new RunTrace(data);
  }

  toJSON() {
    return {
      run_id: this.runId,
      name: this.name,
      success: this.success,
      final_output: this.finalOutput,
      steps: this.steps.map((step) => step.toJSON()),
      handoffs: this.handoffs.map((handoff) => handoff.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    return [
      `# RunTrace: ${this.name}`,
      "",
      `Success: ${this.success}`,
      `Steps: ${this.steps.length}`,
      `Handoffs: ${this.handoffs.length}`,
      "",
      `Final Output: ${this.finalOutput}`,
    ].join("\n");
  }
}

export class ReplayRunner {
  constructor(trace) {
    this.trace = trace instanceof RunTrace ? trace : RunTrace.fromJSON(trace);
  }

  summary() {
    return {
      success: this.trace.success,
      stepCount: this.trace.steps.length,
      handoffCount: this.trace.handoffs.length,
      toolResultCount: this.trace.steps.reduce((sum, step) => sum + step.toolResults.length, 0),
      finalOutput: this.trace.finalOutput,
      metadata: { replayed: true, sourceRunId: this.trace.runId },
    };
  }
}

export class FileTraceStore {
  constructor({ root = "traces" } = {}) {
    this.root = root;
  }

  async save(trace, name = "") {
    const runTrace = trace instanceof RunTrace ? trace : RunTrace.fromJSON(trace);
    await mkdir(this.root, { recursive: true });
    const fileName = `${safeFileName(name || runTrace.runId)}.json`;
    const path = join(this.root, fileName);
    await writeFile(path, runTrace.toJSONString(2), "utf8");
    return path;
  }

  async load(nameOrPath) {
    const path = nameOrPath.endsWith(".json") ? nameOrPath : join(this.root, `${safeFileName(nameOrPath)}.json`);
    return RunTrace.fromJSON(await readFile(path, "utf8"));
  }

  async list() {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => join(this.root, entry.name));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }
}

export class ToolCall {
  constructor({ name, arguments: args = {}, callId = "", provider = "", metadata = {} } = {}) {
    const init = arguments[0] ?? {};
    if (!name) throw new TypeError("ToolCall name is required.");
    this.name = name;
    this.arguments = { ...args };
    this.callId = callId || init.call_id || init.id || "";
    this.provider = provider;
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      name: this.name,
      arguments: { ...this.arguments },
      call_id: this.callId,
      provider: this.provider,
      metadata: { ...this.metadata },
    };
  }
}

export class ToolResult {
  constructor({ name, callId = "", success = true, output = null, error = "", metadata = {} } = {}) {
    const init = arguments[0] ?? {};
    this.name = name;
    this.callId = callId || init.call_id || "";
    this.success = Boolean(success);
    this.output = output;
    this.error = error;
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      name: this.name,
      call_id: this.callId,
      success: this.success,
      output: this.output,
      error: this.error,
      metadata: { ...this.metadata },
    };
  }
}

export class ToolRegistry {
  constructor(tools = []) {
    this.tools = new Map();
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool) {
    if (!tool?.name) throw new TypeError("Tool name is required.");
    if (typeof tool.execute !== "function") throw new TypeError(`Tool ${tool.name} requires execute().`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name) {
    return this.tools.get(name) ?? null;
  }

  list() {
    return [...this.tools.values()];
  }

  execute(call) {
    const toolCall = call instanceof ToolCall ? call : new ToolCall(call);
    const tool = this.get(toolCall.name);
    if (!tool) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: `Tool not found: ${toolCall.name}`,
      });
    }
    try {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        output: tool.execute(toolCall.arguments),
      });
    } catch (error) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async aexecute(call) {
    const toolCall = call instanceof ToolCall ? call : new ToolCall(call);
    const tool = this.get(toolCall.name);
    if (!tool) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: `Tool not found: ${toolCall.name}`,
      });
    }
    try {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        output: await tool.execute(toolCall.arguments),
      });
    } catch (error) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export class ToolAgentRunResult {
  constructor({ agentResult, toolResults = [] }) {
    this.agentResult = agentResult;
    this.toolResults = toolResults.map((result) => result instanceof ToolResult ? result : new ToolResult(result));
    this.success = agentResult.success && this.toolResults.every((result) => result.success);
  }

  toJSON() {
    return {
      success: this.success,
      agent_result: this.agentResult.toJSON(),
      tool_results: this.toolResults.map((result) => result.toJSON()),
    };
  }
}

export class ProviderToolAdapter {
  constructor({ providerFormat = "handoffkit" } = {}) {
    this.providerFormat = providerFormat;
  }

  toolsToProviderFormat(tools, providerFormat = this.providerFormat) {
    const list = tools.map((tool) => normalizeToolSchema(tool));
    if (providerFormat === "handoffkit") return list;
    if (providerFormat === "openai") {
      return list.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }
    if (providerFormat === "anthropic") {
      return list.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }
    throw new TypeError(`Unsupported provider tool format: ${providerFormat}`);
  }

  parseToolCalls(payload, providerFormat = this.providerFormat) {
    if (payload == null) return [];
    if (providerFormat === "handoffkit") return parseHandoffKitToolCalls(payload);
    if (providerFormat === "openai") return parseOpenAIToolCalls(payload);
    if (providerFormat === "anthropic") return parseAnthropicToolCalls(payload);
    throw new TypeError(`Unsupported provider tool format: ${providerFormat}`);
  }
}

export class RetryPolicy {
  constructor({ maxAttempts = 3, baseDelayMs = 250, retryStatusCodes = [429, 500, 502, 503, 504] } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.retryStatusCodes = [...retryStatusCodes];
  }

  shouldRetry(error, attempt) {
    if (attempt >= this.maxAttempts) return false;
    const status = error?.status ?? error?.statusCode;
    if (status) return this.retryStatusCodes.includes(status);
    return Boolean(error?.retryable);
  }

  async run(operation) {
    let attempt = 1;
    for (;;) {
      try {
        return await operation({ attempt });
      } catch (error) {
        if (!this.shouldRetry(error, attempt)) throw error;
        await sleep(this.baseDelayMs * attempt);
        attempt += 1;
      }
    }
  }
}

export async function writeReportFiles(report, name, outputDir = "reports") {
  await mkdir(outputDir, { recursive: true });
  const base = join(outputDir, safeFileName(name));
  const jsonPath = `${base}.json`;
  const markdownPath = `${base}.md`;
  const data = report?.toJSON?.() ?? report;
  const markdown = report?.toMarkdown?.() ?? `# ${name}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
  await writeFile(jsonPath, JSON.stringify(data, null, 2), "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  return { jsonPath, markdownPath };
}

export async function loadReportJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function defineTool({ name, description = "", parameters = {}, execute }) {
  if (!name) {
    throw new TypeError("Tool name is required.");
  }
  if (typeof execute !== "function") {
    throw new TypeError("Tool execute function is required.");
  }
  return {
    name,
    description,
    parameters,
    execute,
    toSchema() {
      return { name, description, parameters };
    },
  };
}

function listSection(title, values) {
  return [`## ${title}`, ...(values.length ? values.map((value) => `- ${value}`) : ["-"])].join("\n");
}

function agentName(agent) {
  return typeof agent === "string" ? agent : agent?.name ?? "";
}

function scoreMetric(name, score, weight = 1) {
  return { name, score: round(score), weight, notes: [] };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function grade(score) {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

function cryptoRandomId() {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeToolSchema(tool) {
  const schema = tool?.toSchema?.() ?? tool;
  if (!schema?.name) throw new TypeError("Tool schema name is required.");
  return {
    name: schema.name,
    description: schema.description ?? "",
    parameters: schema.parameters ?? {},
  };
}

function parseHandoffKitToolCalls(payload) {
  const calls = Array.isArray(payload) ? payload : (payload.toolCalls ?? payload.tool_calls ?? [payload]);
  return calls.filter(Boolean).map((call) => new ToolCall({
    name: call.name,
    arguments: call.arguments ?? call.args ?? {},
    callId: call.callId ?? call.call_id ?? call.id ?? "",
    provider: "handoffkit",
    metadata: call.metadata ?? {},
  }));
}

function parseOpenAIToolCalls(payload) {
  const calls = payload.choices?.[0]?.message?.tool_calls ?? payload.message?.tool_calls ?? payload.tool_calls ?? [];
  if (!Array.isArray(calls)) throw new TypeError("OpenAI tool_calls must be an array.");
  return calls.map((call) => {
    const fn = call.function ?? {};
    if (!fn.name) throw new TypeError("OpenAI tool call function.name is required.");
    return new ToolCall({
      name: fn.name,
      arguments: parseArgumentsObject(fn.arguments, "OpenAI function.arguments"),
      callId: call.id ?? "",
      provider: "openai",
      metadata: { type: call.type ?? "function" },
    });
  });
}

function parseAnthropicToolCalls(payload) {
  const content = payload.content ?? payload.message?.content ?? [];
  if (!Array.isArray(content)) throw new TypeError("Anthropic content must be an array.");
  return content.filter((block) => block?.type === "tool_use").map((block) => {
    if (!block.name) throw new TypeError("Anthropic tool_use name is required.");
    return new ToolCall({
      name: block.name,
      arguments: parseArgumentsObject(block.input ?? {}, "Anthropic tool_use.input"),
      callId: block.id ?? "",
      provider: "anthropic",
    });
  });
}

function parseArgumentsObject(value, label) {
  const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return parsed;
}

function safeFileName(value) {
  return String(value || "report").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
