import {
  Agent,
  HandoffProtocol,
} from "@handoffkit/core";

function jsonValue(value) {
  return value?.toJSON?.() ?? value;
}

function agentToJSON(agent) {
  if (!agent) return null;
  return {
    name: agent.name,
    role: agent.role ?? "",
    provider: agent.provider?.constructor?.name ?? "",
    model: agent.provider?.model ?? "",
  };
}

export class RecipeStep {
  constructor({
    name,
    task,
    agent = null,
    useContext = false,
    metadata = {},
  } = {}) {
    if (!name) throw new TypeError("RecipeStep name is required.");
    if (!task) throw new TypeError("RecipeStep task is required.");
    this.name = String(name);
    this.task = String(task);
    this.agent = agent;
    this.useContext = Boolean(useContext);
    this.metadata = metadata ? { ...metadata } : {};
  }

  toJSON() {
    return {
      name: this.name,
      task: this.task,
      agent: agentToJSON(this.agent),
      use_context: this.useContext,
      metadata: { ...this.metadata },
    };
  }
}

export class Recipe {
  constructor({ name, description = "", steps = [], metadata = {} } = {}) {
    this.name = String(name || "");
    this.description = String(description || "");
    this.steps = (Array.isArray(steps) ? steps : []).map((step) =>
      step instanceof RecipeStep ? step : new RecipeStep(step),
    );
    this.metadata = metadata ? { ...metadata } : {};
  }

  validate() {
    const problems = [];
    if (!this.name.trim()) problems.push("name must be a non-empty string");
    if (this.steps.length === 0) problems.push("steps must not be empty");
    const seen = new Set();
    const duplicates = new Set();
    for (const step of this.steps) {
      if (!step.name.trim()) problems.push("step name must be a non-empty string");
      if (!step.task.trim()) problems.push(`step ${step.name} task must be a non-empty string`);
      if (seen.has(step.name)) duplicates.add(step.name);
      seen.add(step.name);
    }
    if (duplicates.size) {
      problems.push(`step names must be unique: ${[...duplicates].sort().join(", ")}`);
    }
    if (problems.length) throw new TypeError(problems.join("; "));
    return this;
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      steps: this.steps.map((step) => step.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const steps = this.steps
      .map((step) => `- \`${step.name}\`: ${step.task} (agent=${step.agent?.name ?? "none"})`)
      .join("\n") || "- none";
    return [
      `# Recipe: ${this.name}`,
      "",
      "## Description",
      "",
      this.description || "-",
      "",
      "## Steps",
      "",
      steps,
    ].join("\n");
  }
}

export class RecipeRunResult {
  constructor({
    recipeName,
    success = true,
    finalOutput = "",
    stepResults = [],
    handoffStates = [],
    metadata = {},
  } = {}) {
    this.recipeName = recipeName || "";
    this.success = Boolean(success);
    this.finalOutput = finalOutput || "";
    this.stepResults = Array.isArray(stepResults) ? [...stepResults] : [];
    this.handoffStates = Array.isArray(handoffStates) ? [...handoffStates] : [];
    this.metadata = metadata ? { ...metadata } : {};
  }

  toJSON() {
    return {
      recipe_name: this.recipeName,
      success: this.success,
      final_output: this.finalOutput,
      step_results: this.stepResults.map(jsonValue),
      handoff_states: this.handoffStates.map(jsonValue),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const steps = this.stepResults
      .map((step) => `- \`${step.step_name}\` success=${step.success} agent=${step.agent_name}`)
      .join("\n") || "- none";
    const handoffs = this.handoffStates
      .map((state) => `- \`${state.fromAgent}\` -> \`${state.toAgent}\`: ${state.task}`)
      .join("\n") || "- none";
    return [
      `# Recipe Run: ${this.recipeName}`,
      "",
      `Success: ${this.success}`,
      "",
      "## Final Output",
      "",
      this.finalOutput || "-",
      "",
      "## Step Results",
      "",
      steps,
      "",
      "## Handoffs",
      "",
      handoffs,
    ].join("\n");
  }
}

export class RecipeRunner {
  constructor(recipe, { protocol = new HandoffProtocol({ mode: "hybrid_state" }) } = {}) {
    this.recipe = (recipe instanceof Recipe ? recipe : new Recipe(recipe)).validate();
    this.protocol = protocol;
  }

