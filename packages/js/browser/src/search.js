import { TransportRequest, defaultTransport } from "./transport.js";
import { rankSearchHits } from "./rank.js";

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

const DEFAULT_PROVIDERS = ["duckduckgo", "wikipedia"];

function normalizeProviders(providers) {
  const requested = Array.isArray(providers) && providers.length ? providers : DEFAULT_PROVIDERS;
  const normalized = [];
  const errors = [];
  for (const raw of requested) {
    const value = String(raw ?? "").trim().toLowerCase();
    const provider = value === "ddg" ? "duckduckgo" : value === "wiki" ? "wikipedia" : value;
    if (!provider) continue;
    if (!DEFAULT_PROVIDERS.includes(provider)) {
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

async function duckduckgoHtmlSearch(transport, query, maxResults, timeoutMs) {
  const hits = [];
  if (!transport || !query || maxResults < 1) return hits;

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
  if (resp.error || resp.status < 200 || resp.status >= 300 || !resp.body) return hits;

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
  return hits;
}

async function searchWithProviders(transport, query, maxResults, timeoutMs, providers) {
  const normalized = normalizeProviders(providers);
  const hits = [];
  const providersUsed = [];
  const errors = [...normalized.errors];
  for (const provider of normalized.normalized) {
    try {
      const providerHits = provider === "duckduckgo"
        ? await duckduckgoHtmlSearch(transport, query, maxResults, timeoutMs)
        : await wikipediaOpensearch(transport, query, maxResults, timeoutMs);
      for (const h of providerHits) pushHit(hits, h.title, h.url, maxResults);
      if (providerHits.length) providersUsed.push(provider);
      else errors.push(`${provider}: empty`);
    } catch (error) {
      errors.push(`${provider}: ${String(error?.message ?? error)}`);
    }
  }
  if (hits.length === 0 && normalized.normalized.includes("wikipedia")) {
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
  // Prefer titled hits first when trimming.
  hits.sort((a, b) => Number(Boolean(b.title)) - Number(Boolean(a.title)));
  return {
    hits: hits.slice(0, maxResults),
    providersUsed,
    errors,
    providersRequested: normalized.requested,
  };
}

export async function multiSearch(
  transport,
  query,
  maxResults = 8,
  timeoutMs = 20000,
  providers = DEFAULT_PROVIDERS,
) {
  const result = await searchWithProviders(transport, query, maxResults, timeoutMs, providers);
  return result.hits;
}

/**
 * Live web search (DuckDuckGo HTML + Wikipedia OpenSearch). No API key.
 */
export async function webSearch(query, opts = {}) {
  const q = String(query ?? "").trim();
  const maxResults = Math.min(Math.max(Number(opts.maxResults ?? opts.max_results ?? 8) || 8, 1), 8);
  const timeoutMs = Number(opts.timeoutMs ?? opts.timeout_ms ?? 20000) || 20000;
  const transport = opts.transport ?? defaultTransport(true);
  const allowHosts = opts.allowHosts ?? opts.allow_hosts ?? [];
  const denyHosts = opts.denyHosts ?? opts.deny_hosts ?? [];
  const providers = opts.providers ?? ["duckduckgo", "wikipedia"];

  if (!q) {
    return {
      success: false,
      query: "",
      keywords: "",
      results: [],
      count: 0,
      providers_requested: Array.isArray(providers) ? providers.map((p) => String(p)) : [],
      providers_used: [],
      errors: ["query is required"],
      engine: "duckduckgo_html+wikipedia_opensearch",
      error_code: "query_required",
      error: "query is required",
    };
  }

  const searched = await searchWithProviders(transport, q, maxResults, timeoutMs, providers);
  let results = searched.hits;
  if (allowHosts.length || denyHosts.length) {
    results = rankSearchHits(results, { allowHosts, denyHosts }).slice(0, maxResults);
  } else {
    results = rankSearchHits(results).slice(0, maxResults);
  }

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
    errors: searched.errors,
    engine: "duckduckgo_html+wikipedia_opensearch",
    error_code: results.length
      ? ""
      : searched.errors.some((error) => String(error).startsWith("unsupported provider:"))
        ? "provider_unavailable"
        : "no_results",
    error: results.length ? "" : "no search results",
  };
}
