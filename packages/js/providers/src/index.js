const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRY_STATUS_CODES = [408, 409, 425, 429, 500, 502, 503, 504];
const REDACTED = "[redacted]";

export const PROVIDER_SPECS = deepFreeze({
  "openai-compatible": {
    id: "openai-compatible",
    name: "OpenAI Compatible",
    protocol: "openai-chat-completions",
    baseURL: "https://api.openai.com/v1",
    chatCompletionsPath: "/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    baseURLEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini",
    requiresApiKey: true,
    headers: {},
  },
  opencode: {
    id: "opencode",
    name: "OpenCode Compatible",
    protocol: "openai-chat-completions",
    baseURL: "",
    chatCompletionsPath: "/chat/completions",
    apiKeyEnv: "OPENCODE_API_KEY",
    baseURLEnv: "OPENCODE_BASE_URL",
    modelEnv: "OPENCODE_MODEL",
    defaultModel: "",
    requiresApiKey: false,
    headers: {},
  },
  nvidia: {
    id: "nvidia",
    name: "NVIDIA NIM",
    protocol: "openai-chat-completions",
    baseURL: "https://integrate.api.nvidia.com/v1",
    chatCompletionsPath: "/chat/completions",
    apiKeyEnv: "NVIDIA_API_KEY",
    baseURLEnv: "NVIDIA_BASE_URL",
    modelEnv: "NVIDIA_MODEL",
    defaultModel: "nvidia/nemotron-3-super-120b-a12b",
    requiresApiKey: true,
    headers: {},
  },
  groq: {
    id: "groq",
    name: "Groq",
    protocol: "openai-chat-completions",
    baseURL: "https://api.groq.com/openai/v1",
    chatCompletionsPath: "/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    baseURLEnv: "GROQ_BASE_URL",
    modelEnv: "GROQ_MODEL",
    defaultModel: "",
    requiresApiKey: true,
    headers: {},
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai-chat-completions",
    baseURL: "https://openrouter.ai/api/v1",
    chatCompletionsPath: "/chat/completions",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseURLEnv: "OPENROUTER_BASE_URL",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "",
    requiresApiKey: true,
    headers: {},
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    protocol: "openai-chat-completions",
    baseURL: "http://localhost:11434/v1",
    chatCompletionsPath: "/chat/completions",
    apiKeyEnv: "OLLAMA_API_KEY",
    baseURLEnv: "OLLAMA_BASE_URL",
    modelEnv: "OLLAMA_MODEL",
    defaultModel: "llama3.1",
    requiresApiKey: false,
    headers: {},
  },
});

export const OPENAI_COMPATIBLE_SPEC = PROVIDER_SPECS["openai-compatible"];
export const OPENCODE_SPEC = PROVIDER_SPECS.opencode;
export const NVIDIA_SPEC = PROVIDER_SPECS.nvidia;
export const GROQ_SPEC = PROVIDER_SPECS.groq;
export const OPENROUTER_SPEC = PROVIDER_SPECS.openrouter;
export const OLLAMA_SPEC = PROVIDER_SPECS.ollama;

export class ProviderConfigurationError extends Error {
  constructor(message, { provider = "", cause = undefined } = {}) {
    super(message, { cause });
    this.name = "ProviderConfigurationError";
    this.provider = provider;
  }
}

export class ProviderAPIError extends Error {
  constructor(message, { provider = "", status = 0, body = "", retryable = false, cause = undefined } = {}) {
    super(message, { cause });
    this.name = "ProviderAPIError";
    this.provider = provider;
    this.status = status;
    this.statusCode = status;
    this.body = body;
    this.retryable = retryable;
  }
}

export class BaseProvider {
  constructor({ id = "", name = "", model = "", metadata = {} } = {}) {
    this.id = id || this.constructor.name;
    this.name = name || this.id;
    this.model = model;
    this.metadata = { ...metadata };
  }

  isConfigured() {
    return true;
  }

  generate() {
    throw new Error(`${this.constructor.name}.generate() is not implemented.`);
  }

  async agenerate(prompt, options = {}) {
    return this.generate(prompt, options);
  }
}

export class EchoProvider extends BaseProvider {
  constructor({ id = "echo", name = "Echo", model = "echo-js", prefix = "Echo", metadata = {} } = {}) {
    super({ id, name, model, metadata });
    this.prefix = prefix;
  }

  generate(prompt) {
    return `${this.prefix}(${this.model}): ${promptToText(prompt)}`;
  }
}

