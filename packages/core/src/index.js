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

export class EchoProvider {
  constructor({ model = "echo-js" } = {}) {
    this.model = model;
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
      agentName: this.agentName,
      task: this.task,
      finalOutput: this.finalOutput,
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
      finalOutput: this.finalOutput,
      stepResults: this.stepResults.map((result) => result.toJSON()),
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
  constructor({ name, agent = "", task = "", mode = "", success = true, output = "", handoff = null, toolResults = [], events = [], metadata = {} }) {
    this.name = name;
    this.agent = agent;
    this.task = task;
    this.mode = mode;
    this.success = Boolean(success);
    this.output = output;
    this.handoff = handoff;
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
      toolResults: [...this.toolResults],
      events: this.events.map((event) => event.toJSON()),
      metadata: { ...this.metadata },
    };
  }
}

export class RunTrace {
  constructor({ runId = cryptoRandomId(), name = "run", success = true, finalOutput = "", steps = [], handoffs = [], metadata = {} } = {}) {
    this.runId = runId;
    this.name = name;
    this.success = Boolean(success);
    this.finalOutput = finalOutput;
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
      runId: this.runId,
      name: this.name,
      success: this.success,
      finalOutput: this.finalOutput,
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
