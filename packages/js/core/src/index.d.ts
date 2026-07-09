export type Severity = "error" | "warning";

export const HANDOFFKIT_CORE_VERSION: "1.10.0";

export function toJSONValue(value: unknown): unknown;
export function toJSONString(value: unknown, space?: number): string;
export function serializeReport(
  report: { toJSON?: () => unknown; toMarkdown?: () => string } | unknown,
  options?: { format?: "json" | "object" | "json_object" | "markdown"; space?: number },
): string | unknown;
export function deserializeReport<T = ValidationReport>(
  value: unknown,
  ReportClass?: { fromJSON(value: unknown): T },
): T | unknown;

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

export class ContractParityReport {
  runtime: string;
  version: string;
  success: boolean;
  fixtureCount: number;
  schemaCount: number;
  supportedContracts: string[];
  missingFixtures: string[];
  missingSchemas: string[];
  metadata: Record<string, unknown>;
  constructor(init?: {
    runtime?: string;
    version?: string;
    success?: boolean;
    fixtureCount?: number;
    schemaCount?: number;
    supportedContracts?: string[];
    missingFixtures?: string[];
    missingSchemas?: string[];
    metadata?: Record<string, unknown>;
  });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
  static fromJSON(value: unknown): ContractParityReport;
}

export function buildContractParityReport(init?: {
  runtime?: string;
  version?: string;
  contractsRoot?: string;
  contractInventory?: { fixtures?: string[]; schemas?: string[] } | null;
  expectedFixtures?: string[];
  expectedSchemas?: string[];
}): Promise<ContractParityReport>;

export class ValidationIssue {
  code: string;
  message: string;
  field: string;
  severity: Severity;
  constructor(init: ValidationIssueInit);
  toJSON(): ValidationIssueInit;
  static fromJSON(value: unknown): ValidationIssue;
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
  static fromJSON(value: unknown): ValidationReport;
}