export class FallbackProvider extends BaseProvider {
  constructor({ providers = [], name = "Fallback", id = "fallback", metadata = {} } = {}) {
    const list = (Array.isArray(providers) ? providers : []).filter(Boolean);
    const firstModel = list[0]?.model ?? "";
    super({ id, name, model: firstModel, metadata });
    this.providers = list;
  }

  isConfigured() {
    return this.providers.length > 0 && this.providers.some((p) => p.isConfigured());
  }

  async agenerate(prompt, options = {}) {
    const configured = this.providers.filter((p) => p.isConfigured());
    if (configured.length === 0) {
      throw new ProviderConfigurationError("FallbackProvider has no configured underlying providers.", {
        provider: this.id,
      });
    }

    const errors = [];
    for (const provider of configured) {
      try {
        return await provider.agenerate(prompt, options);
      } catch (error) {
        errors.push(error);
      }
    }

    const messages = errors.map((e) => `[${e.provider || "unknown"}]: ${e.message}`).join("; ");
    throw new ProviderAPIError(`All fallback providers failed: ${messages}`, {
      provider: this.id,
      body: messages,
      cause: errors,
    });
  }
}

export class OpenAICompatibleProvider extends BaseProvider {
  constructor({
    provider = "openai-compatible",
    id = "",
    name = "",
    spec = null,
    model = undefined,
    apiKey = undefined,
    baseURL = undefined,
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = undefined,
    retryPolicy = null,
    requiresApiKey = undefined,
    allowEnv = true,
    userAgent = "handoffkit-providers/1.10.0",
    metadata = {},
  } = {}) {
    const resolvedSpec = normalizeSpec(spec ?? provider);
    const resolvedId = id || resolvedSpec.id || provider;
    const resolvedModel = firstDefined(
      model,
      allowEnv ? readEnv(resolvedSpec.modelEnv) : undefined,
      resolvedSpec.defaultModel
    );
    super({
      id: resolvedId,
      name: name || resolvedSpec.name || resolvedId,
      model: resolvedModel || "",
      metadata,
    });
    this.spec = resolvedSpec;
    this.apiKey = firstDefined(apiKey, allowEnv ? readEnv(resolvedSpec.apiKeyEnv) : undefined, "");
    this.baseURL = stripTrailingSlash(firstDefined(baseURL, allowEnv ? readEnv(resolvedSpec.baseURLEnv) : undefined, resolvedSpec.baseURL, ""));
    this.headers = { ...(resolvedSpec.headers ?? {}), ...headers };
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.retryPolicy = retryPolicy instanceof RetryPolicy ? retryPolicy : new RetryPolicy({ maxAttempts: 1 });
    this.requiresApiKey = requiresApiKey ?? Boolean(resolvedSpec.requiresApiKey);
    this.userAgent = userAgent;
  }

  isConfigured() {
    return Boolean(this.baseURL && this.model && (!this.requiresApiKey || this.apiKey));
  }

  generate() {
    throw new Error(`${this.constructor.name}.generate() uses HTTP. Use agenerate() instead.`);
  }

  async agenerate(prompt, options = {}) {
    const response = await this.createChatCompletion(prompt, options);
    return extractAssistantText(response);
  }

  async createChatCompletion(input, options = {}) {
    this.assertConfigured();
    const {
      fetchImpl = this.fetchImpl,
      signal = undefined,
      timeoutMs = this.timeoutMs,
      headers = {},
      retryPolicy = this.retryPolicy,
      messages = undefined,
      path = this.spec.chatCompletionsPath ?? "/chat/completions",
      ...requestOptions
    } = options;
    const fetchFn = fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      throw new ProviderConfigurationError("fetch is not available. Pass fetchImpl or run on a runtime with global fetch.", {
        provider: this.id,
      });
    }

    const payload = {
      model: requestOptions.model ?? this.model,
      messages: messages ?? promptToMessages(input),
      ...withoutTransportOptions(requestOptions),
    };
    const operation = () => this.postChatCompletion({
      fetchFn,
      url: joinURL(this.baseURL, path),
      payload,
      headers,
      timeoutMs,
      signal,
    });

