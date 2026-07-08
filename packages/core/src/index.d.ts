export type Severity = "error" | "warning";

export interface ValidationIssueInit {
  code: string;
  message: string;
  field?: string;
  severity?: Severity;
}

export class HandoffValidationError extends Error {
  report: ValidationReport;
  constructor(message: string, report: ValidationReport);
}

export class ValidationIssue {
  code: string;
  message: string;
  field: string;
  severity: Severity;
  constructor(init: ValidationIssueInit);
  toJSON(): ValidationIssueInit;
}

export class ValidationReport {
  success: boolean;
  issues: ValidationIssue[];
  metadata: Record<string, unknown>;
  constructor(init?: { success?: boolean; issues?: ValidationIssueInit[]; metadata?: Record<string, unknown> });
  static fromIssues(issues: ValidationIssueInit[], metadata?: Record<string, unknown>): ValidationReport;
  toJSON(): { success: boolean; issues: ValidationIssueInit[]; metadata: Record<string, unknown> };
  toJSONString(space?: number): string;
  toMarkdown(): string;
  raiseIfFailed(): this;
}

export interface HandoffStateInit {
  task?: string;
  fromAgent?: string;
  toAgent?: string;
  summary?: string;
  decisions?: string[];
  importantFiles?: string[];
  errors?: string[];
  nextSteps?: string[];
  contextRefs?: string[];
  metadata?: Record<string, unknown>;
}

export class HandoffState {
  task: string;
  fromAgent: string;
  toAgent: string;
  summary: string;
  decisions: string[];
  importantFiles: string[];
  errors: string[];
  nextSteps: string[];
  contextRefs: string[];
  metadata: Record<string, unknown>;
  constructor(init?: HandoffStateInit);
  static fromJSON(value: string | Record<string, unknown>): HandoffState;
  validateReport(): ValidationReport;
  validate(): this;
  toJSON(): Required<HandoffStateInit>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class EchoProvider {
  model: string;
  constructor(init?: { model?: string });
  generate(prompt: string, kwargs?: Record<string, unknown>): string;
}

export class Agent {
  name: string;
  role: string;
  provider: { generate(prompt: string, kwargs?: Record<string, unknown>): string; model?: string };
  metadata: Record<string, unknown>;
  constructor(init: { name: string; role?: string; provider?: EchoProvider; metadata?: Record<string, unknown> });
  run(task: string, options?: { context?: string | null }): AgentRunResult;
}

export class AgentRunResult {
  agentName: string;
  task: string;
  finalOutput: string;
  success: boolean;
  provider: string;
  model: string;
  constructor(init: { agentName: string; task: string; finalOutput: string; success?: boolean; provider?: string; model?: string });
  toJSON(): Record<string, unknown>;
}

export class HandoffProtocol {
  mode: string;
  constructor(init?: { mode?: string });
  transfer(init: HandoffStateInit & { fromAgent?: Agent | string; toAgent?: Agent | string }): HandoffState;
}

export class Team {
  agents: Agent[];
  protocol: HandoffProtocol;
  metadata: Record<string, unknown>;
  constructor(init: { agents: Agent[]; protocol?: HandoffProtocol; metadata?: Record<string, unknown> });
  run(task: string): TeamRunResult;
}

export class TeamRunResult {
  success: boolean;
  task: string;
  finalOutput: string;
  stepResults: AgentRunResult[];
  handoffs: HandoffState[];
  metadata: Record<string, unknown>;
  constructor(init: { success: boolean; task: string; finalOutput: string; stepResults?: AgentRunResult[]; handoffs?: HandoffState[]; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
}

export class HandoffQualityEvaluator {
  minScore: number;
  constructor(init?: { minScore?: number });
  evaluate(state: HandoffState | Record<string, unknown>): HandoffQualityReport;
}

export class HandoffQualityReport {
  success: boolean;
  score: number;
  grade: string;
  metrics: Array<{ name: string; score: number; weight: number; notes: string[] }>;
  recommendations: string[];
  validation: ValidationReport;
  constructor(init: { success: boolean; score: number; grade: string; metrics?: Array<{ name: string; score: number; weight: number; notes: string[] }>; recommendations?: string[]; validation: ValidationReport });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class TraceEvent {
  constructor(init: { kind: string; message: string; timestamp?: string; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
}

export class TraceStep {
  constructor(init: { name: string; agent?: string; task?: string; mode?: string; success?: boolean; output?: string; handoff?: HandoffState | null; toolResults?: unknown[]; events?: TraceEvent[]; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
}

export class RunTrace {
  constructor(init?: { runId?: string; name?: string; success?: boolean; finalOutput?: string; steps?: TraceStep[]; handoffs?: HandoffState[]; metadata?: Record<string, unknown> });
  static fromTeamResult(result: TeamRunResult, options?: { name?: string }): RunTrace;
  static fromJSON(value: string | Record<string, unknown>): RunTrace;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class ReplayRunner {
  constructor(trace: RunTrace | Record<string, unknown>);
  summary(): {
    success: boolean;
    stepCount: number;
    handoffCount: number;
    toolResultCount: number;
    finalOutput: string;
    metadata: Record<string, unknown>;
  };
}

export function defineTool(init: {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute: (...args: unknown[]) => unknown;
}): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (...args: unknown[]) => unknown;
  toSchema(): { name: string; description: string; parameters: Record<string, unknown> };
};
