export const HANDOFFKIT_PROVIDERS_VERSION: "1.14.2";

export interface ProviderSpec {
  id: string;
  name: string;
  protocol: "openai-chat-completions";
  baseURL: string;
  chatCompletionsPath: string;
  apiKeyEnv: string;
  baseURLEnv: string;
  modelEnv: string;
  defaultModel: string;
  requiresApiKey: boolean;
  headers: Record<string, string>;
}

export const PROVIDER_SPECS: Readonly<Record<"openai-compatible" | "opencode" | "nvidia" | "groq" | "openrouter" | "ollama", ProviderSpec>>;
export const OPENAI_COMPATIBLE_SPEC: ProviderSpec;
export const OPENCODE_SPEC: ProviderSpec;
export const NVIDIA_SPEC: ProviderSpec;
export const GROQ_SPEC: ProviderSpec;
export const OPENROUTER_SPEC: ProviderSpec;
export const OLLAMA_SPEC: ProviderSpec;

export class ProviderConfigurationError extends Error {
  provider: string;
  constructor(message: string, init?: { provider?: string; cause?: unknown });
}

export class ProviderAPIError extends Error {
  provider: string;
  status: number;
  statusCode: number;
  body: string;
  retryable: boolean;
  aborted: boolean;
  timedOut: boolean;
  constructor(message: string, init?: {
    provider?: string;
    status?: number;
    body?: string;
    retryable?: boolean;
    aborted?: boolean;
    timedOut?: boolean;
    cause?: unknown;
  });
}

export class BaseProvider {
  id: string;
  name: string;
  model: string;
  metadata: Record<string, unknown>;
  constructor(init?: { id?: string; name?: string; model?: string; metadata?: Record<string, unknown> });
  isConfigured(): boolean;
  generate(prompt: unknown, options?: Record<string, unknown>): string;
  agenerate(prompt: unknown, options?: Record<string, unknown>): Promise<string>;
}

export class EchoProvider extends BaseProvider {
  prefix: string;
  constructor(init?: { id?: string; name?: string; model?: string; prefix?: string; metadata?: Record<string, unknown> });
}

export class FallbackProvider extends BaseProvider {
  providers: BaseProvider[];
  lastErrors: string[];
  selectedProvider: string;
  constructor(init?: { providers?: BaseProvider[]; name?: string; id?: string; metadata?: Record<string, unknown> });
}

export interface OpenAICompatibleProviderInit {
  provider?: keyof typeof PROVIDER_SPECS | string;
  id?: string;
  name?: string;
  spec?: Partial<ProviderSpec> | keyof typeof PROVIDER_SPECS | string | null;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxErrorBodyChars?: number;
  fetchImpl?: typeof fetch;
  retryPolicy?: RetryPolicy | null;
  requiresApiKey?: boolean;
  allowEnv?: boolean;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatCompletionOptions extends Record<string, unknown> {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxErrorBodyChars?: number;
  headers?: Record<string, string>;
  retryPolicy?: RetryPolicy;
  messages?: unknown[];
  path?: string;
  model?: string;
}

export class OpenAICompatibleProvider extends BaseProvider {
  spec: ProviderSpec;
  apiKey: string;
  baseURL: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxErrorBodyChars: number;
  fetchImpl?: typeof fetch;
  retryPolicy: RetryPolicy;
  requiresApiKey: boolean;
  userAgent: string;
  constructor(init?: OpenAICompatibleProviderInit);
  createChatCompletion(input: unknown, options?: ChatCompletionOptions): Promise<Record<string, unknown>>;
  assertConfigured(): void;
  buildHeaders(headers?: Record<string, string>): Record<string, string>;
  collectSecrets(headers?: Record<string, string>): string[];
}

export class RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitter: boolean;
  retryStatusCodes: number[];
  retryErrorNames: string[];
  sleepImpl: (ms: number) => Promise<void>;
  constructor(init?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    jitter?: boolean;
    retryStatusCodes?: number[];
    retryErrorNames?: string[];
    sleepImpl?: (ms: number) => Promise<void>;
  });
  shouldRetry(error: unknown, attempt: number): boolean;
  delayForAttempt(attempt: number): number;
  run<T>(
    operation: (context: { attempt: number; signal?: AbortSignal }) => Promise<T> | T,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
}

export class ProviderSelector {
  providers: BaseProvider[];
  defaultProvider: string;
  strategy: string;
  constructor(init?: { providers?: BaseProvider[]; defaultProvider?: string; strategy?: "first" | "first-configured" | string });
  add(provider: BaseProvider): this;
  list(): BaseProvider[];
  select(criteria?: { provider?: string; id?: string; model?: string; configured?: boolean }): BaseProvider;
  filter(criteria?: { provider?: string; id?: string; model?: string; configured?: boolean }): BaseProvider[];
}

export class ProviderRouter extends ProviderSelector {
  fallback: boolean;
  constructor(init?: { providers?: BaseProvider[]; defaultProvider?: string; strategy?: "first" | "first-configured" | string; fallback?: boolean });
  route(prompt: unknown, options?: Record<string, unknown> & { provider?: string; id?: string; model?: string; fallback?: boolean }): Promise<string>;
}

export function createProvider(provider: keyof typeof PROVIDER_SPECS | "echo" | string | BaseProvider, options?: OpenAICompatibleProviderInit): BaseProvider;
export function getProviderSpec(provider: keyof typeof PROVIDER_SPECS | string | Partial<ProviderSpec>): ProviderSpec;
export function listProviderSpecs(): ProviderSpec[];
export function redactSecrets(value: unknown, secrets?: string[]): string;
export function sanitizeErrorBody(value: unknown, maxChars?: number): string;
