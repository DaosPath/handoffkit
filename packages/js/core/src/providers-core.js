import { HANDOFFKIT_CORE_VERSION } from "./utils.js";

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_ERROR_BODY_CHARS = 8192;

export class BaseProvider {
  constructor({ model = "" } = {}) {
    this.model = model;
  }

  generate() {
    throw new Error(`${this.constructor.name}.generate() is not implemented.`);
  }

  async agenerate(prompt, kwargs = {}) {
    return this.generate(prompt, kwargs);
  }
}

export class EchoProvider extends BaseProvider {
  constructor({ model = "echo-js" } = {}) {
    super({ model });
  }

  generate(prompt) {
    return `Echo(${this.model}): ${prompt}`;
  }
}

/** Always-fail provider for offline fallback demos/tests. */
export class FailingProvider extends BaseProvider {
  constructor({ model = "fail", message = "forced failure" } = {}) {
    super({ model });
    this.message = message;
  }

  generate() {
    throw new Error(this.message);
  }
}

/** Try providers in order until one succeeds. */
export class FallbackProvider extends BaseProvider {
  constructor({ providers = [], model = "fallback" } = {}) {
    const chain = (Array.isArray(providers) ? providers : []).filter(Boolean);
    if (chain.length === 0) throw new Error("FallbackProvider requires at least one provider");
    super({ model: model || chain[0].model || "fallback" });
    this.providers = chain;
    this.lastErrors = [];
    this.selectedModel = "";
  }

  generate(prompt, kwargs = {}) {
    const errors = [];
    for (const provider of this.providers) {
      try {
        const output = provider.generate(prompt, kwargs);
        this.lastErrors = [...errors];
        this.selectedModel = provider.model || provider.constructor?.name || "unknown";
        return output;
      } catch (error) {
        errors.push(formatProviderError(provider, error));
      }
    }
    this.lastErrors = [...errors];
    this.selectedModel = "";
    throw new Error(`All fallback providers failed: ${errors.join("; ")}`);
  }

  async agenerate(prompt, kwargs = {}) {
    const errors = [];
    for (const provider of this.providers) {
      try {
        const generate = provider.agenerate?.bind(provider) ?? provider.generate?.bind(provider);
        if (!generate) throw new TypeError("provider has no generate method");
        const output = await generate(prompt, kwargs);
        this.lastErrors = [...errors];
        this.selectedModel = provider.model || provider.constructor?.name || "unknown";
        return output;
      } catch (error) {
        errors.push(formatProviderError(provider, error));
      }
    }
    this.lastErrors = [...errors];
    this.selectedModel = "";
    throw new Error(`All fallback providers failed: ${errors.join("; ")}`);
  }
}

export class OpenAIProvider extends BaseProvider {
  constructor({
    model = "",
    apiKey = "",
    baseUrl = "",
    headers = {},
    timeout = DEFAULT_TIMEOUT_MS,
    maxErrorBodyChars = DEFAULT_MAX_ERROR_BODY_CHARS,
    fetchImpl = undefined,
    userAgent = `handoffkit/${HANDOFFKIT_CORE_VERSION}`,
  } = {}) {
    const resolvedModel = model || readEnv("OPENAI_MODEL") || "gpt-4o-mini";
    super({ model: resolvedModel });
    this.apiKey = apiKey || readEnv("OPENAI_API_KEY");
    this.baseUrl = stripTrailingSlash(baseUrl || readEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1");
    this.headers = { ...headers };
    this.timeout = normalizeNonNegativeNumber(timeout, DEFAULT_TIMEOUT_MS);
    this.maxErrorBodyChars = normalizePositiveInteger(maxErrorBodyChars, DEFAULT_MAX_ERROR_BODY_CHARS);
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
    this.lastUsage = null;

    if (!this.apiKey) {
      throw new Error(
        "apiKey is required for OpenAIProvider. Set the environment variable OPENAI_API_KEY or pass apiKey explicitly.",
      );
    }
  }

  generate() {
    throw new Error(`${this.constructor.name}.generate() is not supported for network calls in JS. Use agenerate() instead.`);
  }

  async agenerate(prompt, kwargs = {}) {
    const {
      agent: _agent,
      task: _task,
      context: _context,
      signal,
      timeout = this.timeout,
      fetchImpl = this.fetchImpl,
      maxErrorBodyChars = this.maxErrorBodyChars,
      model,
      messages,
      temperature,
      max_tokens,
      top_p,
      stop,
      stream,
      headers = {},
      ...rest
    } = kwargs;

    const payload = {
      model: model || this.model,
      messages: messages || [{ role: "user", content: prompt }],
    };
    for (const [key, value] of Object.entries({ temperature, max_tokens, top_p, stop, stream })) {
      if (value !== undefined) payload[key] = value;
    }
    for (const [key, value] of Object.entries(rest)) {
      if (isJSONCompatible(value)) payload[key] = value;
    }

    const body = await requestJSON({
      fetchImpl: fetchImpl ?? globalThis.fetch,
      url: `${this.baseUrl}/chat/completions`,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
        ...this.headers,
        ...headers,
      },
      payload,
      signal,
      timeout,
      maxErrorBodyChars,
      secrets: [this.apiKey],
      providerName: "OpenAI",
    });
    this.lastUsage = body.usage || null;
    return contentToText(body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? "");
  }
}

