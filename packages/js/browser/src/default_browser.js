/**
 * Explicit bridge client for the operating system's default browser.
 *
 * HandoffKit cannot safely discover or control a browser profile by itself.
 * A host application may run a loopback bridge (usually an extension/native
 * host) that owns the default browser session and exposes POST /search and
 * POST /fetch. This client only sends bounded JSON requests to that bridge.
 * It never reads cookies, launches a browser, or falls back to HTTP.
 */

import {
  UserBrowserBridgeError,
  exploreUserBrowser,
  fetchUserBrowserPage,
  searchUserBrowser,
  searchUserBrowserMany,
} from "./user_browser.js";

export const DEFAULT_BROWSER_PROVIDER = "default_browser";
export const DEFAULT_BROWSER_BRIDGE_ENV = "HANDOFFKIT_DEFAULT_BROWSER_BRIDGE_URL";
export const DEFAULT_BROWSER_TOKEN_ENV = "HANDOFFKIT_DEFAULT_BROWSER_BRIDGE_TOKEN";

export class DefaultBrowserBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DefaultBrowserBridgeError";
    this.code = code;
  }
}

function env(name) {
  try {
    return typeof process !== "undefined" && process?.env ? process.env[name] || "" : "";
  } catch {
    return "";
  }
}

function bounded(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

function loopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

function normalizeEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { url: "", error: new DefaultBrowserBridgeError(
      "default_browser_bridge_required",
      `default_browser requires ${DEFAULT_BROWSER_BRIDGE_ENV} or an explicit endpoint`,
    ) };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: "", error: new DefaultBrowserBridgeError("default_browser_invalid_endpoint", "default_browser endpoint must be an absolute URL") };
  }
  const secure = parsed.protocol === "https:";
  if (parsed.protocol !== "http:" && !secure) {
    return { url: "", error: new DefaultBrowserBridgeError("default_browser_invalid_endpoint", "default_browser endpoint must use http(s)") };
  }
  if (!secure && !loopbackHost(parsed.hostname)) {
    return { url: "", error: new DefaultBrowserBridgeError(
      "default_browser_insecure_endpoint",
      "default_browser HTTP bridge must use localhost, 127.0.0.1, or ::1; use HTTPS for a remote bridge",
    ) };
  }
  parsed.hash = "";
  return { url: parsed.href.replace(/\/+$/, ""), error: null };
}

function endpointPath(base, path) {
  const suffix = String(path || "").replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

function errorPayload(kind, error) {
  const code = String(error?.code || "default_browser_error");
  const message = String(error?.message || error || code).replace(/\s+/g, " ").slice(0, 300);
  if (kind === "search") return { results: [], error_code: code, error: message };
  return {
    success: false,
    status: 0,
    url: "",
    final_url: "",
    html: "",
    text: "",
    markdown: "",
    links: [],
    errorCode: code,
    error_code: code,
    error: message,
    metadata: { transport: "default_browser_bridge" },
  };
}

async function readJsonResponse(response, maxResponseBytes) {
  const declared = Number(response?.headers?.get?.("content-length") || 0);
  if (declared > maxResponseBytes) {
    throw new DefaultBrowserBridgeError("default_browser_response_too_large", "default_browser bridge response exceeds the configured limit");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxResponseBytes) {
    throw new DefaultBrowserBridgeError("default_browser_response_too_large", "default_browser bridge response exceeds the configured limit");
  }
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new DefaultBrowserBridgeError("default_browser_invalid_response", "default_browser bridge returned invalid JSON");
  }
}

/**
 * Create a bridge backed by a host-controlled loopback/HTTPS service.
 *
 * Protocol:
 *   POST {endpoint}/search {query,max_results,timeout_ms}
 *   POST {endpoint}/fetch  {url,timeout_ms,...limits}
 * Responses are the normal UserBrowserBridge wire shapes.
 */