  run(initialTask = "") {
    const stepResults = [];
    const handoffStates = [];
    let previousOutput = "";
    let success = true;

    for (let index = 0; index < this.recipe.steps.length; index += 1) {
      const step = this.recipe.steps[index];
      const agent = step.agent || new Agent({ name: step.name, role: `Execute ${step.name}.` });
      const task = buildStepTask(step, initialTask, previousOutput, index);
      let result;
      try {
        result = agent.run(task, { context: step.useContext ? previousOutput : null });
      } catch (error) {
        result = {
          agentName: agent.name,
          task,
          finalOutput: error instanceof Error ? error.message : String(error),
          success: false,
          toJSON() {
            return {
              agent_name: this.agentName,
              task: this.task,
              final_output: this.finalOutput,
              success: this.success,
            };
          },
        };
      }

      success = success && result.success;
      stepResults.push({
        step_name: step.name,
        agent_name: agent.name,
        task,
        output: result.finalOutput,
        success: result.success,
        metadata: { ...step.metadata },
      });

      const nextStep = this.recipe.steps[index + 1];
      if (nextStep) {
        const nextAgent = nextStep.agent || new Agent({ name: nextStep.name });
        handoffStates.push(this.protocol.transfer({
          fromAgent: agent,
          toAgent: nextAgent,
          task: nextStep.task,
          summary: result.finalOutput,
          decisions: [`Step ${step.name} completed with success=${result.success}.`],
          nextSteps: [nextStep.task],
          metadata: {
            recipe: this.recipe.name,
            fromStep: step.name,
            toStep: nextStep.name,
          },
        }));
      }

      previousOutput = result.finalOutput;
    }

    return new RecipeRunResult({
      recipeName: this.recipe.name,
      success,
      finalOutput: stepResults.at(-1)?.output ?? "",
      stepResults,
      handoffStates,
      metadata: { step_count: this.recipe.steps.length },
    });
  }

  async arun(initialTask = "") {
    const stepResults = [];
    const handoffStates = [];
    let previousOutput = "";
    let success = true;

    for (let index = 0; index < this.recipe.steps.length; index += 1) {
      const step = this.recipe.steps[index];
      const agent = step.agent || new Agent({ name: step.name, role: `Execute ${step.name}.` });
      const task = buildStepTask(step, initialTask, previousOutput, index);
      let result;
      try {
        result = await agent.arun(task, { context: step.useContext ? previousOutput : null });
      } catch (error) {
        result = {
          agentName: agent.name,
          task,
          finalOutput: error instanceof Error ? error.message : String(error),
          success: false,
          toJSON() {
            return {
              agent_name: this.agentName,
              task: this.task,
              final_output: this.finalOutput,
              success: this.success,
            };
          },
        };
      }

      success = success && result.success;
      stepResults.push({
        step_name: step.name,
        agent_name: agent.name,
        task,
        output: result.finalOutput,
        success: result.success,
        metadata: { ...step.metadata },
      });

      const nextStep = this.recipe.steps[index + 1];
      if (nextStep) {
        const nextAgent = nextStep.agent || new Agent({ name: nextStep.name });
        handoffStates.push(this.protocol.transfer({
          fromAgent: agent,
          toAgent: nextAgent,
          task: nextStep.task,
          summary: result.finalOutput,
          decisions: [`Step ${step.name} completed with success=${result.success}.`],
          nextSteps: [nextStep.task],
          metadata: {
            recipe: this.recipe.name,
            fromStep: step.name,
            toStep: nextStep.name,
          },
        }));
      }

      previousOutput = result.finalOutput;
    }

    return new RecipeRunResult({
      recipeName: this.recipe.name,
      success,
      finalOutput: stepResults.at(-1)?.output ?? "",
      stepResults,
      handoffStates,
      metadata: { step_count: this.recipe.steps.length },
    });
  }
}

export class WorkflowTemplate {
  static sequential({ name, agents, task, description = "Sequential multi-agent workflow." } = {}) {
    const list = Array.isArray(agents) ? agents : [];
    return new Recipe({
      name,
      description,
      steps: list.map((agent, index) => new RecipeStep({
        name: agent.name.toLowerCase().replace(/\s+/g, "-"),
        agent,
        task: index === 0 ? task : `Continue workflow for: ${task}`,
        useContext: index > 0,
      })),
    });
  }

  static planExecuteReview({ name, task, planner, executor, reviewer } = {}) {
    return new Recipe({
      name,
      description: "Plan, execute, and review a task.",
      steps: [
        new RecipeStep({ name: "plan", agent: planner, task: `Create a plan for: ${task}` }),
        new RecipeStep({ name: "execute", agent: executor, task: `Execute the plan for: ${task}`, useContext: true }),
        new RecipeStep({ name: "review", agent: reviewer, task: `Review the result for: ${task}`, useContext: true }),
      ],
    });
  }
}

export function planExecuteReviewRecipe(task = "Prepare a local release checklist.") {
  return WorkflowTemplate.planExecuteReview({
    name: "plan-execute-review",
    task,
    planner: new Agent({ name: "Planner", role: "Create concise implementation plans." }),
    executor: new Agent({ name: "Executor", role: "Carry out the plan using structured state." }),
    reviewer: new Agent({ name: "Reviewer", role: "Review output and list next steps." }),
  });
}

function buildStepTask(step, initialTask, previousOutput, index) {
  const parts = [];
  if (index === 0 && initialTask) parts.push(`Initial task: ${initialTask}`);
  if (previousOutput) parts.push(`Previous output: ${previousOutput}`);
  parts.push(`Step task: ${step.task}`);
  return parts.join("\n\n");
}
