import { ExplorePolicy } from "./types.js";
import { defaultTransport } from "./transport.js";
import { WebExplorer } from "./explorer.js";
import { webSearch, keywordCompress } from "./search.js";
import { rankSearchHits } from "./rank.js";
import { BrowserCache, defaultCacheRoot } from "./cache.js";
import { PageMarkdown } from "./page.js";
import { canonicalUrl, mapWithConcurrency, smartTruncate } from "./util.js";

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export function extractUrlsFromText(text) {
  const found = String(text ?? "").match(URL_RE) ?? [];
  const out = [];
  const seen = new Set();
  for (let u of found) {
    u = u.replace(/[.,;:!?)]+$/, "");
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export function makeSearchQueryFromTask(task, maxChars = 140) {
  const raw = String(task ?? "").trim();
  if (!raw) return "";
  const first = raw.split(/[.!?\n]/)[0]?.trim() ?? raw;
  const kw = keywordCompress(first, 12);
  const q = kw || first;
  return q.length > maxChars ? q.slice(0, maxChars) : q;
}

export class ResearchPack {
  constructor(init = {}) {
    this.enabled = init.enabled ?? true;
    this.used = Boolean(init.used);
    this.queries = [...(init.queries ?? [])];
    this.urls_fetched = [...(init.urls_fetched ?? [])];
    this.markdown_context = init.markdown_context ?? "";
    this.pages = [...(init.pages ?? [])];
    this.citations = [...(init.citations ?? [])];
    this.steps = [...(init.steps ?? [])];
    this.pages_ok = init.pages_ok ?? 0;
    this.tool_calls = init.tool_calls ?? 0;
    this.error = init.error ?? "";
    this.transport = init.transport ?? "";
    this.mode = init.mode ?? "search_then_fetch";
  }

  toDict() {
    return {
      enabled: this.enabled,
      used: this.used,
      queries: [...this.queries],
      urls_fetched: [...this.urls_fetched],
      markdown_chars: this.markdown_context.length,
      markdown_context: this.markdown_context,
      pages: this.pages.map((p) => (p instanceof PageMarkdown ? p.toDict() : p)),
      citations: [...this.citations],
      steps: [...this.steps],
      pages_ok: this.pages_ok,
      tool_calls: this.tool_calls,
      error: this.error,
      transport: this.transport,
      mode: this.mode,
    };
  }

  promptSection() {
    return researchPromptSection(this);
  }
}

/**
 * Search (optional) + fetch/explore pages → markdown context for agents.
 */
export async function gatherWebResearch(config = {}) {
  const started = Date.now();
  const transport = config.transport ?? defaultTransport(true);
  const query = String(config.query ?? config.web_search_query ?? "").trim();
  const task = String(config.task ?? "").trim();
  const seedOnly = Boolean(config.seedOnly ?? config.seed_only ?? false);
  const autoSearch = seedOnly ? false : (config.autoSearch ?? config.web_auto_search ?? true);
  const maxPages = Number(config.maxPages ?? config.web_max_pages ?? 4) || 4;
  const maxDepth = Number(config.maxDepth ?? config.web_max_depth ?? 0) || 0;
  const timeoutMs = Number(config.timeoutMs ?? config.web_timeout_ms ?? 20000) || 20000;
  const preferExplore = config.preferExplore ?? config.web_prefer_explore ?? false;
  const seedUrls = [...(config.seedUrls ?? config.seed_urls ?? [])];
  const contextMaxChars =
    Number(config.contextMaxChars ?? config.web_context_max_chars ?? 48000) || 48000;
  const allowHosts = config.allowHosts ?? config.allow_hosts ?? [];
  const denyHosts = config.denyHosts ?? config.deny_hosts ?? [];
  const format = config.format ?? "markdown";
  const concurrency = Math.max(1, Number(config.concurrency ?? 2) || 2);
  const cache =
    config.cache instanceof BrowserCache
      ? config.cache
      : config.cacheRoot || config.cache_root || config.useCache || config.use_cache
        ? new BrowserCache({
            root: config.cacheRoot || config.cache_root || defaultCacheRoot(),
            ttlMs: config.cacheTtlMs ?? config.cache_ttl_ms ?? 24 * 60 * 60 * 1000,
          })
        : null;

  const result = new ResearchPack({
    enabled: true,
    transport: transport?.name?.() ?? "none",
    mode: seedOnly ? "seed_only" : autoSearch ? "search_then_fetch" : "urls_only",
  });

  let urls = [...seedUrls, ...extractUrlsFromText(task), ...extractUrlsFromText(query)];
  urls = [...new Set(urls.map(canonicalUrl))];

  if (urls.length === 0 && autoSearch) {
    const q = query || makeSearchQueryFromTask(task) || query;
    if (q) {
      result.queries.push(q);
      result.tool_calls += 1;
      const t0 = Date.now();
      const search = await webSearch(q, {
        transport,
        maxResults: Math.min(8, Math.max(4, maxPages * 2)),
        timeoutMs,
        allowHosts,
        denyHosts,
      });
      result.steps.push({
        tool: "web_search",
        query: q,
        success: search.success,
        count: search.count,
        ms: Date.now() - t0,
        result: {
          success: search.success,
          count: search.count,
          results: search.results,
          error: search.error,
        },
      });
      if (search.success) {
        for (const hit of search.results) {
          if (hit.url) urls.push(hit.url);
        }
      } else if (search.error) {
        result.error = search.error;
      }
    }
  }

  urls = [...new Set(urls.map(canonicalUrl))];
  let ranked = rankSearchHits(
    urls.map((url) => ({ title: "", url })),
    { allowHosts, denyHosts },
  ).map((h) => h.url);
  const candidates = ranked.slice(0, Math.max(maxPages * 3, maxPages));
  if (candidates.length === 0) {
    if (!result.error) result.error = "no urls to fetch";
    result.used = result.queries.length > 0;
    return result;
  }

  const explorer = new WebExplorer(transport);
  const policy = new ExplorePolicy({
    maxDepth,
    maxPages: preferExplore ? maxPages : 1,
    timeoutMs,
    sameHostOnly: preferExplore,
    emitMarkdown: true,
  });

  const fetchOne = async (url) => {
    const t0 = Date.now();
    if (cache) {
      const hit = await cache.get(url);
      if (hit?.markdown) {
        const page = PageMarkdown.fromDict({ ...hit, success: true });
        return {
          ok: true,
          page,
          step: {
            tool: "cache_hit",
            url,
            success: true,
            title: page.title,
            chars: page.markdownChars,
            ms: Date.now() - t0,
          },
        };
      }
    }

    const fetched = preferExplore
      ? await explorer.explore(url, policy)
      : await explorer.fetch(url, policy);
    const page = PageMarkdown.fromExploreResult(fetched, {
      maxChars: contextMaxChars,
      format,
    });
    const step = {
      tool: preferExplore ? "web_explore" : "web_fetch",
      url,
      success: fetched.success,
      title: fetched.title,
      error: fetched.error,
      status: fetched.steps?.[0]?.status,
      chars: page.markdownChars,
      ms: Date.now() - t0,
    };
    if (fetched.success && cache) {
      await cache.set(url, page.toDict());
    }
    return { ok: fetched.success, page, step };
  };

  const outcomes = await mapWithConcurrency(candidates, concurrency, fetchOne);
  const mdParts = [];
  for (const outcome of outcomes) {
    result.tool_calls += 1;
    result.steps.push(outcome.step);
    if (!outcome.ok) continue;
    if (result.pages_ok >= maxPages) continue;
    result.pages_ok += 1;
    result.urls_fetched.push(outcome.page.url);
    result.pages.push(outcome.page);
    result.citations.push({ title: outcome.page.title, url: outcome.page.url });
    if (outcome.page.markdown) mdParts.push(outcome.page.markdown);
  }

  result.markdown_context = smartTruncate(mdParts.join("\n\n---\n\n"), contextMaxChars);
  result.used = result.pages_ok > 0 || result.queries.length > 0;
  if (result.pages_ok === 0 && !result.error) {
    result.error = "no pages fetched successfully";
  }
  result.steps.push({ tool: "research_done", ms: Date.now() - started, pages_ok: result.pages_ok });
  return result;
}

export function researchPromptSection(research) {
  const md = research?.markdown_context ?? "";
  if (!md) return "";
  const citations = (research?.citations ?? [])
    .map((c) => `- [${c.title || c.url}](${c.url})`)
    .join("\n");
  return (
    "### Live web research (Markdown from HandoffKit browser)\n" +
    "Use the following fetched page content as evidence. Prefer these sources over invention.\n" +
    "Tools used: web_search, web_fetch_markdown, html_to_markdown.\n" +
    (citations ? `\nCitations:\n${citations}\n\n` : "\n") +
    md
  );
}