export function createDefaultBrowserBridge(options = {}) {
  const endpointResult = normalizeEndpoint(
    options.endpoint
      ?? options.url
      ?? options.bridgeUrl
      ?? options.bridge_url
      ?? env(DEFAULT_BROWSER_BRIDGE_ENV),
  );
  const token = String(options.token ?? options.authToken ?? env(DEFAULT_BROWSER_TOKEN_ENV) ?? "").trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutDefault = bounded(options.timeoutMs ?? options.timeout_ms, 20000, 1000, 120000);
  const maxResponseBytes = bounded(options.maxResponseBytes ?? options.max_response_bytes, 8_000_000, 1_024, 50_000_000);

  const request = async (path, payload, timeoutMs, kind) => {
    if (endpointResult.error) return errorPayload(kind, endpointResult.error);
    if (typeof fetchImpl !== "function") {
      return errorPayload(kind, new DefaultBrowserBridgeError("default_browser_fetch_unavailable", "default_browser requires a fetch-capable host"));
    }
    const timeout = bounded(timeoutMs, timeoutDefault, 1, 120000);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-HandoffKit-Bridge": "default-browser-v1",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetchImpl(endpointPath(endpointResult.url, path), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller?.signal,
      });
      const parsed = await readJsonResponse(response, maxResponseBytes);
      if (!response.ok) {
        const message = String(parsed?.error || `default_browser bridge HTTP ${response.status}`).slice(0, 300);
        return errorPayload(kind, new DefaultBrowserBridgeError("default_browser_http_error", message));
      }
      return parsed && typeof parsed === "object" ? parsed : errorPayload(kind, new DefaultBrowserBridgeError("default_browser_invalid_response", "default_browser bridge response must be an object or array"));
    } catch (error) {
      const normalized = error?.name === "AbortError"
        ? new DefaultBrowserBridgeError("default_browser_timeout", `default_browser bridge timed out after ${timeout}ms`)
        : error;
      return errorPayload(kind, normalized);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const bridge = {
    provider: DEFAULT_BROWSER_PROVIDER,
    endpoint: endpointResult.url,
    configured: !endpointResult.error,
    error: endpointResult.error ? endpointResult.error.message : "",
    async search(query, options = {}) {
      const maxResults = bounded(options.maxResults ?? options.max_results, 8, 1, 20);
      return request("/search", {
        query: String(query ?? "").trim(),
        max_results: maxResults,
        timeout_ms: bounded(options.timeoutMs ?? options.timeout_ms, timeoutDefault, 1, 120000),
      }, options.timeoutMs ?? options.timeout_ms, "search");
    },
    async fetch(url, options = {}) {
      return request("/fetch", {
        url: String(url ?? "").trim(),
        timeout_ms: bounded(options.timeoutMs ?? options.timeout_ms, timeoutDefault, 1, 120000),
        max_text_chars: bounded(options.maxTextChars ?? options.max_text_chars, 50000, 1, 500000),
        max_markdown_chars: bounded(options.maxMarkdownChars ?? options.max_markdown_chars, 60000, 1, 1000000),
        max_links_per_page: bounded(options.maxLinksPerPage ?? options.max_links_per_page, 100, 1, 1000),
      }, options.timeoutMs ?? options.timeout_ms, "fetch");
    },
    open(url, options = {}) {
      return this.fetch(url, options);
    },
  };
  return bridge;
}

export function isDefaultBrowserBridge(bridge) {
  return Boolean(bridge && bridge.provider === DEFAULT_BROWSER_PROVIDER && typeof bridge.search === "function");
}

function remapError(result, prefix) {
  if (!result || typeof result !== "object") return result;
  const out = { ...result };
  const code = String(out.error_code || out.errorCode || "");
  if (code === "user_browser_bridge_required") {
    out.error_code = `${prefix}_bridge_required`;
  } else if (code === "user_browser_invalid_response") {
    out.error_code = `${prefix}_invalid_response`;
  } else if (code === "user_browser_error") {
    out.error_code = `${prefix}_error`;
  }
  if (out.error_code) out.errorCode = out.error_code;
  return out;
}

export async function searchDefaultBrowser(bridge, query, options = {}) {
  if (!bridge) {
    const error = errorPayload(
      "search",
      new DefaultBrowserBridgeError(
        "default_browser_bridge_required",
        "default_browser requires an injected bridge or endpoint",
      ),
    );
    return { hits: [], error_code: error.error_code, error: error.error };
  }
  return remapError(await searchUserBrowser(bridge, query, options), DEFAULT_BROWSER_PROVIDER);
}

export async function searchDefaultBrowserMany(bridge, queries, options = {}) {
  if (!bridge) return {
    success: false,
    queries: [],
    hits: [],
    count: 0,
    query_results: [],
    errors: ["default_browser requires an injected bridge or endpoint"],
    error_codes: ["default_browser_bridge_required"],
    error_code: "default_browser_bridge_required",
    error: "default_browser requires an injected bridge or endpoint",
    metadata: { transport: "default_browser_bridge" },
  };
  const result = await searchUserBrowserMany(bridge, queries, options);
  return remapError(result, DEFAULT_BROWSER_PROVIDER);
}

export async function fetchDefaultBrowserPage(bridge, url, options = {}) {
  if (!bridge) return errorPayload("fetch", new DefaultBrowserBridgeError("default_browser_bridge_required", "default_browser requires an injected bridge or endpoint"));
  const result = await fetchUserBrowserPage(bridge, url, options);
  return remapError(result, DEFAULT_BROWSER_PROVIDER);
}

export async function exploreDefaultBrowser(bridge, startUrls, options = {}) {
  if (!bridge) {
    return {
      success: false,
      startUrl: Array.isArray(startUrls) ? String(startUrls[0] || "") : String(startUrls || ""),
      finalUrl: "",
      pagesFetched: 0,
      maxDepthReached: 0,
      title: "",
      text: "",
      markdown: "",
      links: [],
      steps: [],
      policy: options,
      error: "default_browser requires an injected bridge or endpoint",
      metadata: { transport: "default_browser_bridge", mode: "default_browser_explore", error_code: "default_browser_bridge_required" },
    };
  }
  const result = await exploreUserBrowser(bridge, startUrls, options);
  result.metadata = {
    ...(result.metadata || {}),
    transport: "default_browser_bridge",
    source: "system_default_browser",
    mode: "default_browser_explore",
  };
  for (const step of result.steps || []) {
    if (step.errorCode === "user_browser_fetch_bridge_required") step.errorCode = "default_browser_bridge_required";
    if (step.errorCode === "user_browser_fetch_error") step.errorCode = "default_browser_error";
  }
  return result;
}

export { UserBrowserBridgeError };
