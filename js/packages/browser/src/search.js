import { PLATFORM_SEARCH_PROVIDERS, normalizeProviderName } from "@handoffkit/browser-core";
import { TransportRequest, defaultTransport } from "./transport.js";
import { rankSearchHits } from "./rank.js";
import { decodeHtmlEntities } from "./html_extract.js";
import { detectSoftBlock } from "./util.js";
import {
  USER_BROWSER_PROVIDER,
  searchUserBrowser,
} from "./user_browser.js";
import {
  DEFAULT_BROWSER_PROVIDER,
  searchDefaultBrowser,
} from "./default_browser.js";

const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "that", "this", "was", "were",
  "is", "are", "had", "have", "has", "with", "its", "it", "as", "by", "from", "what", "which", "who",
  "when", "where", "how", "name", "title", "old", "new", "been", "be", "do", "does", "did", "into",
  "about", "over", "under", "their", "there", "these", "those", "than", "then", "them", "they",
  "you", "your", "our", "we", "i", "me", "my",
]);

export function urlEncodeComponent(s) {
  let out = "";
  const hex = "0123456789ABCDEF";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0);
    if (
      (c >= 48 && c <= 57) ||
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      ch === "-" ||
      ch === "_" ||
      ch === "." ||
      ch === "~"
    ) {
      out += ch;
    } else if (ch === " ") {
      out += "+";
    } else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) {
        out += `%${hex[b >> 4]}${hex[b & 0xf]}`;
      }
    }
  }
  return out;
}

export function urlDecodeBasic(input) {
  const s = String(input ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "%" && i + 2 < s.length) {
      const hi = Number.parseInt(s[i + 1], 16);
      const lo = Number.parseInt(s[i + 2], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        out += String.fromCharCode((hi << 4) | lo);
        i += 2;
        continue;
      }
    } else if (s[i] === "+") {
      out += " ";
      continue;
    }
    out += s[i];
  }
  return out;
}

