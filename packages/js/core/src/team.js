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
  constructor({ agents = [], protocol = new HandoffProtocol(), metadata = {} } = {}) {
    const list = Array.isArray(agents) ? agents : [];
    if (list.length === 0) {
      throw new TypeError("Team requires at least one agent.");
    }
    this.agents = [...list];
    this.protocol = protocol;
    this.metadata = metadata ? { ...metadata } : {};
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