    return retryPolicy.run(operation);
  }

  assertConfigured() {
    if (!this.baseURL) {
      throw new ProviderConfigurationError(`${this.name} baseURL is required. Pass baseURL explicitly.`, {
        provider: this.id,
      });
    }
    if (!this.model) {
      throw new ProviderConfigurationError(`${this.name} model is required. Pass model explicitly.`, {
        provider: this.id,
      });
    }
    if (this.requiresApiKey && !this.apiKey) {
      throw new ProviderConfigurationError(`${this.name} apiKey is required. Pass apiKey explicitly.`, {
        provider: this.id,
      });
    }
  }

  async postChatCompletion({ fetchFn, url, payload, headers, timeoutMs, signal }) {
    const controller = signal ? null : new AbortController();
    const requestSignal = signal ?? controller.signal;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const requestHeaders = this.buildHeaders(headers);
    const secrets = this.collectSecrets(requestHeaders);

    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: requestSignal,
      });
      if (timer) clearTimeout(timer);
      const responseText = await safeReadText(response);
      if (!response.ok) {
        const sanitizedBody = redactSecrets(responseText, secrets);
        throw new ProviderAPIError(
          `${this.name} request failed with HTTP ${response.status}: ${sanitizedBody}`,
          {
            provider: this.id,
            status: response.status,
            body: sanitizedBody,
            retryable: DEFAULT_RETRY_STATUS_CODES.includes(response.status),
          }
        );
      }
      return parseJSONResponse(responseText, this.id);
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (error?.name === "AbortError") {
        throw new ProviderAPIError(`${this.name} request timed out after ${timeoutMs}ms`, {
          provider: this.id,
          retryable: true,
          cause: error,
        });
      }
      if (error instanceof ProviderAPIError || error instanceof ProviderConfigurationError) {
        throw error;
      }
      throw new ProviderAPIError(`${this.name} request failed: ${redactSecrets(error?.message ?? String(error), secrets)}`, {
        provider: this.id,
        retryable: true,
        cause: error,
      });
    }
  }

  buildHeaders(headers = {}) {
    const result = {
      "Content-Type": "application/json",
      "User-Agent": this.userAgent,
      ...this.headers,
      ...headers,
    };
    if (this.apiKey && !hasHeader(result, "authorization")) {
      result.Authorization = `Bearer ${this.apiKey}`;
    }
    return result;
  }

  collectSecrets(headers = {}) {
    const secrets = [this.apiKey];
    for (const [key, value] of Object.entries(headers)) {
      if (/authorization|api[-_]?key|token|secret/i.test(key)) {
        secrets.push(value);
        if (typeof value === "string" && value.toLowerCase().startsWith("bearer ")) {
          secrets.push(value.slice(7));
        }
      }
    }
    return secrets.filter((value) => typeof value === "string" && value.length > 0);
  }
}

export class RetryPolicy {
  constructor({
    maxAttempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 5000,
    backoffFactor = 2,
    jitter = false,
    retryStatusCodes = DEFAULT_RETRY_STATUS_CODES,
    retryErrorNames = ["AbortError"],
    sleepImpl = sleep,
  } = {}) {
    this.maxAttempts = Math.max(1, maxAttempts);
    this.baseDelayMs = Math.max(0, baseDelayMs);
    this.maxDelayMs = Math.max(0, maxDelayMs);
    this.backoffFactor = Math.max(1, backoffFactor);
    this.jitter = Boolean(jitter);
    this.retryStatusCodes = [...retryStatusCodes];
    this.retryErrorNames = [...retryErrorNames];
    this.sleepImpl = sleepImpl;
  }

  shouldRetry(error, attempt) {
    if (attempt >= this.maxAttempts) return false;
    const status = error?.status ?? error?.statusCode;
    if (status) return this.retryStatusCodes.includes(status);
    if (error?.retryable === true) return true;
    if (error?.name) return this.retryErrorNames.includes(error.name);
    return false;
  }

  delayForAttempt(attempt) {
    const raw = this.baseDelayMs * this.backoffFactor ** Math.max(0, attempt - 1);
    const capped = Math.min(raw, this.maxDelayMs || raw);
    if (!this.jitter || capped === 0) return capped;
    return Math.floor(capped * (0.5 + Math.random() * 0.5));
  }

  async run(operation) {
    let attempt = 1;
    for (;;) {
      try {
        return await operation({ attempt });
      } catch (error) {
        if (!this.shouldRetry(error, attempt)) throw error;
        await this.sleepImpl(this.delayForAttempt(attempt));
        attempt += 1;
      }
    }
  }
}

export class ProviderSelector {
  constructor({ providers = [], defaultProvider = "", strategy = "first-configured" } = {}) {
    this.providers = [...providers];
    this.defaultProvider = defaultProvider;
    this.strategy = strategy;
  }

  add(provider) {
    this.providers.push(provider);
    return this;
  }

  list() {
    return [...this.providers];
  }

  select(criteria = {}) {
    const candidates = this.filter(criteria);
    if (candidates.length === 0) {
      throw new ProviderConfigurationError("No provider matched the requested criteria.");
    }
    if (this.strategy === "first") return candidates[0];
    return candidates.find((provider) => provider.isConfigured?.() !== false) ?? candidates[0];
  }