export function keywordCompress(query, maxWords = 10) {
  let out = "";
  let word = "";
  let count = 0;
  const flush = () => {
    if (!word) return;
    const low = word.toLowerCase();
    if (!STOPWORDS.has(low) && word.length >= 2) {
      if (out) out += " ";
      out += word;
      count += 1;
    }
    word = "";
  };
  for (const c of String(query ?? "")) {
    if (/[a-zA-Z0-9'\-]/.test(c)) word += c;
    else {
      flush();
      if (count >= maxWords) break;
    }
  }
  if (count < maxWords) flush();
  return out;
}

function pushHit(hits, title, url, maxResults) {
  if (hits.length >= maxResults) return;
  if (!url || !url.startsWith("http")) return;
  if (url.includes("duckduckgo.com")) return;
  if (url.includes("wikipedia.org/w/api.php")) return;
  const existing = hits.find((h) => h.url === url);
  if (existing) {
    if (!existing.title && title) existing.title = title;
    return;
  }
  hits.push({ title: title || "", url });
}

function stripTags(s) {
  return String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const DEFAULT_SEARCH_PROVIDERS = Object.freeze([...PLATFORM_SEARCH_PROVIDERS]);
export const SUPPORTED_SEARCH_PROVIDERS = Object.freeze([
  "google",
  "google_http",
  "google_browser",
  "project_index",
  "duckduckgo",
  "wikipedia",
  "searxng",
  "brave",
  "bing",
  "kagi",
  USER_BROWSER_PROVIDER,
  DEFAULT_BROWSER_PROVIDER,
]);
export { PLATFORM_SEARCH_PROVIDERS };

export function providerEngine(providers) {
  const names = [];
  for (const raw of providers ?? []) {
    const value = String(raw ?? "").trim().toLowerCase();
    const provider = value === "g"
      ? "google"
      : value === "ddg"
      ? "duckduckgo"
      : value === "wiki"
        ? "wikipedia"
        : value === "sx" || value === "dodo"
          ? "searxng"
        : value === "user-browser"
          ? USER_BROWSER_PROVIDER
          : value === "default-browser" || value === "system-browser"
            ? DEFAULT_BROWSER_PROVIDER
          : value;
    const engine = provider === "google" || provider === "google_http"
      ? "google_html"
      : provider === "google_browser"
        ? "google_browser"
        : provider === "project_index"
          ? "project_index"
      : provider === "duckduckgo"
      ? "duckduckgo_html"
      : provider === "searxng"
        ? "searxng_json"
      : provider === "brave"
        ? "brave_json"
      : provider === "bing"
        ? "bing_json"
      : provider === "kagi"
        ? "kagi_json"
      : provider === "wikipedia"
        ? "wikipedia_opensearch"
        : provider === USER_BROWSER_PROVIDER
          ? "user_browser_bridge"
          : provider === DEFAULT_BROWSER_PROVIDER
            ? "default_browser_bridge"
          : "";
    if (engine && !names.includes(engine)) names.push(engine);
  }
  return names.join("+") || "none";
}

function isSearchAdUrl(url) {
  const value = String(url ?? "").toLowerCase();
  if (!value) return true;
  if (value.includes("googleadservices.com") || value.includes("doubleclick.net")) return true;
  if (value.includes("/aclk?") || value.includes("/pagead/") || value.includes("adurl=")) return true;
  if (value.includes("/ads/") || value.endsWith("/ads")) return true;
  return false;
}

function unwrapGoogleLink(raw) {
  let link = decodeHtmlEntities(String(raw ?? "").trim());
  if (!link) return "";
  try {
    const parsed = new URL(link, "https://www.google.com/");
    if (parsed.hostname === "www.google.com" || parsed.hostname === "google.com") {
      const target = parsed.searchParams.get("q") || parsed.searchParams.get("url") || "";
      if (target) link = target;
      else return "";
    }
  } catch {
    return "";
  }
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    if (isSearchAdUrl(parsed.href)) return "";
    if (parsed.hostname === "google.com" || parsed.hostname?.endsWith(".google.com")) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

/**
 * Parse Google's server-rendered result page without opening a browser tab.
 * Only outbound result anchors are accepted; ad redirectors, Google chrome,
 * and internal search/navigation links are discarded before ranking.
 */
export async function searchGoogle(transport, query, maxResults = 8, timeoutMs = 20000) {
  const hits = [];
  if (!transport || !query || maxResults < 1) return hits;
  let q = String(query);
  const kw = keywordCompress(query, 10);
  if (kw) q = kw;
  const url =
    `https://www.google.com/search?hl=en&num=${Math.max(maxResults, 8)}` +
    `&q=${urlEncodeComponent(q)}`;
  const resp = await transport.get(
    new TransportRequest({
      url,
      timeoutMs: timeoutMs > 0 ? timeoutMs : 20000,
      headers: {
        "User-Agent": "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
        Accept: "text/html,application/xhtml+xml",
      },
    }),
  );
  if (resp.error || resp.status < 200 || resp.status >= 300 || !resp.body) return hits;

  const html = resp.body;
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while (hits.length < maxResults && (match = anchorRe.exec(html)) !== null) {
    const link = unwrapGoogleLink(match[1] ?? match[2] ?? match[3] ?? "");
    if (!link) continue;
    const title = stripTags(match[4] ?? "");
    if (!title || title.length < 2) continue;
    pushHit(hits, title, link, maxResults);
  }
  return hits;
}

function canonicalSearchProvider(raw) {
  const normalized = normalizeProviderName(raw);
  if (normalized === "google_http") return "google";
  return normalized;
}

function traceProviderName(internal) {
  return internal === "google" ? "google_http" : internal;
}

function normalizeProviders(providers) {
  const requested = Array.isArray(providers) && providers.length ? providers : DEFAULT_SEARCH_PROVIDERS;
  const normalized = [];
  const errors = [];
  for (const raw of requested) {
    const provider = canonicalSearchProvider(raw);
    if (!provider) continue;
    if (!SUPPORTED_SEARCH_PROVIDERS.includes(provider) && provider !== "google") {
      errors.push(`unsupported provider: ${provider}`);
      continue;
    }
    if (!normalized.includes(provider)) normalized.push(provider);
  }
  if (!normalized.length && !errors.length) {
    errors.push("no search providers configured");
  }
  return { requested: [...requested].map((p) => String(p)), normalized, errors };
}

async function wikipediaOpensearch(transport, query, maxResults, timeoutMs) {
  const hits = [];
  if (!transport || !query || maxResults < 1) return hits;

  let q = String(query);
  const kw = keywordCompress(query, 8);
  if (kw && kw.length + 10 < q.length) q = kw;

  const api =
    `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=${maxResults}` +
    `&search=${urlEncodeComponent(q)}`;

  const resp = await transport.get(
    new TransportRequest({
      url: api,
      timeoutMs: timeoutMs > 0 ? timeoutMs : 20000,
      headers: {
        "User-Agent": "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
        Accept: "application/json",
      },
    }),
  );
  if (resp.error || resp.status < 200 || resp.status >= 300 || !resp.body) return hits;

  try {
    const j = JSON.parse(resp.body);
    if (!Array.isArray(j) || j.length < 4 || !Array.isArray(j[1]) || !Array.isArray(j[3])) {
      return hits;
    }
    const titles = j[1];
    const urls = j[3];
    const n = Math.min(titles.length, urls.length, maxResults);
    for (let i = 0; i < n; i++) {
      pushHit(hits, String(titles[i] ?? ""), String(urls[i] ?? ""), maxResults);
    }
  } catch {
    return hits;
  }
  return hits;
}

/**
 * Search a self-hosted SearXNG instance's JSON API (e.g. Dodo Explorer).
 * Base URLs come from options ({baseUrl, baseUrls}), HANDOFFKIT_SEARXNG_URLS
 * (comma-separated), or HANDOFFKIT_SEARXNG_URL; without any the provider
 * reports provider_unavailable instead of guessing a public instance.
 * Options {engines, categories, page} map to SearXNG query params; unknown
 * categories or engines fail closed. Instances are tried in order until one
 * returns hits.
 */
const SEARXNG_CATEGORIES = Object.freeze(["general", "images", "videos", "news"]);

function searxngOptionList(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(",");
  return items.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean);
}

async function searxngJsonSearch(transport, query, maxResults, timeoutMs, options = {}) {
  const hits = [];
  if (!transport || !query || maxResults < 1) return { hits };
  const opts = options && typeof options === "object" ? options : {};
  const bases = [
    ...searxngOptionList(opts.baseUrls),
    ...(opts.baseUrl ? [String(opts.baseUrl).trim().replace(/\/+$/, "")] : []),
    ...searxngOptionList(process.env.HANDOFFKIT_SEARXNG_URLS),
    ...(process.env.HANDOFFKIT_SEARXNG_URL
      ? [String(process.env.HANDOFFKIT_SEARXNG_URL).trim().replace(/\/+$/, "")]
      : []),
  ].filter(Boolean);
  if (!bases.length) {
    return {
      hits,
      error_code: "provider_unavailable",
      error: "searxng requires HANDOFFKIT_SEARXNG_URL (self-hosted instance base URL)",
    };
  }
  const engines = [...new Set(searxngOptionList(opts.engines))];
  for (const token of engines) {
    if (!/^[a-z0-9_+-]+$/.test(token)) {
      return { hits, error_code: "searxng_invalid_options", error: `searxng unknown engine: ${token}` };
    }
  }
  const categories = [...new Set(searxngOptionList(opts.categories))];
  for (const category of categories) {
    if (!SEARXNG_CATEGORIES.includes(category)) {
      return { hits, error_code: "searxng_invalid_options", error: `searxng unknown category: ${category}` };
    }
  }
  const page = Number(opts.page ?? 1);
  if (opts.page != null && !(Number.isInteger(page) && page >= 1)) {
    return { hits, error_code: "searxng_invalid_options", error: "searxng page must be an integer >= 1" };
  }
  const extra = [
    engines.length ? `&engines=${engines.map(urlEncodeComponent).join(",")}` : "",
    categories.length ? `&categories=${categories.map(urlEncodeComponent).join(",")}` : "",
    page > 1 ? `&pageno=${page}` : "",
  ].join("");
  let lastError = null;
  for (const base of bases) {
    const url = `${base}/search?q=${urlEncodeComponent(String(query))}&format=json${extra}`;
    let resp;
    try {
      resp = await transport.get(
        new TransportRequest({
          url,
          timeoutMs: timeoutMs > 0 ? timeoutMs : 20000,
          headers: {
            "User-Agent": "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
            Accept: "application/json",
          },
        }),
      );
    } catch (error) {
      lastError = { hits, error_code: "searxng_transport_error", error: String(error?.message ?? error) };
      continue;
    }
    if (resp.error) {
      lastError = { hits, error_code: "searxng_transport_error", error: resp.error };
      continue;
    }
    if (resp.status < 200 || resp.status >= 300 || !resp.body) {
      lastError = { hits, error_code: "searxng_empty_response", error: "SearXNG returned no JSON results" };
      continue;
    }
    let data;
    try {
      data = JSON.parse(resp.body);
    } catch {
      lastError = { hits, error_code: "searxng_invalid_response", error: "SearXNG returned invalid JSON" };
      continue;
    }
    const results = Array.isArray(data?.results) ? data.results : [];
    const attempt = [];
    for (const item of results) {
      const itemUrl = String(item?.url ?? "");
      const title = stripTags(String(item?.title ?? ""));
      if (itemUrl.startsWith("http")) pushHit(attempt, title || itemUrl, itemUrl, maxResults);
      if (attempt.length >= maxResults) break;
    }
    if (attempt.length) return { hits: attempt };
    lastError = { hits, error_code: "", error: "" };
  }
  return lastError ?? { hits };
}

/**
 * Brave Search JSON API (api.search.brave.com). Key via HANDOFFKIT_BRAVE_API_KEY;
 * without it the provider reports provider_unavailable instead of calling.
 */
async function braveJsonSearch(transport, query, maxResults, timeoutMs) {
  const hits = [];
  if (!transport || !query || maxResults < 1) return { hits };
  const key = String(process.env.HANDOFFKIT_BRAVE_API_KEY ?? "").trim();
  if (!key) {
    return {
      hits,
      error_code: "provider_unavailable",
      error: "brave requires HANDOFFKIT_BRAVE_API_KEY",
    };
  }
  const url = `https://api.search.brave.com/res/v1/web/search?q=${urlEncodeComponent(String(query))}&count=${Math.min(Math.max(maxResults, 1), 20)}`;
  const resp = await transport.get(
    new TransportRequest({
      url,
      timeoutMs: timeoutMs > 0 ? timeoutMs : 20000,
      headers: {
        "User-Agent": "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
    }),
  );
  if (resp.error) return { hits, error_code: "brave_transport_error", error: resp.error };
  if (resp.status < 200 || resp.status >= 300 || !resp.body) {
    return { hits, error_code: "brave_empty_response", error: "Brave returned no JSON results" };
  }
  let data;
  try {
    data = JSON.parse(resp.body);
  } catch {
    return { hits, error_code: "brave_invalid_response", error: "Brave returned invalid JSON" };
  }
  const results = Array.isArray(data?.web?.results) ? data.web.results : [];
  for (const item of results) {
    const itemUrl = String(item?.url ?? "");
    const title = stripTags(String(item?.title ?? ""));
    if (itemUrl.startsWith("http")) pushHit(hits, title || itemUrl, itemUrl, maxResults);
    if (hits.length >= maxResults) break;
  }
  return { hits };
}

/**
 * Bing Web Search JSON API (api.bing.microsoft.com). Key via HANDOFFKIT_BING_API_KEY;
 * without it the provider reports provider_unavailable instead of calling.
 */
async function bingJsonSearch(transport, query, maxResults, timeoutMs) {
  const hits = [];
  if (!transport || !query || maxResults < 1) return { hits };
  const key = String(process.env.HANDOFFKIT_BING_API_KEY ?? "").trim();
  if (!key) {
    return {
      hits,
      error_code: "provider_unavailable",
      error: "bing requires HANDOFFKIT_BING_API_KEY",
    };
  }
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${urlEncodeComponent(String(query))}&count=${Math.min(Math.max(maxResults, 1), 20)}&responseFilter=Webpages`;
  const resp = await transport.get(
    new TransportRequest({
      url,
      timeoutMs: timeoutMs > 0 ? timeoutMs : 20000,
      headers: {
        "User-Agent": "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
        Accept: "application/json",
        "Ocp-Apim-Subscription-Key": key,
      },
    }),
  );
  if (resp.error) return { hits, error_code: "bing_transport_error", error: resp.error };
  if (resp.status < 200 || resp.status >= 300 || !resp.body) {
    return { hits, error_code: "bing_empty_response", error: "Bing returned no JSON results" };
  }
  let data;
  try {
    data = JSON.parse(resp.body);
  } catch {
    return { hits, error_code: "bing_invalid_response", error: "Bing returned invalid JSON" };
  }
  const results = Array.isArray(data?.webPages?.value) ? data.webPages.value : [];
  for (const item of results) {
    const itemUrl = String(item?.url ?? "");
    const title = stripTags(String(item?.name ?? ""));
    if (itemUrl.startsWith("http")) pushHit(hits, title || itemUrl, itemUrl, maxResults);
    if (hits.length >= maxResults) break;
  }
  return { hits };
}

/**
 * Kagi Search JSON API (kagi.com). Key via HANDOFFKIT_KAGI_API_KEY;
 * without it the provider reports provider_unavailable instead of calling.
 */
async function kagiJsonSearch(transport, query, maxResults, timeoutMs) {
  const hits = [];
  if (!transport || !query || maxResults < 1) return { hits };
  const key = String(process.env.HANDOFFKIT_KAGI_API_KEY ?? "").trim();
  if (!key) {
    return {
      hits,
      error_code: "provider_unavailable",
      error: "kagi requires HANDOFFKIT_KAGI_API_KEY",
    };
  }
  const url = `https://kagi.com/api/v0/search?q=${urlEncodeComponent(String(query))}`;
  const resp = await transport.get(
    new TransportRequest({
      url,
      timeoutMs: timeoutMs > 0 ? timeoutMs : 20000,
      headers: {
        "User-Agent": "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
        Accept: "application/json",
        Authorization: `Bot ${key}`,
      },
    }),
  );
  if (resp.error) return { hits, error_code: "kagi_transport_error", error: resp.error };
  if (resp.status < 200 || resp.status >= 300 || !resp.body) {
    return { hits, error_code: "kagi_empty_response", error: "Kagi returned no JSON results" };
  }
  let data;
  try {
    data = JSON.parse(resp.body);
  } catch {
    return { hits, error_code: "kagi_invalid_response", error: "Kagi returned invalid JSON" };
  }
  const results = Array.isArray(data?.data) ? data.data : [];
  for (const item of results) {
    const itemUrl = String(item?.url ?? "");
    const title = stripTags(String(item?.title ?? ""));
    if (itemUrl.startsWith("http")) pushHit(hits, title || itemUrl, itemUrl, maxResults);
    if (hits.length >= maxResults) break;
  }
  return { hits };
}

async function duckduckgoHtmlSearch(transport, query, maxResults, timeoutMs) {
  const hits = [];
  if (!transport || !query || maxResults < 1) return { hits };

  let q = String(query);
  const kw = keywordCompress(query, 10);
  if (kw) q = kw;

  const url = `https://html.duckduckgo.com/html/?q=${urlEncodeComponent(q)}`;
  const resp = await transport.get(
    new TransportRequest({
      url,
      timeoutMs: timeoutMs > 0 ? timeoutMs : 20000,
      headers: {
        "User-Agent": "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
        Accept: "text/html,application/xhtml+xml",
      },
    }),
  );
  if (resp.error) return { hits, error_code: "duckduckgo_transport_error", error: resp.error };
  const soft = detectSoftBlock(resp.body ?? "", resp.status);
  const lowerBody = String(resp.body ?? "").slice(0, 12000).toLowerCase();
  if (soft.blocked || /anomaly detected|unusual traffic|automated quer(?:y|ies)|rate limit|too many requests|not a robot/.test(lowerBody)) {
    return {
      hits,
      error_code: "duckduckgo_soft_block",
      error: "DuckDuckGo returned a rate-limit or bot-challenge page",
    };
  }
  if (resp.status < 200 || resp.status >= 300 || !resp.body) return { hits, error_code: "duckduckgo_empty_response", error: "DuckDuckGo returned no HTML results" };

  const html = resp.body;

  // Prefer titled result__a anchors first.
  let pos = 0;
  while (hits.length < maxResults) {
    const a = html.indexOf("result__a", pos);
    if (a === -1) break;
    let href = html.indexOf('href="', a);
    if (href === -1 || href > a + 120) {
      pos = a + 8;
      continue;
    }
    href += 6;
    const hend = html.indexOf('"', href);
    if (hend === -1) break;
    let link = html.slice(href, hend);
    if (link.includes("uddg=")) {
      const u = link.indexOf("uddg=");
      link = urlDecodeBasic(link.slice(u + 5));
      const amp = link.indexOf("&");
      if (amp !== -1) link = link.slice(0, amp);
    }
    let title = "";
    const gt = html.indexOf(">", hend);
    const close = gt === -1 ? -1 : html.indexOf("</a>", gt);
    if (gt !== -1 && close !== -1) title = stripTags(html.slice(gt + 1, close));
    pushHit(hits, title, link, maxResults);
    pos = hend;
  }

  // Backfill bare uddg= links without titles.
  pos = 0;
  while (hits.length < maxResults) {
    let u = html.indexOf("uddg=", pos);
    if (u === -1) break;
    u += 5;
    let end = u;
    while (end < html.length) {
      const c = html[end];
      if (c === "&" || c === '"' || c === "'" || c === " " || c === "<" || c === ">") break;
      end++;
    }
    const dec = urlDecodeBasic(html.slice(u, end));
    pushHit(hits, "", dec, maxResults);
    pos = end;
  }
  return { hits };
}

async function searchWithProviders(transport, query, maxResults, timeoutMs, providers, userBrowser, extras = {}) {
  const normalized = normalizeProviders(providers);
  const hits = [];
  const providersUsed = [];
  const errors = [...normalized.errors];
  const providerCodes = [];
  const providerTrace = [];
  const strictProvider = Boolean(extras.strictProvider ?? extras.strict_provider);
  const startedIso = () => new Date().toISOString();

  for (const provider of normalized.normalized) {
    const startedAt = startedIso();
    let providerHits = [];
    let providerResult = null;
    let errorCode = "";
    let errorText = "";
    try {
      if (provider === "google_browser") {
        if (typeof extras.googleBrowserSearch === "function") {
          providerResult = await extras.googleBrowserSearch(query, { maxResults, timeoutMs });
          providerHits = providerResult?.hits ?? providerResult?.results ?? [];
        } else {
          errorCode = "provider_unavailable";
          errorText = "google_browser requires an explicit Browser Real search hook";
        }
      } else if (provider === "project_index") {
        if (extras.projectIndex && typeof extras.projectIndex.search === "function") {
          providerResult = await extras.projectIndex.search(query, { maxResults, timeoutMs });
          providerHits = providerResult?.hits ?? providerResult?.results ?? [];
        } else {
          errorCode = "index_unavailable";
          errorText = "project_index is opt-in and was not configured";
        }
      } else if (provider === "google") {
        providerHits = await searchGoogle(transport, query, maxResults, timeoutMs);
      } else if (provider === "duckduckgo") {
        providerResult = await duckduckgoHtmlSearch(transport, query, maxResults, timeoutMs);
        providerHits = providerResult.hits;
      } else if (provider === "searxng") {
        providerResult = await searxngJsonSearch(transport, query, maxResults, timeoutMs, extras.searxng ?? {});
        providerHits = providerResult.hits;
      } else if (provider === "brave") {
        providerResult = await braveJsonSearch(transport, query, maxResults, timeoutMs);
        providerHits = providerResult.hits;
      } else if (provider === "bing") {
        providerResult = await bingJsonSearch(transport, query, maxResults, timeoutMs);
        providerHits = providerResult.hits;
      } else if (provider === "kagi") {
        providerResult = await kagiJsonSearch(transport, query, maxResults, timeoutMs);
        providerHits = providerResult.hits;
      } else if (provider === "wikipedia") {
        providerHits = await wikipediaOpensearch(transport, query, maxResults, timeoutMs);
      } else if (provider === DEFAULT_BROWSER_PROVIDER) {
        providerResult = await searchDefaultBrowser(userBrowser, query, { maxResults, timeoutMs });
        providerHits = providerResult.hits;
      } else {
        providerResult = await searchUserBrowser(userBrowser, query, { maxResults, timeoutMs });
        providerHits = providerResult.hits;
      }
      if (!errorCode && providerResult?.error_code) {
        errorCode = providerResult.error_code;
        errorText = providerResult.error || errorCode;
      }
      const used = Array.isArray(providerHits) && providerHits.length > 0;
      if (used) {
        for (const h of providerHits) pushHit(hits, h.title, h.url, maxResults);
        providersUsed.push(provider === "google" ? "google" : provider);
      } else if (errorCode) {
        providerCodes.push(errorCode);
        errors.push(`${provider}: ${errorText}`.trim());
      } else {
        errors.push(`${provider}: empty`);
        errorCode = errorCode || "no_results";
      }
      const fallbackReason = used
        ? ""
        : errorCode === "provider_unavailable"
          ? `${traceProviderName(provider)}_unavailable`
          : errorCode === "index_unavailable"
            ? "project_index_disabled"
            : errorCode === "provider_challenge"
              ? `${traceProviderName(provider)}_challenge`
              : `${traceProviderName(provider)}_empty`;
      providerTrace.push({
        provider: traceProviderName(provider),
        attempted: true,
        used,
        result_count: used ? providerHits.length : 0,
        error_code: used ? "" : errorCode,
        fallback_reason: fallbackReason,
        started_at: startedAt,
        finished_at: startedIso(),
      });
      if (strictProvider && !used) {
        break;
      }
    } catch (error) {
      errors.push(`${provider}: ${String(error?.message ?? error)}`);
      providerTrace.push({
        provider: traceProviderName(provider),
        attempted: true,
        used: false,
        result_count: 0,
        error_code: "provider_unavailable",
        fallback_reason: `${traceProviderName(provider)}_error`,
        started_at: startedAt,
        finished_at: startedIso(),
      });
      if (strictProvider) break;
    }
  }
  if (hits.length === 0 && normalized.normalized.includes("wikipedia") && !strictProvider) {
    const shortQ = keywordCompress(query, 4);
    if (shortQ && shortQ !== query) {
      try {
        const fallback = await wikipediaOpensearch(transport, shortQ, maxResults, timeoutMs);
        for (const h of fallback) pushHit(hits, h.title, h.url, maxResults);
        if (fallback.length && !providersUsed.includes("wikipedia")) providersUsed.push("wikipedia");
      } catch (error) {
        errors.push(`wikipedia: ${String(error?.message ?? error)}`);
      }
    }
  }
  hits.sort((a, b) => Number(Boolean(b.title)) - Number(Boolean(a.title)));
  return {
    hits: hits.slice(0, maxResults),
    providersUsed,
    errors,
    providersRequested: normalized.requested,
    providerCodes,
    engine: providerEngine(normalized.requested),
    providerTrace,
    strictProvider,
  };
}

export async function multiSearch(
  transport,
  query,
  maxResults = 8,
  timeoutMs = 20000,
  providers = DEFAULT_SEARCH_PROVIDERS,
  userBrowser = null,
  extras = {},
) {
  const result = await searchWithProviders(transport, query, maxResults, timeoutMs, providers, userBrowser, extras);
  return result.hits;
}

/**
 * Live web search through explicitly selected public or host-provided adapters.
 */
export async function webSearch(query, opts = {}) {
  const q = String(query ?? "").trim();
  const maxResults = Math.min(Math.max(Number(opts.maxResults ?? opts.max_results ?? 8) || 8, 1), 32);
  const timeoutMs = Number(opts.timeoutMs ?? opts.timeout_ms ?? 20000) || 20000;
  const transport = opts.transport ?? defaultTransport(true);
  const allowHosts = opts.allowHosts ?? opts.allow_hosts ?? [];
  const denyHosts = opts.denyHosts ?? opts.deny_hosts ?? [];
  const searchPlan = String(opts.searchPlan ?? opts.search_plan ?? "").toLowerCase();
  const providers = opts.providers
    ?? (searchPlan === "platform" ? [...PLATFORM_SEARCH_PROVIDERS] : DEFAULT_SEARCH_PROVIDERS);
  const userBrowser = opts.userBrowser ?? opts.user_browser ?? null;
  const extras = {
    strictProvider: opts.strictProvider ?? opts.strict_provider ?? false,
    googleBrowserSearch: opts.googleBrowserSearch ?? opts.google_browser_search ?? null,
    projectIndex: opts.projectIndex ?? opts.project_index ?? null,
    searxng: opts.searxng ?? null,
  };

  if (!q) {
    return {
      success: false,
      query: "",
      keywords: "",
      results: [],
      count: 0,
      providers_requested: Array.isArray(providers) ? providers.map((p) => String(p)) : [],
      providers_used: [],
      provider_trace: [],
      errors: ["query is required"],
      provider_codes: [],
      engine: providerEngine(providers),
      error_code: "query_required",
      error: "query is required",
      strict_provider: Boolean(extras.strictProvider),
    };
  }

  const searched = await searchWithProviders(transport, q, maxResults, timeoutMs, providers, userBrowser, extras);
  if (extras.strictProvider && searched.providerTrace.some((item) => item.fallback_reason)) {
    return {
      success: false,
      query: q,
      keywords: keywordCompress(q),
      results: [],
      count: 0,
      providers_requested: searched.providersRequested,
      providers_used: [],
      provider_trace: searched.providerTrace,
      errors: searched.errors,
      provider_codes: searched.providerCodes,
      engine: searched.engine,
      error_code: "strict_provider_rejected",
      error: "strict_provider forbids fallback",
      strict_provider: true,
    };
  }
  let results = searched.hits;
  if (allowHosts.length || denyHosts.length) {
    results = rankSearchHits(results, { allowHosts, denyHosts }).slice(0, maxResults);
  } else {
    results = rankSearchHits(results).slice(0, maxResults);
  }

  const providerErrorCode = searched.providerCodes.find((code) => String(code).startsWith("duckduckgo_"))
    || searched.providerCodes.find((code) => String(code).startsWith("google_"))
    || (searched.providerCodes.includes("user_browser_bridge_required")
      ? "user_browser_bridge_required"
      : searched.providerCodes.includes("user_browser_invalid_response")
        ? "user_browser_invalid_response"
        : searched.providerCodes.includes("default_browser_bridge_required")
          ? "default_browser_bridge_required"
          : searched.providerCodes.includes("default_browser_invalid_response")
            ? "default_browser_invalid_response"
            : searched.errors.some((error) => String(error).startsWith("unsupported provider:"))
              ? "provider_unavailable"
              : extras.strictProvider
                ? "strict_provider_rejected"
                : "");

  return {
    success: results.length > 0,
    query: q,
    keywords: keywordCompress(q),
    results: results.map(({ title, url, score }) => ({
      title,
      url,
      ...(score != null ? { score } : {}),
    })),
    count: results.length,
    providers_requested: searched.providersRequested,
    providers_used: searched.providersUsed,
    provider_trace: searched.providerTrace,
    errors: searched.errors,
    provider_codes: searched.providerCodes,
    engine: searched.engine,
    error_code: results.length ? "" : providerErrorCode || "no_results",
    error: results.length ? "" : "no search results",
    strict_provider: Boolean(extras.strictProvider),
  };
}
