import { agentName, cryptoRandomId, toJSONString } from "./utils.js";
import { HandoffState } from "./contracts.js";

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

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new TraceEvent(data);
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
    this.toolResults = Array.isArray(toolResults) ? [...toolResults] : [];
    this.events = (Array.isArray(events) ? events : []).map((event) => event instanceof TraceEvent ? event : new TraceEvent(event));
    this.metadata = metadata ? { ...metadata } : {};
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

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new TraceStep(data);
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
    this.steps = (Array.isArray(steps) ? steps : []).map((step) => step instanceof TraceStep ? step : new TraceStep(step));
    this.handoffs = (Array.isArray(handoffs) ? handoffs : []).map((handoff) => handoff instanceof HandoffState ? handoff : HandoffState.fromJSON(handoff));
    this.metadata = metadata ? { ...metadata } : {};
  }

  static fromTeamResult(result, { name = "team-run" } = {}) {
    const handoffs = result.handoffs || result.handoffStates || [];
    const stepResults = result.stepResults || [];
    return new RunTrace({
      name,
      success: result.success,
      finalOutput: result.finalOutput,
      steps: stepResults.map((step, index) => new TraceStep({
        name: step.name || step.step_name || `step-${index + 1}`,
        agent: step.agentName || step.agent_name,
        task: step.task,
        mode: "agent",
        success: step.success,
        output: step.finalOutput || step.output,
        handoff: handoffs[index - 1] ?? null,
      })),
      handoffs: handoffs,
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

  toTimeline() {
    const lines = [
      `# Execution Timeline: ${this.name} (Run ID: ${this.runId})`,
      `- Success: ${this.success}`,
      `- Total Steps: ${this.steps.length}`,
      `- Total Handoffs: ${this.handoffs.length}`,
      "",
      "## Timeline",
    ];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const agentName = step.agent || "Unknown";
      lines.push(`${i + 1}. [${agentName}] -> Task: ${step.task}`);
      lines.push(`   - Mode: ${step.mode || "default"}`);
      lines.push(`   - Success: ${step.success}`);
      lines.push(`   - Tools Used: ${step.toolResults?.length ?? 0}`);
      if (step.output) {
        const cleanedOutput = step.output.replace(/\r?\n/g, " ");
        const preview = cleanedOutput.length > 60 ? cleanedOutput.slice(0, 60) + "..." : cleanedOutput;
        lines.push(`   - Output Preview: ${preview}`);
      }
      if (step.handoff) {
        const fromA = step.handoff.fromAgent || step.handoff.from_agent || "";
        const toA = step.handoff.toAgent || step.handoff.to_agent || "";
        lines.push(`   - [Handoff] -> ${fromA} to ${toA}`);
      }
    }

    return lines.join("\n");
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