  filter({ provider = "", id = "", model = "", configured = undefined } = {}) {
    const requested = provider || id || this.defaultProvider;
    return this.providers.filter((candidate) => {
      if (requested && candidate.id !== requested && candidate.name !== requested) return false;
      if (model && candidate.model !== model) return false;
      if (configured !== undefined && Boolean(candidate.isConfigured?.()) !== Boolean(configured)) return false;
      return true;
    });
  }
}

export class ProviderRouter extends ProviderSelector {
  constructor({ providers = [], defaultProvider = "", strategy = "first-configured", fallback = true } = {}) {
    super({ providers, defaultProvider, strategy });
    this.fallback = Boolean(fallback);
  }

  async route(prompt, options = {}) {
    const { provider = "", id = "", model = "", fallback = this.fallback, ...generateOptions } = options;
    const candidates = this.filter({ provider, id, model });
    if (candidates.length === 0) {
      throw new ProviderConfigurationError("No provider matched the requested route.");
    }

    const errors = [];
    for (const candidate of candidates) {
      try {
        const generate = candidate.agenerate?.bind(candidate) ?? candidate.generate.bind(candidate);
        return await generate(prompt, generateOptions);
      } catch (error) {
        errors.push(error);
        if (!fallback) throw error;
      }
    }

    const detail = errors.map((error) => error.message).join("; ");
    throw new ProviderAPIError(`All provider routes failed: ${detail}`, {
      provider: provider || id,
      retryable: errors.some((error) => error.retryable),
      cause: errors[0],
    });
  }
}

export function createProvider(provider, options = {}) {
  if (provider instanceof BaseProvider) return provider;
  if (provider === "echo") return new EchoProvider(options);
  return new OpenAICompatibleProvider({ provider, ...options });
}

export function getProviderSpec(provider) {
  return normalizeSpec(provider);
}

export function listProviderSpecs() {
  return Object.values(PROVIDER_SPECS).map((spec) => ({ ...spec, headers: { ...(spec.headers ?? {}) } }));
}

export function redactSecrets(value, secrets = []) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(secret).join(REDACTED);
  }
  text = text.replace(/(bearer\s+)([a-z0-9._~+/-]+)/gi, `$1${REDACTED}`);
  text = text.replace(/("?(?:api[_-]?key|token|secret)"?\s*[:=]\s*"?)([^"',}\s]+)("?)/gi, `$1${REDACTED}$3`);
  return text;
}

function normalizeSpec(specOrId) {
  if (!specOrId) return PROVIDER_SPECS["openai-compatible"];
  if (typeof specOrId === "string") {
    const spec = PROVIDER_SPECS[specOrId];
    if (!spec) {
      throw new ProviderConfigurationError(`Unknown provider spec: ${specOrId}`);
    }
    return spec;
  }
  return {
    ...PROVIDER_SPECS["openai-compatible"],
    ...specOrId,
    headers: { ...(specOrId.headers ?? {}) },
  };
}

function promptToMessages(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object" && Array.isArray(input.messages)) return input.messages;
  return [{ role: "user", content: promptToText(input) }];
}

function promptToText(input) {
  if (typeof input === "string") return input;
  if (input == null) return "";
  if (Array.isArray(input)) {
    return input.map((message) => message?.content ?? "").join("\n");
  }
  if (typeof input.content === "string") return input.content;
  return JSON.stringify(input);
}

function withoutTransportOptions(options) {
  const copy = { ...options };
  delete copy.fetchImpl;
  delete copy.signal;
  delete copy.timeoutMs;
  delete copy.headers;
  delete copy.retryPolicy;
  delete copy.path;
  delete copy.agent;
  delete copy.task;
  delete copy.context;
  return copy;
}

function extractAssistantText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  const choice = response?.choices?.[0];
  if (!choice) return "";
  if (typeof choice.text === "string") return choice.text;
  return contentToText(choice.message?.content ?? choice.delta?.content ?? "");
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (typeof part?.text === "string") return part.text;
    if (typeof part?.content === "string") return part.content;
    return "";
  }).join("");
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch (_) {
    return "";
  }
}

function parseJSONResponse(text, provider) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProviderAPIError(`${provider} returned invalid JSON.`, {
      provider,
      body: text,
      cause: error,
    });
  }
}

function hasHeader(headers, wanted) {
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted.toLowerCase());
}

function joinURL(baseURL, path) {
  return `${stripTrailingSlash(baseURL)}/${String(path).replace(/^\/+/, "")}`;
}

function stripTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function readEnv(name) {
  if (!name || typeof process === "undefined") return undefined;
  return process.env?.[name];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const item of Object.values(value)) {
    deepFreeze(item);
  }
  return value;
}
