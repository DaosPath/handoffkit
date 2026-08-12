/**
 * Explicit bridge contract for a host application's already-authorized browser.
 *
 * The browser package never discovers profiles, reads cookies, opens tabs, or
 * talks to an engine by itself. A host must inject an object with
 * `search(query, options)`, plus optional `fetch(url, options)` or
 * `open(url, options)` for page access. The page methods are intentionally
 * explicit: this module never discovers browser profiles, reads cookies, or
 * falls back to an HTTP transport when the user-browser route is selected.
 * Search responses may be an array of hits or `{ results: [...] }`; each hit
 * is reduced to a safe http(s) URL and title.
 */

import { extractPage } from "./html_extract.js";
import {
  ExplorePolicy,
  hostAllowed,
  normalizeHost,
  parseUrl,
  urlAllowed,
} from "./types.js";
import { canonicalUrl, smartTruncate } from "./util.js";

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

export function isUserBrowserPageBridge(bridge) {
  return Boolean(
    bridge && (typeof bridge.fetch === "function" || typeof bridge.open === "function"),
  );
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

function asBoundedInt(value, fallback, minimum, maximum) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(n), maximum));
}

function timeoutPromise(promise, timeoutMs) {
  const timeout = asBoundedInt(timeoutMs, 20000, 1, 120000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new UserBrowserBridgeError(
        "user_browser_timeout",
        `user_browser operation timed out after ${timeout}ms`,
      ));
    }, timeout);
    // Avoid keeping a Node process alive only for a bridge timeout.
    if (typeof timer?.unref === "function") timer.unref();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizePageLink(raw, baseUrl) {
  const source = typeof raw === "string" ? { href: raw } : raw;
  if (!source || typeof source !== "object") return null;
  const rawHref = String(
    source.absolute ?? source.url ?? source.href ?? source.link ?? "",
  ).trim();
  if (!rawHref) return null;
  let resolved;
  try {
    resolved = new URL(rawHref, baseUrl || undefined);
  } catch {
    return null;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
  resolved.hash = "";
  const absolute = canonicalUrl(resolved.href);
  if (!absolute) return null;
  return {
    href: String(source.href ?? rawHref),
    absolute,
    text: String(source.text ?? source.title ?? source.name ?? "").trim().slice(0, 240),
  };
}

function normalizePageResponse(raw, requestedUrl, options = {}) {
  const envelope = raw && typeof raw === "object" ? raw : {};
  const payload = envelope.page && typeof envelope.page === "object" ? envelope.page : envelope;
  const finalUrl = canonicalUrl(
    String(payload.final_url ?? payload.finalUrl ?? payload.url ?? requestedUrl).trim(),
  );
  const status = Number(payload.status ?? envelope.status ?? 200) || 0;
  const html = String(payload.html ?? payload.body ?? "");
  const maxTextChars = asBoundedInt(options.maxTextChars ?? options.max_text_chars, 50000, 1, 500000);
  const maxMarkdownChars = asBoundedInt(
    options.maxMarkdownChars ?? options.max_markdown_chars,
    60000,
    1,
    1000000,
  );
  const maxLinks = asBoundedInt(
    options.maxLinksPerPage ?? options.max_links_per_page,
    100,
    1,
    1000,
  );
  const extracted = html
    ? extractPage(finalUrl, html, {
        maxTextChars,
        maxMarkdownChars,
        maxLinksPerPage: maxLinks,
        emitMarkdown: true,
      })
    : { title: "", text: "", markdown: "", links: [] };
  const title = String(payload.title ?? extracted.title ?? "").trim();
  const text = smartTruncate(
    String(payload.text ?? extracted.text ?? ""),
    maxTextChars,
  );
  const markdown = smartTruncate(
    String(payload.markdown ?? extracted.markdown ?? text),
    maxMarkdownChars,
  );
  const linkSource = Array.isArray(payload.links)
    ? payload.links
    : Array.isArray(payload.outlinks)
      ? payload.outlinks
      : extracted.links;
  const links = [];
  const seen = new Set();
  for (const rawLink of linkSource) {
    const link = normalizePageLink(rawLink, finalUrl || requestedUrl);
    if (!link || seen.has(link.absolute)) continue;
    seen.add(link.absolute);
    links.push(link);
    if (links.length >= maxLinks) break;
  }
  const explicitError = String(payload.error ?? envelope.error ?? "").trim();
  const explicitSuccess = payload.success ?? envelope.success;
  const hasContent = Boolean(title || text || markdown || links.length);
  const success = explicitSuccess === false
    ? false
    : !explicitError && hasContent && (status === 0 || status < 400);
  return {
    success,
    url: canonicalUrl(requestedUrl),
    finalUrl: finalUrl || canonicalUrl(requestedUrl),
    status,
    title,
    text,
    markdown,
    links,
    error: success ? "" : explicitError || (hasContent ? `page status ${status}` : "user_browser_invalid_page"),
    errorCode: success ? "" : String(payload.error_code ?? envelope.error_code ?? (hasContent ? "user_browser_page_failed" : "user_browser_invalid_page")),
    metadata: {
      transport: "user_browser_bridge",
      source: "authorized_user_browser",
      ...(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
    },
  };
}

/** Execute one page read through the host's already-authorized browser. */
export async function fetchUserBrowserPage(bridge, url, options = {}) {
  const requestedUrl = canonicalUrl(String(url ?? "").trim());
  const parts = parseUrl(requestedUrl);
  if (!parts.valid || !parts.host || !["http", "https"].includes(parts.scheme)) {
    return {
      success: false,
      url: requestedUrl,
      finalUrl: requestedUrl,
      status: 0,
      title: "",
      text: "",
      markdown: "",
      links: [],
      errorCode: "invalid_url",
      error: "user_browser page URL must be http(s)",
      metadata: { transport: "user_browser_bridge" },
    };
  }
  if (!isUserBrowserPageBridge(bridge)) {
    return {
      success: false,
      url: requestedUrl,
      finalUrl: requestedUrl,
      status: 0,
      title: "",
      text: "",
      markdown: "",
      links: [],
      errorCode: "user_browser_fetch_bridge_required",
      error: "user_browser research requires an injected fetch(url) or open(url) bridge",
      metadata: { transport: "user_browser_bridge" },
    };
  }
  const method = typeof bridge.fetch === "function" ? bridge.fetch : bridge.open;
  const timeoutMs = asBoundedInt(options.timeoutMs ?? options.timeout_ms, 20000, 1, 120000);
  try {
    const response = await timeoutPromise(
      method.call(bridge, requestedUrl, {
        ...options,
        timeoutMs,
        timeout_ms: timeoutMs,
      }),
      timeoutMs,
    );
    return normalizePageResponse(response, requestedUrl, options);
  } catch (error) {
    const code = String(error?.code ?? "user_browser_fetch_error");
    const message = String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 240);
    return {
      success: false,
      url: requestedUrl,
      finalUrl: requestedUrl,
      status: 0,
      title: "",
      text: "",
      markdown: "",
      links: [],
      errorCode: code,
      error: message || code,
      metadata: { transport: "user_browser_bridge" },
    };
  }
}

/**
 * Bounded breadth-first traversal through the user browser bridge. The host
 * remains responsible for authentication/session policy; this function only
 * enforces URL, depth, page, link, and host bounds.
 */
export async function exploreUserBrowser(bridge, startUrls, options = {}) {
  const starts = (Array.isArray(startUrls) ? startUrls : [startUrls])
    .map((url) => canonicalUrl(String(url ?? "").trim()))
    .filter(Boolean);
  const policy = new ExplorePolicy({
    ...options,
    maxPages: asBoundedInt(options.maxPages ?? options.max_pages, 8, 1, 100),
    maxDepth: asBoundedInt(options.maxDepth ?? options.max_depth, 1, 0, 4),
    maxLinksPerPage: asBoundedInt(options.maxLinksPerPage ?? options.max_links_per_page, 100, 1, 1000),
    timeoutMs: asBoundedInt(options.timeoutMs ?? options.timeout_ms, 20000, 1, 120000),
  });
  const result = {
    success: false,
    startUrl: starts[0] || "",
    finalUrl: "",
    pagesFetched: 0,
    maxDepthReached: 0,
    title: "",
    text: "",
    markdown: "",
    links: [],
    steps: [],
    policy,
    error: "",
    metadata: {
      transport: "user_browser_bridge",
      mode: "user_browser_explore",
      attempts: 0,
      max_pages: policy.maxPages,
      max_depth: policy.maxDepth,
    },
  };
  if (!starts.length) {
    result.error = "start_url required";
    return result;
  }
  const firstParts = parseUrl(starts[0]);
  if (!firstParts.valid || !firstParts.host || !hostAllowed(firstParts.host, policy)) {
    result.error = "invalid or denied start_url";
    return result;
  }
  const originHost = normalizeHost(firstParts.host);
  const queue = starts.map((url) => ({ url, depth: 0 }));
  const visited = new Set();
  const linkSeen = new Set();
  const maxAttempts = Math.max(policy.maxPages * 4, policy.maxPages);
  while (queue.length && result.pagesFetched < policy.maxPages && result.metadata.attempts < maxAttempts) {
    const item = queue.shift();
    if (!item || visited.has(item.url) || item.depth > policy.maxDepth) continue;
    visited.add(item.url);
    result.metadata.attempts += 1;
    result.maxDepthReached = Math.max(result.maxDepthReached, item.depth);
    const page = await fetchUserBrowserPage(bridge, item.url, policy);
    const step = {
      stepIndex: result.steps.length,
      depth: item.depth,
      url: item.url,
      finalUrl: page.finalUrl || item.url,
      status: page.status || 0,
      success: Boolean(page.success),
      error: page.error || "",
      errorCode: page.errorCode || "",
      title: page.title || "",
      text: page.text || "",
      markdown: page.markdown || "",
      links: page.links || [],
      rawBodyBytes: 0,
      blockedLinks: [],
    };
    result.steps.push(step);
    if (!page.success) {
      if (!result.error) result.error = page.error || page.errorCode || "user_browser fetch failed";
      continue;
    }
    result.success = true;
    result.pagesFetched += 1;
    if (!result.finalUrl) {
      result.finalUrl = page.finalUrl || item.url;
      result.title = page.title || "";
      result.text = page.text || "";
      result.markdown = page.markdown || "";
    } else if (page.text && result.text.length < policy.maxTextChars) {
      result.text = smartTruncate(`${result.text}\n\n${page.text}`, policy.maxTextChars);
      result.markdown = smartTruncate(`${result.markdown}\n\n---\n\n${page.markdown}`, policy.maxMarkdownChars);
    }
    for (const link of page.links || []) {
      if (!link?.absolute || linkSeen.has(link.absolute)) continue;
      linkSeen.add(link.absolute);
      result.links.push(link);
      if (item.depth >= policy.maxDepth) continue;
      if (!urlAllowed(link.absolute, policy, originHost)) {
        step.blockedLinks.push(link.absolute);
        continue;
      }
      if (!visited.has(link.absolute) && queue.length < policy.maxPages * 4) {
        queue.push({ url: link.absolute, depth: item.depth + 1 });
      }
    }
  }
  if (!result.success && !result.error) result.error = "no pages fetched";
  result.metadata.queued = queue.length;
  result.metadata.visited = visited.size;
  return result;
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