export class BaseProvider {
  model: string;
  constructor(init?: { model?: string });
  generate(prompt: string, kwargs?: Record<string, unknown>): string;
  agenerate(prompt: string, kwargs?: Record<string, unknown>): Promise<string>;
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

export interface HandoffStateWire {
  task: string;
  from_agent: string;
  to_agent: string;
  summary: string;
  decisions: string[];
  important_files: string[];
  errors: string[];
  next_steps: string[];
  context_refs: string[];
  metadata: Record<string, unknown>;
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
  static fromMarkdown(text: string): HandoffState;
  validateReport(): ValidationReport;
  validate(): this;
  toJSON(): HandoffStateWire;
  toWire(): HandoffStateWire;
  toCamelJSON(): Required<HandoffStateInit>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class EchoProvider extends BaseProvider {
  constructor(init?: { model?: string });
}

export class OpenAIProvider extends BaseProvider {
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
  constructor(init?: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    timeout?: number;
  });
}

export class OllamaProvider extends BaseProvider {
  baseUrl: string;
  timeout: number;
  constructor(init?: {
    model?: string;
    baseUrl?: string;
    timeout?: number;
  });
}

export class Agent {
  name: string;
  role: string;
  provider: { generate(prompt: string, kwargs?: Record<string, unknown>): string; agenerate?(prompt: string, kwargs?: Record<string, unknown>): Promise<string>; model?: string };
  metadata: Record<string, unknown>;
  constructor(init: { name: string; role?: string; provider?: BaseProvider; metadata?: Record<string, unknown> });
  run(task: string, options?: { context?: string | null }): AgentRunResult;
  arun(task: string, options?: { context?: string | null }): Promise<AgentRunResult>;
  runWithTools(task: string, options?: { tools?: Tool[]; toolCalls?: ToolCall[] | Record<string, unknown>; providerAdapter?: ProviderToolAdapter }): ToolAgentRunResult;
  arunWithTools(task: string, options?: { tools?: Tool[]; toolCalls?: ToolCall[] | Record<string, unknown>; providerAdapter?: ProviderToolAdapter }): Promise<ToolAgentRunResult>;
}

export class AgentRunResult {
  agentName: string;
  task: string;
  finalOutput: string;
  success: boolean;
  provider: string;
  model: string;
  constructor(init: { agentName: string; task: string; finalOutput: string; success?: boolean; provider?: string; model?: string });
  toJSON(): { agent_name: string; task: string; final_output: string; success: boolean; provider: string; model: string };
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): AgentRunResult;
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
  arun(task: string): Promise<TeamRunResult>;
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
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): TeamRunResult;
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
  validation: ValidationReport | null;
  metadata: Record<string, unknown>;
  constructor(init: { success: boolean; score: number; grade: string; metrics?: Array<{ name: string; score: number; weight: number; notes: string[] }>; recommendations?: string[]; validation?: ValidationReport | null; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
  static fromJSON(value: unknown): HandoffQualityReport;
}

export class TraceEvent {
  constructor(init: { kind: string; message: string; timestamp?: string; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): TraceEvent;
}

export class TraceStep {
  constructor(init: { name: string; agent?: string; task?: string; mode?: string; success?: boolean; output?: string; handoff?: HandoffState | null; toolResults?: unknown[]; tool_results?: unknown[]; events?: TraceEvent[]; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): TraceStep;
}

export class RunTrace {
  constructor(init?: { runId?: string; run_id?: string; name?: string; success?: boolean; finalOutput?: string; final_output?: string; steps?: TraceStep[]; handoffs?: HandoffState[]; metadata?: Record<string, unknown> });
  static fromTeamResult(result: TeamRunResult, options?: { name?: string }): RunTrace;
  static fromJSON(value: string | Record<string, unknown>): RunTrace;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
  toTimeline(): string;
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

export interface ToolInit {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute?: ((...args: unknown[]) => unknown) | null;
  metadata?: Record<string, unknown>;
}

export class Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: ((...args: unknown[]) => unknown) | null;
  metadata: Record<string, unknown>;
  constructor(init?: ToolInit);
  toSchema(): { name: string; description: string; parameters: Record<string, unknown> };
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): Tool;
}

export class ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  callId: string;
  provider: string;
  metadata: Record<string, unknown>;
  constructor(init?: { name?: string; tool_name?: string; arguments?: Record<string, unknown>; callId?: string; call_id?: string; id?: string; provider?: string; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): ToolCall;
}

export class ToolResult {
  name: string;
  callId: string;
  success: boolean;
  output: unknown;
  error: string;
  metadata: Record<string, unknown>;
  constructor(init?: { name?: string; tool_name?: string; callId?: string; call_id?: string; success?: boolean; output?: unknown; result?: unknown; error?: string; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): ToolResult;
}

export class ToolRegistry {
  constructor(tools?: Tool[]);
  register(tool: Tool): this;
  get(name: string): Tool | null;
  list(): Tool[];
  listSchemas(): Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  execute(call: ToolCall | { name: string; arguments?: Record<string, unknown>; callId?: string }): ToolResult;
  aexecute(call: ToolCall | { name: string; arguments?: Record<string, unknown>; callId?: string }): Promise<ToolResult>;
}

export class ToolAgentRunResult {
  agentResult: AgentRunResult;
  toolResults: ToolResult[];
  success: boolean;
  constructor(init: { agentResult: AgentRunResult; toolResults?: ToolResult[] });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): ToolAgentRunResult;
}

export type ProviderToolFormat = "handoffkit" | "openai" | "anthropic";

export class ProviderToolAdapter {
  providerFormat: ProviderToolFormat;
  constructor(init?: { providerFormat?: ProviderToolFormat });
  toolsToProviderFormat(tools: Array<Tool | Record<string, unknown>>, providerFormat?: ProviderToolFormat): Record<string, unknown>[];
  parseToolCalls(payload: unknown, providerFormat?: ProviderToolFormat): ToolCall[];
}

export class RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  retryStatusCodes: number[];
  constructor(init?: { maxAttempts?: number; baseDelayMs?: number; retryStatusCodes?: number[] });
  shouldRetry(error: unknown, attempt: number): boolean;
  run<T>(operation: (context: { attempt: number }) => Promise<T>): Promise<T>;
}

export function defineTool(init: {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute: (...args: unknown[]) => unknown;
}): Tool;

export interface ContextDocumentInit {
  path: string;
  content: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export class ContextDocument {
  path: string;
  content: string;
  summary: string;
  metadata: Record<string, unknown>;
  constructor(init?: ContextDocumentInit);
  toDict(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): ContextDocument;
}

export class ContextRetriever {
  documents: ContextDocument[];
  constructor(documents?: ContextDocument[]);
  search(query: string, options?: { limit?: number }): ContextDocument[];
}

export interface ContextPackInit {
  query: string;
  documents?: ContextDocument[];
  memories?: unknown[];
  summary?: string;
  metadata?: Record<string, unknown>;
}

export class ContextPack {
  query: string;
  documents: ContextDocument[];
  memories: unknown[];
  summary: string;
  metadata: Record<string, unknown>;
  constructor(init?: ContextPackInit);
  toDict(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
  static fromJSON(value: unknown): ContextPack;
}

export class ContextRunResult {
  finalOutput: string;
  contextUsed: ContextPack | null;
  memoriesUsed: unknown[];
  success: boolean;
  constructor(init?: { finalOutput: string; contextUsed?: ContextPack | null; memoriesUsed?: unknown[]; success?: boolean });
  toDict(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  static fromJSON(value: unknown): ContextRunResult;
}

export class EvaluationCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: Severity;
  metadata: Record<string, unknown>;
  constructor(init: { name: string; passed: boolean; message: string; severity?: Severity; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
}

export class EvaluationResult {
  target: string;
  success: boolean;
  checks: EvaluationCheck[];
  score: number;
  metadata: Record<string, unknown>;
  constructor(init: { target: string; success: boolean; checks?: EvaluationCheck[]; score?: number; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
}

export class WorkflowEvaluationReport {
  success: boolean;
  score: number;
  grade: string;
  results: EvaluationResult[];
  recommendations: string[];
  metadata: Record<string, unknown>;
  constructor(init: { success: boolean; score: number; grade: string; results?: EvaluationResult[]; recommendations?: string[]; metadata?: Record<string, unknown> });
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class WorkflowEvaluator {
  minScore: number;
  handoffMinScore: number;
  constructor(init?: { minScore?: number; handoffMinScore?: number });
  evaluate(target: unknown): WorkflowEvaluationReport;
  evaluateMany(targets: unknown[]): WorkflowEvaluationReport;
}
