import { Agent, HandoffProtocol, HandoffState } from "@handoffkit/core";

export class RecipeStep {
  constructor(init: {
    name: string;
    task: string;
    agent?: Agent | null;
    useContext?: boolean;
    metadata?: Record<string, unknown>;
  });
  name: string;
  task: string;
  agent: Agent | null;
  useContext: boolean;
  metadata: Record<string, unknown>;
  toJSON(): Record<string, unknown>;
}

export class Recipe {
  constructor(init: {
    name: string;
    description?: string;
    steps?: Array<RecipeStep | ConstructorParameters<typeof RecipeStep>[0]>;
    metadata?: Record<string, unknown>;
  });
  name: string;
  description: string;
  steps: RecipeStep[];
  validate(): this;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class RecipeRunResult {
  recipeName: string;
  success: boolean;
  finalOutput: string;
  stepResults: Array<Record<string, unknown>>;
  handoffStates: HandoffState[];
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class RecipeRunner {
  constructor(recipe: Recipe, options?: { protocol?: HandoffProtocol });
  run(initialTask?: string): RecipeRunResult;
}

export class WorkflowTemplate {
  static sequential(init: {
    name: string;
    agents: Agent[];
    task: string;
    description?: string;
  }): Recipe;
  static planExecuteReview(init: {
    name: string;
    task: string;
    planner: Agent;
    executor: Agent;
    reviewer: Agent;
  }): Recipe;
}

export function planExecuteReviewRecipe(task?: string): Recipe;
