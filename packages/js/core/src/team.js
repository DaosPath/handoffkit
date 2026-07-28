import { DEFAULT_PROTOCOL_MODE, agentName, toJSONString } from "./utils.js";
import { HandoffState } from "./contracts.js";
import { AgentRunResult } from "./agent.js";

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
  constructor({ agents = [], protocol = new HandoffProtocol(), metadata = {}, runtimeMode = "classic", runtime = null } = {}) {
    const list = Array.isArray(agents) ? agents : [];
    if (list.length === 0) {
      throw new TypeError("Team requires at least one agent.");
    }
    this.agents = [...list];
    this.protocol = protocol;
    this.metadata = metadata ? { ...metadata } : {};
    this.runtimeMode = runtimeMode;
    this.runtime = runtime;
  }

  run(task) {
    if (this.runtimeMode !== "classic") {
      throw new Error("Team.run() only supports classic mode in JavaScript; use arun() for CSP modes.");
    }
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
    if (this.runtimeMode !== "classic") return this._arunSession(task);

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

  async _arunSession(task) {
    if (!this.runtime?.createSession || !this.runtime?.makeEnvelope) {
      throw new TypeError("CSP mode requires a CspRuntime from @handoffkit/csp.");
    }
    const session = this.runtime.createSession();
    const stepResults = new Array(this.agents.length);
    const handoffs = new Array(Math.max(this.agents.length - 1, 0));
    for (let index = 0; index < this.agents.length; index += 1) session.channel(`agent-${index}`);

    for (let index = 0; index < this.agents.length; index += 1) {
      const agent = this.agents[index];
      session.spawn(`agent:${agent.name}:${index}`, async (context) => {
        const incoming = await context.receive(`agent-${index}`);
        const currentTask = incoming.payload?.task ?? task;
        const previousContext = incoming.payload?.context ?? null;
        const result = await agent.arun(currentTask, { context: previousContext });
        stepResults[index] = result;
        context.ack(incoming, { process: agent.name });

        if (index + 1 < this.agents.length) {
          const nextAgent = this.agents[index + 1];
          const handoff = this.protocol.transfer({
            fromAgent: agent,
            toAgent: nextAgent,
            task: currentTask,
            summary: result.finalOutput,
            decisions: [`${agent.name} completed its step.`],
            nextSteps: [`${nextAgent.name} should continue from structured state.`],
            metadata: { runtime_mode: "session" },
          });
          handoffs[index] = handoff;
          await context.send(`agent-${index + 1}`, this.runtime.makeEnvelope({
            sessionId: session.sessionId,
            channel: `agent-${index + 1}`,
            source: agent.name,
            target: nextAgent.name,
            sequence: index + 1,
            payloadType: "handoff_state",
            payload: {
              task: result.finalOutput,
              context: result.finalOutput,
              handoff_state: handoff.toJSON(),
            },
            idempotencyKey: `${session.sessionId}:handoff:${index}`,
          }));
        }
      });
    }

    await session.send("agent-0", this.runtime.makeEnvelope({
      sessionId: session.sessionId,
      channel: "agent-0",
      source: "team",
      target: this.agents[0].name,
      sequence: 0,
      payloadType: "task",
      payload: { task, context: null },
      idempotencyKey: `${session.sessionId}:task`,
    }));
    try {
      await session.wait();
    } finally {
      await session.close();
    }
    return new TeamRunResult({
      success: stepResults.every((result) => result.success),
      task,
      finalOutput: stepResults.at(-1)?.finalOutput ?? "",
      stepResults,
      handoffs,
      metadata: { ...this.metadata, runtime_mode: this.runtimeMode },
    });
  }
}

export class TeamRunResult {
  constructor({ success, task, finalOutput, stepResults = [], handoffs = [], metadata = {} }) {
    this.success = Boolean(success);
    this.task = task;
    this.finalOutput = finalOutput;
    this.stepResults = Array.isArray(stepResults) ? [...stepResults] : [];
    this.handoffs = Array.isArray(handoffs) ? [...handoffs] : [];
    this.metadata = metadata ? { ...metadata } : {};
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

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new TeamRunResult({
      success: data.success,
      task: data.task,
      finalOutput: data.finalOutput ?? data.final_output,
      stepResults: (Array.isArray(data.stepResults ?? data.step_results) ? data.stepResults ?? data.step_results : [])
        .map((result) => result instanceof AgentRunResult ? result : AgentRunResult.fromJSON(result)),
      handoffs: (Array.isArray(data.handoffs) ? data.handoffs : [])
        .map((handoff) => handoff instanceof HandoffState ? handoff : HandoffState.fromJSON(handoff)),
      metadata: data.metadata,
    });
  }
}

