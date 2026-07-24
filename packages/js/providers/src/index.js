export const HANDOFFKIT_PROVIDERS_VERSION = "1.14.2";

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_ERROR_BODY_CHARS = 8192;
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
  constructor(
    message,
    {
      provider = "",
      status = 0,
      body = "",
      retryable = false,
      aborted = false,
      timedOut = false,
      cause = undefined,
    } = {},
  ) {
    super(message, { cause });
    this.name = "ProviderAPIError";
    this.provider = provider;
    this.status = status;
    this.statusCode = status;
    this.body = body;
    this.retryable = retryable;
    this.aborted = aborted;
    this.timedOut = timedOut;
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
    super({ id, name, model: list[0]?.model ?? "", metadata });
    this.providers = list;
    this.lastErrors = [];
    this.selectedProvider = "";
  }

  isConfigured() {
    return this.providers.length > 0 && this.providers.some((provider) => provider.isConfigured?.() !== false);
  }

  async agenerate(prompt, options = {}) {
    const configured = this.providers.filter((provider) => provider.isConfigured?.() !== false);
    if (configured.length === 0) {
      throw new ProviderConfigurationError("FallbackProvider has no configured underlying providers.", {
        provider: this.id,
      });
    }

    const errors = [];
    for (const provider of configured) {
      try {
        const output = await provider.agenerate(prompt, options);
        this.lastErrors = errors.map(formatProviderError);
        this.selectedProvider = provider.id || provider.name || provider.constructor?.name || "unknown";
        return output;
      } catch (error) {
        errors.push(error);
      }
    }

    const messages = errors.map(formatProviderError);
    this.lastErrors = [...messages];
    this.selectedProvider = "";
    const detail = messages.join("; ");
    throw new ProviderAPIError(`All fallback providers failed: ${detail}`, {
      provider: this.id,
      body: detail,
      retryable: errors.some((error) => error?.retryable === true),
      cause: errors[0],
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
    maxErrorBodyChars = DEFAULT_MAX_ERROR_BODY_CHARS,
    fetchImpl = undefined,
    retryPolicy = null,
    requiresApiKey = undefined,
    allowEnv = true,
    userAgent = `handoffkit-providers/${HANDOFFKIT_PROVIDERS_VERSION}`,
    metadata = {},
  } = {}) {
    const resolvedSpec = normalizeSpec(spec ?? provider);
    const resolvedId = id || resolvedSpec.id || provider;
    const resolvedModel = firstDefined(
      model,
      allowEnv ? readEnv(resolvedSpec.modelEnv) : undefined,
      resolvedSpec.defaultModel,
    );
    super({
      id: resolvedId,
      name: name || resolvedSpec.name || resolvedId,
      model: resolvedModel || "",
      metadata,
    });
    this.spec = resolvedSpec;
    this.apiKey = firstDefined(apiKey, allowEnv ? readEnv(resolvedSpec.apiKeyEnv) : undefined, "");
    this.baseURL = stripTrailingSlash(
      firstDefined(baseURL, allowEnv ? readEnv(resolvedSpec.baseURLEnv) : undefined, resolvedSpec.baseURL, ""),
    );
    this.headers = { ...(resolvedSpec.headers ?? {}), ...headers };
    this.timeoutMs = normalizeNonNegativeNumber(timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxErrorBodyChars = normalizePositiveInteger(maxErrorBodyChars, DEFAULT_MAX_ERROR_BODY_CHARS);
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
      maxErrorBodyChars = this.maxErrorBodyChars,
      ...requestOptions
    } = options;
    const fetchFn = fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      throw new ProviderConfigurationError(
        "fetch is not available. Pass fetchImpl or run on a runtime with global fetch.",
        { provider: this.id },
      );
    }
    if (!(retryPolicy instanceof RetryPolicy)) {
      throw new ProviderConfigurationError("retryPolicy must be an instance of RetryPolicy.", { provider: this.id });
    }

    const payload = {
      model: requestOptions.model ?? this.model,
      messages: messages ?? promptToMessages(input),
      ...withoutTransportOptions(requestOptions),
    };
    const operation = () =>
      this.postChatCompletion({
        fetchFn,
        url: joinURL(this.baseURL, path),
        payload,
        headers,
        timeoutMs,
        maxErrorBodyChars,
        signal,
      });

    return retryPolicy.run(operation, { signal });
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

  async postChatCompletion({ fetchFn, url, payload, headers, timeoutMs, maxErrorBodyChars, signal }) {
    const request = createRequestSignal(signal, timeoutMs);
    const requestHeaders = this.buildHeaders(headers);
    const secrets = this.collectSecrets(requestHeaders);

    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: request.signal,
      });
      const { text: responseText, json: responseJSON } = await readResponseBody(response);
      if (!response.ok) {
        const sanitizedBody = sanitizeErrorBody(redactSecrets(responseText, secrets), maxErrorBodyChars);
        throw new ProviderAPIError(
          `${this.name} request failed with HTTP ${response.status}${sanitizedBody ? `: ${sanitizedBody}` : ""}`,
          {
            provider: this.id,
            status: response.status,
            body: sanitizedBody,
            retryable: DEFAULT_RETRY_STATUS_CODES.includes(response.status),
          },
        );
      }
      return responseJSON ?? parseJSONResponse(responseText, this.id, maxErrorBodyChars, secrets);
    } catch (error) {
      if (error instanceof ProviderAPIError || error instanceof ProviderConfigurationError) throw error;
      if (request.signal.aborted || error?.name === "AbortError") {
        if (request.timedOut()) {
          throw new ProviderAPIError(`${this.name} request timed out after ${timeoutMs}ms`, {
            provider: this.id,
            retryable: true,
            timedOut: true,
            cause: error,
          });
        }
        throw new ProviderAPIError(`${this.name} request was aborted`, {
          provider: this.id,
          retryable: false,
          aborted: true,
          cause: error,
        });
      }
      const detail = sanitizeErrorBody(redactSecrets(error?.message ?? String(error), secrets), maxErrorBodyChars);
      throw new ProviderAPIError(`${this.name} request failed${detail ? `: ${detail}` : ""}`, {
        provider: this.id,
        retryable: true,
        cause: error,
      });
    } finally {
      request.cleanup();
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
    this.maxAttempts = normalizePositiveInteger(maxAttempts, 3);
    this.baseDelayMs = normalizeNonNegativeNumber(baseDelayMs, 250);
    this.maxDelayMs = normalizeNonNegativeNumber(maxDelayMs, 5000);
    this.backoffFactor = Math.max(1, Number(backoffFactor) || 1);
    this.jitter = Boolean(jitter);
    this.retryStatusCodes = [...retryStatusCodes];
    this.retryErrorNames = [...retryErrorNames];
    this.sleepImpl = sleepImpl;
  }

  shouldRetry(error, attempt) {
    if (attempt >= this.maxAttempts || error?.aborted === true) return false;
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

  async run(operation, { signal } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      throwIfAborted(signal);
      try {
        return await operation({ attempt, signal });
      } catch (error) {
        if (!this.shouldRetry(error, attempt)) throw error;
        await waitWithSignal(this.sleepImpl, this.delayForAttempt(attempt), signal);
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
        const generate = candidate.agenerate?.bind(candidate) ?? candidate.generate?.bind(candidate);
        if (!generate) throw new TypeError("Provider has no generate or agenerate method.");
        return await generate(prompt, generateOptions);
      } catch (error) {
        errors.push(error);
        if (!fallback) throw error;
      }
    }

    const detail = errors.map((error) => error?.message ?? String(error)).join("; ");
    throw new ProviderAPIError(`All provider routes failed: ${detail}`, {
      provider: provider || id,
      retryable: errors.some((error) => error?.retryable === true),
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
  if (typeof text !== "string") text = value == null ? "" : String(value);
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length === 0) continue;
    text = text.split(secret).join(REDACTED);
  }
  text = text.replace(/(bearer\s+)([a-z0-9._~+/-]+)/gi, `$1${REDACTED}`);
  text = text.replace(/("?(?:api[_-]?key|token|secret)"?\s*[:=]\s*"?)([^"',}\s]+)("?)/gi, `$1${REDACTED}$3`);
  return text;
}

export function sanitizeErrorBody(value, maxChars = DEFAULT_MAX_ERROR_BODY_CHARS) {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const limit = normalizePositiveInteger(maxChars, DEFAULT_MAX_ERROR_BODY_CHARS);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]`;
}

function normalizeSpec(specOrId) {
  if (!specOrId) return PROVIDER_SPECS["openai-compatible"];
  if (typeof specOrId === "string") {
    const spec = PROVIDER_SPECS[specOrId];
    if (!spec) throw new ProviderConfigurationError(`Unknown provider spec: ${specOrId}`);
    return spec;
  }
  if (typeof specOrId !== "object" || Array.isArray(specOrId)) {
    throw new ProviderConfigurationError("Provider spec must be a provider id or object.");
  }
  return {
    ...PROVIDER_SPECS["openai-compatible"],
    ...specOrId,
    headers: { ...(specOrId.headers ?? {}) },
  };
}

function createRequestSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let didTimeout = false;
  let didExternalAbort = false;
  const onExternalAbort = () => {
    didExternalAbort = true;
    controller.abort(externalSignal?.reason);
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const normalizedTimeout = normalizeNonNegativeNumber(timeoutMs, DEFAULT_TIMEOUT_MS);
  const timer = normalizedTimeout > 0
    ? setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, normalizedTimeout)
    : null;
  return {
    signal: controller.signal,
    timedOut: () => didTimeout && !didExternalAbort,
    cleanup() {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", onExternalAbort);
    },
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Operation was aborted");
  error.name = "AbortError";
  throw error;
}

async function waitWithSignal(sleepImpl, ms, signal) {
  throwIfAborted(signal);
  if (!signal) {
    await sleepImpl(ms);
    return;
  }
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      const error = new Error("Operation was aborted");
      error.name = "AbortError";
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([Promise.resolve(sleepImpl(ms)), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function promptToMessages(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object" && Array.isArray(input.messages)) return input.messages;
  return [{ role: "user", content: promptToText(input) }];
}

function promptToText(input) {
  if (typeof input === "string") return input;
  if (input == null) return "";
  if (Array.isArray(input)) return input.map((message) => message?.content ?? "").join("\n");
  if (typeof input.content === "string") return input.content;
  return JSON.stringify(input);
}

function withoutTransportOptions(options) {
  const copy = { ...options };
  for (const key of [
    "fetchImpl",
    "signal",
    "timeoutMs",
    "maxErrorBodyChars",
    "headers",
    "retryPolicy",
    "path",
    "agent",
    "task",
    "context",
  ]) {
    delete copy[key];
  }
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
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    })
    .join("");
}

async function readResponseBody(response) {
  if (typeof response?.text === "function") {
    return { text: await response.text(), json: undefined };
  }
  if (typeof response?.json === "function") {
    const json = await response.json();
    return { text: JSON.stringify(json), json };
  }
  return { text: "", json: undefined };
}

function parseJSONResponse(text, provider, maxChars, secrets) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    const body = sanitizeErrorBody(redactSecrets(text, secrets), maxChars);
    throw new ProviderAPIError(`${provider} returned invalid JSON${body ? `: ${body}` : ""}`, {
      provider,
      body,
      cause: error,
    });
  }
}

function formatProviderError(error) {
  return `[${error?.provider || "unknown"}]: ${error?.message ?? String(error)}`;
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

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