export class OllamaProvider extends BaseProvider {
  constructor({
    model = "llama3.1",
    baseUrl = "http://localhost:11434",
    timeout = DEFAULT_TIMEOUT_MS,
    maxErrorBodyChars = DEFAULT_MAX_ERROR_BODY_CHARS,
    fetchImpl = undefined,
  } = {}) {
    super({ model });
    this.baseUrl = stripTrailingSlash(baseUrl);
    this.timeout = normalizeNonNegativeNumber(timeout, DEFAULT_TIMEOUT_MS);
    this.maxErrorBodyChars = normalizePositiveInteger(maxErrorBodyChars, DEFAULT_MAX_ERROR_BODY_CHARS);
    this.fetchImpl = fetchImpl;
  }

  generate() {
    throw new Error(`${this.constructor.name}.generate() is not supported for network calls in JS. Use agenerate() instead.`);
  }

  async agenerate(prompt, kwargs = {}) {
    const {
      agent: _agent,
      task: _task,
      context: _context,
      signal,
      timeout = this.timeout,
      fetchImpl = this.fetchImpl,
      maxErrorBodyChars = this.maxErrorBodyChars,
      headers = {},
      model,
      ...requestOptions
    } = kwargs;
    const payload = {
      model: model || this.model,
      prompt,
      stream: false,
    };
    for (const [key, value] of Object.entries(requestOptions)) {
      if (isJSONCompatible(value)) payload[key] = value;
    }

    const body = await requestJSON({
      fetchImpl: fetchImpl ?? globalThis.fetch,
      url: `${this.baseUrl}/api/generate`,
      headers: { "Content-Type": "application/json", ...headers },
      payload,
      signal,
      timeout,
      maxErrorBodyChars,
      providerName: "Ollama",
    });
    return typeof body.response === "string" ? body.response : "";
  }
}

async function requestJSON({
  fetchImpl,
  url,
  headers,
  payload,
  signal,
  timeout,
  maxErrorBodyChars,
  secrets = [],
  providerName,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available. Pass fetchImpl or use a runtime with global fetch.");
  }
  const request = createRequestSignal(signal, timeout);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: request.signal,
    });
    const { text: responseText, json: responseJSON } = await readResponseBody(response);
    if (!response.ok) {
      const detail = sanitizeError(redact(responseText, secrets), maxErrorBodyChars);
      const error = new Error(`${providerName} request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
      error.status = response.status;
      throw error;
    }
    if (responseJSON !== undefined) return responseJSON;
    if (!responseText) return {};
    try {
      return JSON.parse(responseText);
    } catch (cause) {
      const detail = sanitizeError(redact(responseText, secrets), maxErrorBodyChars);
      throw new Error(`${providerName} returned invalid JSON${detail ? `: ${detail}` : ""}`, { cause });
    }
  } catch (error) {
    if (request.signal.aborted || error?.name === "AbortError") {
      if (request.timedOut()) {
        const timedOut = new Error(`${providerName} request timed out after ${timeout}ms`, { cause: error });
        timedOut.name = "TimeoutError";
        timedOut.retryable = true;
        throw timedOut;
      }
      const aborted = new Error(`${providerName} request was aborted`, { cause: error });
      aborted.name = "AbortError";
      aborted.retryable = false;
      throw aborted;
    }
    if (error?.status) throw error;
    const detail = sanitizeError(redact(error?.message ?? String(error), secrets), maxErrorBodyChars);
    throw new Error(`${providerName} request failed${detail ? `: ${detail}` : ""}`, { cause: error });
  } finally {
    request.cleanup();
  }
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

function formatProviderError(provider, error) {
  return `${provider.model || provider.constructor?.name || "unknown"}: ${error?.message ?? String(error)}`;
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

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? "")).join("");
}

function isJSONCompatible(value) {
  if (value == null) return false;
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean" || Array.isArray(value) || (type === "object" && value.constructor === Object);
}

function sanitizeError(value, maxChars) {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const limit = normalizePositiveInteger(maxChars, DEFAULT_MAX_ERROR_BODY_CHARS);
  return text.length <= limit ? text : `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]`;
}

function redact(value, secrets) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) text = text.split(secret).join("[redacted]");
  }
  text = text.replace(/(bearer\s+)([^\s"']+)/gi, "$1[redacted]");
  return text;
}

function stripTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function readEnv(name) {
  return typeof process === "undefined" ? "" : process.env?.[name] || "";
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
