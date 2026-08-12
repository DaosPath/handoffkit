/**
 * Explicit bridge contract for a host application's already-authorized browser.
 *
 * The browser package never discovers profiles, reads cookies, opens tabs, or
 * talks to an engine by itself. A host must inject an object with
 * `search(query, options)`. The method may return an array of hits or
 * `{ results: [...] }`; each hit is reduced to a safe http(s) URL and title.
 */

export const USER_BROWSER_PROVIDER = "user_browser";

export class UserBrowserBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UserBrowserBridgeError";
    this.code = code;
  }
}

export function isUserBrowserBridge(bridge) {
  return Boolean(bridge && typeof bridge.search === "function");
}

function asPositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function normalizeHit(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = String(raw.url ?? raw.href ?? raw.link ?? "").trim();
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.hash = "";
  const title = String(raw.title ?? raw.name ?? raw.text ?? "").trim();
  return {
    title: title || parsed.href,
    url: parsed.href,
  };
}

/**
 * Execute one explicit user-browser search and return a normalized result.
 *
 * This function is deliberately total: bridge/configuration failures become a
 * structured error so callers can distinguish unavailable user-browser access
 * from an empty result set.
 */
export async function searchUserBrowser(bridge, query, options = {}) {
  const q = String(query ?? "").trim();
  if (!q) {
    return { hits: [], error_code: "query_required", error: "query is required" };
  }
  if (!isUserBrowserBridge(bridge)) {
    return {
      hits: [],
      error_code: "user_browser_bridge_required",
      error: "user_browser requires an injected search bridge",
    };
  }

  const maxResults = asPositiveInt(options.maxResults ?? options.max_results, 8, 8);
  const timeoutMs = asPositiveInt(options.timeoutMs ?? options.timeout_ms, 20000, 60000);
  try {
    const response = await bridge.search(q, {
      maxResults,
      max_results: maxResults,
      timeoutMs,
      timeout_ms: timeoutMs,
      signal: options.signal,
    });
    const rawHits = Array.isArray(response) ? response : response?.results;
    if (!Array.isArray(rawHits)) {
      return {
        hits: [],
        error_code: "user_browser_invalid_response",
        error: "user_browser bridge must return an array or { results }",
      };
    }
    const hits = [];
    const seen = new Set();
    for (const raw of rawHits) {
      const hit = normalizeHit(raw);
      if (!hit || seen.has(hit.url)) continue;
      seen.add(hit.url);
      hits.push(hit);
      if (hits.length >= maxResults) break;
    }
    return {
      hits,
      error_code: String(response?.error_code ?? ""),
      error: String(response?.error ?? ""),
    };
  } catch (error) {
    const code = String(error?.code ?? "user_browser_error");
    const message = String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 240);
    return { hits: [], error_code: code, error: message || code };
  }
}
