import { ExplorePolicy } from "./types.js";
import { defaultTransport } from "./transport.js";
import { WebExplorer } from "./explorer.js";
import { webSearch, keywordCompress, DEFAULT_SEARCH_PROVIDERS } from "./search.js";
import { rankSearchHits } from "./rank.js";
import { BrowserCache, defaultCacheRoot } from "./cache.js";
import { PageMarkdown } from "./page.js";
import { canonicalUrl, mapWithConcurrency, smartTruncate } from "./util.js";
import { exploreUserBrowser } from "./user_browser.js";
import { DEFAULT_BROWSER_PROVIDER, exploreDefaultBrowser } from "./default_browser.js";
import { finalizeResearchPackV2 } from "./research_pack_v2.js";

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
    this.metadata = { ...(init.metadata ?? {}) };
    this.pack_version = init.pack_version ?? 2;
    this.claims = [...(init.claims ?? [])];
    this.contradictions = [...(init.contradictions ?? [])];
    this.snapshots = [...(init.snapshots ?? [])];
    this.selected_urls = [...(init.selected_urls ?? [])];
    this.checkpoint_id = init.checkpoint_id ?? "";
    this.idempotency_key = init.idempotency_key ?? "";
    this.provider_trace = [...(init.provider_trace ?? [])];
  }

  toDict() {
    finalizeResearchPackV2(this);
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
      agent_markdown: this.toAgentMarkdown(),
      metadata: { ...this.metadata },
      pack_version: this.pack_version,
      claims: [...this.claims],
      contradictions: [...this.contradictions],
      snapshots: [...this.snapshots],
      selected_urls: [...this.selected_urls],
      checkpoint_id: this.checkpoint_id,
      idempotency_key: this.idempotency_key,
      provider_trace: [...this.provider_trace],
    };
  }

  /**
   * Stable, source-labelled Markdown bundle intended for agent context.
   * Content is bounded so a large browser session cannot exhaust a prompt.
   */
  toAgentMarkdown({ maxChars = 96000 } = {}) {
    const lines = ["# HandoffKit Research", ""];
    if (this.queries.length) {
      lines.push("## Queries", "", ...this.queries.map((query) => `- ${query}`), "");
    }
    if (this.citations.length) {
      lines.push("## Sources", "");
      for (const citation of this.citations) {
        const title = citation.title || citation.url || "Source";
        if (citation.url) lines.push(`- [${title}](${citation.url})`);
        else lines.push(`- ${title}`);
      }
      lines.push("");
    }
    const traversal = this.steps.filter((step) =>
      ["user_browser_explore", "user_browser_explore_step"].includes(step?.tool),
    );
    if (traversal.length) {
      lines.push("## Traversal", "");
      for (const step of traversal.slice(0, 40)) {
        const label = step.tool === "user_browser_explore_step" ? "page" : "seed";
        const target = step.url || step.seed_url || "";
        const state = step.success ? "ok" : `error${step.error_code ? ` (${step.error_code})` : ""}`;
        lines.push(`- ${label} depth=${step.depth ?? "-"} ${state}: ${target}`);
      }
      lines.push("");
    }
    if (this.pages.length) {
      lines.push("## Evidence", "");
      for (const [index, rawPage] of this.pages.entries()) {
        const page = rawPage instanceof PageMarkdown ? rawPage : PageMarkdown.fromDict(rawPage ?? {});
        const source = page.url || "";
        lines.push(`### ${index + 1}. ${page.title || source || "Untitled page"}`, "");
        if (source) lines.push(`Source: ${source}`, "");
        lines.push(smartTruncate(page.markdown || page.text || page.excerpt || "", 20000), "");
        const related = (page.links ?? [])
          .map((link) => ({ url: link.absolute || link.href || "", text: link.text || "" }))
          .filter((link) => link.url)
          .slice(0, 8);
        if (related.length) {
          lines.push("Related links:", "", ...related.map((link) => `- [${link.text || link.url}](${link.url})`), "");
        }
      }
    }
    if (this.error) lines.push("## Errors", "", `- ${this.error}`, "");
    if (!this.pages.length && !this.error) lines.push("No page evidence was returned.", "");
    return smartTruncate(lines.join("\n").trim() + "\n", maxChars);
  }

  promptSection() {
    return researchPromptSection(this);
  }
}

/**
 * Derive a small deterministic set of focused queries for background research.
 * This never opens a browser tab; providers are called through the injected
 * transport only.
 */
export function makeResearchQueries({ query = "", task = "", maxSubQueries = 3 } = {}) {
  const limit = Math.max(1, Math.min(Number(maxSubQueries) || 3, 8));
  const candidates = [String(query ?? "").trim()];
  const taskText = String(task ?? "").trim();
  if (taskText) candidates.push(...taskText.split(/[.!?\n]+/));
  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const focused = makeSearchQueryFromTask(candidate, 140);
    if (!focused) continue;
    const key = focused.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(focused);
    if (out.length >= limit) break;
  }
  return out;
}

function pageFromExploreStep(step, format = "markdown") {
  return new PageMarkdown({
    url: step.finalUrl || step.url || "",
    title: step.title || "",
    markdown: format === "readme"
      ? `# ${step.title || "Untitled page"}\n\nSource: ${step.finalUrl || step.url || ""}\n\n${step.markdown || step.text || ""}`
      : step.markdown || step.text || "",
    text: step.text || "",
    links: step.links || [],
    format,
    error: step.success ? "" : step.error || "fetch failed",
    success: Boolean(step.success),
  });
}

function userBrowserExploreOptions(config, maxPages, maxDepth, timeoutMs, allowHosts, denyHosts) {
  return {
    maxPages,
    maxDepth,
    timeoutMs,
    maxBodyBytes: config.maxBodyBytes ?? config.max_body_bytes,
    maxTextChars: config.maxTextChars ?? config.max_text_chars,
    maxLinksPerPage: config.maxLinksPerPage ?? config.max_links_per_page,
    maxMarkdownChars: config.maxMarkdownChars ?? config.max_markdown_chars ?? 60000,
    sameHostOnly: config.sameHostOnly ?? config.same_host_only ?? true,
    query: String(config.query ?? config.web_search_query ?? config.task ?? "").trim(),
    skipActionLinks: config.skipActionLinks ?? config.skip_action_links ?? true,
    allowHosts,
    denyHosts,
  };
}

function appendUserBrowserOutcome(pack, seedUrl, outcome, format, maxPages) {
  const result = outcome.result;
  pack.metadata.user_browser_attempts = (pack.metadata.user_browser_attempts ?? 0) + Number(result.metadata?.attempts ?? 0);
  pack.metadata.user_browser_action_links_skipped =
    (pack.metadata.user_browser_action_links_skipped ?? 0) + Number(result.metadata?.action_links_skipped ?? 0);
  pack.metadata.user_browser_max_depth_reached = Math.max(
    Number(pack.metadata.user_browser_max_depth_reached ?? 0),
    Number(result.maxDepthReached ?? 0),
  );
  pack.tool_calls += 1;
  pack.steps.push({
    tool: "user_browser_explore",
    seed_url: seedUrl,
    success: result.success,
    pages_fetched: result.pagesFetched,
    max_depth_reached: result.maxDepthReached,
    error_code: result.steps?.find((step) => step.errorCode)?.errorCode || "",
    error: result.error || "",
    ms: outcome.ms,
  });
  for (const step of result.steps ?? []) {
    pack.steps.push({
      tool: "user_browser_explore_step",
      seed_url: seedUrl,
      depth: step.depth,
      url: step.url,
      final_url: step.finalUrl,
      status: step.status,
      success: step.success,
      error_code: step.errorCode || "",
      error: step.error || "",
      links: step.links?.length ?? 0,
      relevance: step.relevance ?? 0,
    });
    if (!step.success || pack.pages_ok >= maxPages) continue;
    const page = pageFromExploreStep(step, format);
    if (!page.success) continue;
    pack.pages.push(page);
    pack.pages_ok += 1;
    const finalUrl = page.url || step.url;
    pack.urls_fetched.push(finalUrl);
    pack.citations.push({ title: page.title || finalUrl, url: finalUrl });
  }
  if (!pack.metadata.page_transport) pack.metadata.page_transport = "user_browser_bridge";
  if (result.error && !pack.error) pack.error = result.error;
  const code = result.steps?.find((step) => step.errorCode)?.errorCode || "";
  if (code && !pack.metadata.error_code) pack.metadata.error_code = code;
}

function providerIncludes(providers, names) {
  return Array.isArray(providers)
    && providers.some((provider) => names.includes(String(provider).toLowerCase()));
}

function bridgeConfigured(bridge) {
  return Boolean(bridge) && bridge.configured !== false;
}

/**
 * Deep, bounded research over HTTP/fixtures or an explicit user-browser
 * bridge. The selected page route is recorded in metadata and fails closed on
 * missing bridge methods; browser-session content is never fetched by an
 * unrelated HTTP transport.
 */
export async function gatherDeepWebResearch(config = {}) {
  const started = Date.now();
  const transport = config.transport ?? defaultTransport(true);
  const query = String(config.query ?? config.web_search_query ?? "").trim();
  const task = String(config.task ?? "").trim();
  const maxPages = Math.max(1, Math.min(Number(config.maxPages ?? config.max_pages ?? 8) || 8, 100));
  const requestedDepth = Number(config.maxDepth ?? config.max_depth ?? 2);
  const maxDepth = Number.isFinite(requestedDepth)
    ? Math.max(0, Math.min(requestedDepth, 4))
    : 2;
  const maxSubQueries = Math.max(1, Math.min(Number(config.maxSubQueries ?? config.max_sub_queries ?? 3) || 3, 8));
  const maxResultsPerQuery = Math.max(1, Math.min(Number(config.maxResultsPerQuery ?? config.max_results_per_query ?? 8) || 8, 20));
  const autoSearch = config.autoSearch ?? config.auto_search ?? true;
  const timeoutMs = Math.max(1000, Number(config.timeoutMs ?? config.timeout_ms ?? 20000) || 20000);
  const concurrency = Math.max(1, Math.min(Number(config.concurrency ?? 3) || 3, 8));
  const allowHosts = config.allowHosts ?? config.allow_hosts ?? [];
  const denyHosts = config.denyHosts ?? config.deny_hosts ?? [];
  const providers = config.providers ?? DEFAULT_SEARCH_PROVIDERS;
  const userBrowser = config.userBrowser ?? config.user_browser ?? null;
  const userBrowserRequested = providerIncludes(providers, ["user_browser", "user-browser"]);
  const defaultBrowserRequested = providerIncludes(providers, [
    DEFAULT_BROWSER_PROVIDER,
    "default-browser",
    "system-browser",
  ]);
  const browserBridgeRequested = userBrowserRequested || defaultBrowserRequested;
  const format = config.format ?? "markdown";
  const seedUrls = [...(config.seedUrls ?? config.seed_urls ?? [])];
  const cache = config.cache instanceof BrowserCache
    ? config.cache
    : config.cacheRoot || config.cache_root || config.useCache || config.use_cache
      ? new BrowserCache({
          root: config.cacheRoot || config.cache_root || defaultCacheRoot(),
          ttlMs: config.cacheTtlMs ?? config.cache_ttl_ms ?? 24 * 60 * 60 * 1000,
        })
      : null;

  const pack = new ResearchPack({
    enabled: true,
    transport: transport?.name?.() ?? "none",
    mode: "deep_search_then_explore",
    metadata: {
      execution_mode: defaultBrowserRequested
        ? "background_default_browser_bridge"
        : userBrowserRequested ? "background_user_browser_bridge" : "background_http",
      user_browser_required: browserBridgeRequested,
      user_browser_bridge_configured: bridgeConfigured(userBrowser),
      default_browser_required: defaultBrowserRequested,
      default_browser_bridge_configured: defaultBrowserRequested && bridgeConfigured(userBrowser),
      max_pages: maxPages,
      max_depth: maxDepth,
      max_sub_queries: maxSubQueries,
      max_results_per_query: maxResultsPerQuery,
      timeout_ms: timeoutMs,
      concurrency,
      allow_hosts: [...allowHosts],
      deny_hosts: [...denyHosts],
      cache_enabled: Boolean(cache),
      provider_transport: transport?.name?.() ?? "none",
      providers_requested: Array.isArray(providers) ? providers.map((p) => String(p)) : [],
      providers_used: [],
      provider_errors: [],
      cache_hits: 0,
      cache_misses: 0,
      cache_writes: 0,
      error_code: "",
      auto_search: Boolean(autoSearch),
    },
  });

  const queries = autoSearch ? makeResearchQueries({ query, task, maxSubQueries }) : [];
  pack.queries.push(...queries);
  const rawUrls = [...seedUrls, ...extractUrlsFromText(task), ...extractUrlsFromText(query)];
  const urls = [...new Set(rawUrls.map(canonicalUrl).filter(Boolean))];
  const searchOutcomes = await mapWithConcurrency(queries, concurrency, async (subquery) => {
    const t0 = Date.now();
    const result = await webSearch(subquery, {
      transport,
      maxResults: maxResultsPerQuery,
      timeoutMs,
      providers,
      userBrowser,
      allowHosts,
      denyHosts,
    });
    return { subquery, result, ms: Date.now() - t0 };
  });
  for (const outcome of searchOutcomes) {
    pack.tool_calls += 1;
    pack.steps.push({
      tool: "web_search",
      query: outcome.subquery,
      success: outcome.result.success,
      count: outcome.result.count,
      engine: outcome.result.engine,
      providers_requested: outcome.result.providers_requested ?? [],
      providers_used: outcome.result.providers_used ?? [],
      provider_errors: outcome.result.errors ?? [],
      ms: outcome.ms,
      error: outcome.result.error || "",
    });
    for (const provider of outcome.result.providers_used ?? []) {
      if (!pack.metadata.providers_used.includes(provider)) pack.metadata.providers_used.push(provider);
    }
    for (const error of outcome.result.errors ?? []) {
      if (!pack.metadata.provider_errors.includes(error)) pack.metadata.provider_errors.push(error);
    }
    if (outcome.result.error && !pack.error) pack.error = outcome.result.error;
    if (outcome.result.error_code && !pack.metadata.error_code) {
      pack.metadata.error_code = outcome.result.error_code;
    }
    for (const hit of outcome.result.results ?? []) {
      if (hit.url) urls.push(canonicalUrl(hit.url));
    }
  }

  const ranked = rankSearchHits(
    [...new Set(urls)].map((url) => ({ title: "", url })),
    { allowHosts, denyHosts },
  ).map((hit) => hit.url);
  if (!ranked.length) {
    pack.error = "no urls to explore";
    pack.metadata.error_code = "no_urls_to_explore";
    pack.used = Boolean(pack.queries.length);
    pack.metadata.duration_ms = Date.now() - started;
    return pack;
  }

  // Each seed gets a bounded BFS branch. The global page cap is enforced while
  // flattening successful steps, so a deep run cannot grow without bound.
  const branchPages = Math.max(1, Math.min(maxDepth + 1, maxPages));
  const branchCount = Math.max(1, Math.ceil(maxPages / branchPages));
  const candidates = ranked.slice(0, branchCount);
  if (browserBridgeRequested) {
    pack.metadata.page_transport = defaultBrowserRequested
      ? "default_browser_bridge"
      : "user_browser_bridge";
    const browserOptions = userBrowserExploreOptions(
      config,
      branchPages,
      maxDepth,
      timeoutMs,
      allowHosts,
      denyHosts,
    );
    const outcomes = await mapWithConcurrency(candidates, concurrency, async (url) => {
      const t0 = Date.now();
      const result = defaultBrowserRequested
        ? await exploreDefaultBrowser(userBrowser, [url], browserOptions)
        : await exploreUserBrowser(userBrowser, [url], browserOptions);
      return { url, result, ms: Date.now() - t0 };
    });
    for (const outcome of outcomes) {
      appendUserBrowserOutcome(pack, outcome.url, outcome, format, maxPages);
    }
    pack.markdown_context = smartTruncate(
      pack.pages.map((page) => page.markdown).filter(Boolean).join("\n\n---\n\n"),
      config.contextMaxChars ?? config.context_max_chars ?? 96000,
    );
    pack.used = pack.pages_ok > 0 || Boolean(pack.queries.length);
    if (!pack.pages_ok && !pack.error) pack.error = "no user-browser pages explored successfully";
    if (!pack.pages_ok && !pack.metadata.error_code) pack.metadata.error_code = "no_pages_explored";
    pack.metadata.candidates = candidates;
    pack.metadata.duration_ms = Date.now() - started;
    pack.steps.push({ tool: "deep_research_done", pages_ok: pack.pages_ok, ms: pack.metadata.duration_ms });
    return pack;
  }
  const policy = new ExplorePolicy({
    maxDepth,
    maxPages: branchPages,
    timeoutMs,
    maxBodyBytes: config.maxBodyBytes ?? config.max_body_bytes,
    maxTextChars: config.maxTextChars ?? config.max_text_chars,
    maxLinksPerPage: config.maxLinksPerPage ?? config.max_links_per_page,
    sameHostOnly: config.sameHostOnly ?? config.same_host_only ?? true,
    followRedirects: config.followRedirects ?? config.follow_redirects ?? true,
    maxRedirects: config.maxRedirects ?? config.max_redirects ?? 5,
    allowHosts,
    denyHosts,
    emitMarkdown: true,
    maxMarkdownChars: config.maxMarkdownChars ?? config.max_markdown_chars ?? 60000,
  });
  const explorer = new WebExplorer(transport, policy);
  const outcomes = await mapWithConcurrency(candidates, concurrency, async (url) => {
    const t0 = Date.now();
    if (cache) {
      const cached = await cache.get(url);
      if (cached?.markdown) {
        const cachedPage = PageMarkdown.fromDict({ ...cached, success: true });
        pack.metadata.cache_hits += 1;
        const cachedStep = {
          stepIndex: 0,
          depth: 0,
          url,
          finalUrl: cachedPage.url || url,
          status: Number(cached.status ?? 200),
          success: true,
          error: "",
          title: cachedPage.title || "",
          text: cachedPage.text || "",
          markdown: cachedPage.markdown || "",
          links: cachedPage.links || [],
          rawBodyBytes: Number(cached.raw_body_bytes ?? 0),
          blockedLinks: [],
          cache_hit: true,
        };
        return {
          url,
          result: {
            success: true,
            startUrl: url,
            finalUrl: cachedStep.finalUrl,
            pagesFetched: 1,
            maxDepthReached: 0,
            title: cachedStep.title,
            text: cachedStep.text,
            markdown: cachedStep.markdown,
            links: cachedStep.links,
            steps: [cachedStep],
            policy,
            error: "",
            metadata: { transport: transport?.name?.() ?? "none", mode: "explore", cache_hit: true },
          },
          ms: Date.now() - t0,
        };
      }
      pack.metadata.cache_misses += 1;
    }
    const result = await explorer.explore(url, policy);
    if (result.success && cache) {
      const first = (result.steps ?? []).find((step) => step.success);
      if (first) {
        const page = pageFromExploreStep(first, format);
        if (page.success) {
          await cache.set(url, page.toDict());
          pack.metadata.cache_writes += 1;
        }
      }
    }
    return { url, result, ms: Date.now() - t0 };
  });

  for (const outcome of outcomes) {
    pack.tool_calls += 1;
    pack.steps.push({
      tool: "web_explore",
      seed_url: outcome.url,
      success: outcome.result.success,
      pages_fetched: outcome.result.pagesFetched,
      max_depth_reached: outcome.result.maxDepthReached,
      ms: outcome.ms,
      error: outcome.result.error || "",
    });
    for (const step of outcome.result.steps ?? []) {
      pack.steps.push({
        tool: "web_explore_step",
        seed_url: outcome.url,
        depth: step.depth,
        url: step.url,
        final_url: step.finalUrl,
        status: step.status,
        success: step.success,
        error: step.error || "",
        cache_hit: Boolean(step.cache_hit),
      });
      if (!step.success || pack.pages_ok >= maxPages) continue;
      const page = pageFromExploreStep(step, format);
      if (!page.success) continue;
      pack.pages.push(page);
      pack.pages_ok += 1;
      const finalUrl = page.url || step.url;
      pack.urls_fetched.push(finalUrl);
      pack.citations.push({ title: page.title || finalUrl, url: finalUrl });
    }
  }
  pack.markdown_context = smartTruncate(
    pack.pages.map((page) => page.markdown).filter(Boolean).join("\n\n---\n\n"),
    config.contextMaxChars ?? config.context_max_chars ?? 96000,
  );
  pack.used = pack.pages_ok > 0 || Boolean(pack.queries.length);
  if (!pack.pages_ok && !pack.error) pack.error = "no pages explored successfully";
  if (!pack.pages_ok) pack.metadata.error_code = "no_pages_explored";
  pack.metadata.candidates = candidates;
  pack.metadata.duration_ms = Date.now() - started;
  pack.steps.push({ tool: "deep_research_done", pages_ok: pack.pages_ok, ms: pack.metadata.duration_ms });
  return pack;
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
  const maxSubQueries = Math.max(1, Math.min(Number(config.maxSubQueries ?? config.max_sub_queries ?? 3) || 3, 8));
  const timeoutMs = Number(config.timeoutMs ?? config.web_timeout_ms ?? 20000) || 20000;
  const preferExplore = config.preferExplore ?? config.web_prefer_explore ?? false;
  const seedUrls = [...(config.seedUrls ?? config.seed_urls ?? [])];
  const contextMaxChars =
    Number(config.contextMaxChars ?? config.web_context_max_chars ?? 48000) || 48000;
  const allowHosts = config.allowHosts ?? config.allow_hosts ?? [];
  const denyHosts = config.denyHosts ?? config.deny_hosts ?? [];
  const providers = config.providers ?? DEFAULT_SEARCH_PROVIDERS;
  const userBrowser = config.userBrowser ?? config.user_browser ?? null;
  const userBrowserRequested = providerIncludes(providers, ["user_browser", "user-browser"]);
  const defaultBrowserRequested = providerIncludes(providers, [
    DEFAULT_BROWSER_PROVIDER,
    "default-browser",
    "system-browser",
  ]);
  const browserBridgeRequested = userBrowserRequested || defaultBrowserRequested;
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
    metadata: {
      execution_mode: defaultBrowserRequested
        ? "background_default_browser_bridge"
        : userBrowserRequested ? "background_user_browser_bridge" : "background_http",
      user_browser_required: browserBridgeRequested,
      user_browser_bridge_configured: bridgeConfigured(userBrowser),
      default_browser_required: defaultBrowserRequested,
      default_browser_bridge_configured: defaultBrowserRequested && bridgeConfigured(userBrowser),
      providers_requested: Array.isArray(providers) ? providers.map((p) => String(p)) : [],
      providers_used: [],
      provider_errors: [],
      max_sub_queries: maxSubQueries,
      search_query_count: 0,
    },
  });

  let urls = [...seedUrls, ...extractUrlsFromText(task), ...extractUrlsFromText(query)];
  urls = [...new Set(urls.map(canonicalUrl))];

  if (urls.length === 0 && autoSearch) {
    const q = query || makeSearchQueryFromTask(task) || query;
    if (q) {
      const searchQueries = makeResearchQueries({ query: q, task, maxSubQueries });
      result.queries.push(...searchQueries);
      result.metadata.search_query_count = searchQueries.length;
      const searches = await mapWithConcurrency(searchQueries, Math.min(concurrency, 4), async (subquery) => {
        const t0 = Date.now();
        const search = await webSearch(subquery, {
          transport,
          maxResults: Math.min(8, Math.max(4, maxPages * 2)),
          timeoutMs,
          providers,
          userBrowser,
          allowHosts,
          denyHosts,
        });
        return { subquery, search, ms: Date.now() - t0 };
      });
      for (const { subquery, search, ms } of searches) {
        result.tool_calls += 1;
        result.steps.push({
          tool: "web_search",
          query: subquery,
          success: search.success,
          count: search.count,
          ms,
          result: {
            success: search.success,
            count: search.count,
            results: search.results,
            providers_requested: search.providers_requested,
            providers_used: search.providers_used,
            provider_errors: search.errors,
            error_code: search.error_code,
            error: search.error,
          },
        });
        for (const provider of search.providers_used ?? []) {
          if (!result.metadata.providers_used.includes(provider)) result.metadata.providers_used.push(provider);
        }
        for (const error of search.errors ?? []) {
          if (!result.metadata.provider_errors.includes(error)) result.metadata.provider_errors.push(error);
        }
        if (search.error_code && !result.metadata.error_code) result.metadata.error_code = search.error_code;
        if (search.success) {
          for (const hit of search.results) {
            if (hit.url) urls.push(hit.url);
          }
        } else if (search.error && !result.error) {
          result.error = search.error;
        }
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

  if (browserBridgeRequested) {
    result.metadata.page_transport = defaultBrowserRequested
      ? "default_browser_bridge"
      : "user_browser_bridge";
    const branchPages = preferExplore ? Math.max(1, Math.min(maxDepth + 1, maxPages)) : 1;
    const browserOptions = userBrowserExploreOptions(
      config,
      branchPages,
      preferExplore ? maxDepth : 0,
      timeoutMs,
      allowHosts,
      denyHosts,
    );
    const outcomes = await mapWithConcurrency(
      candidates.slice(0, maxPages),
      concurrency,
      async (url) => {
        const t0 = Date.now();
        const explored = defaultBrowserRequested
          ? await exploreDefaultBrowser(userBrowser, [url], browserOptions)
          : await exploreUserBrowser(userBrowser, [url], browserOptions);
        return { url, result: explored, ms: Date.now() - t0 };
      },
    );
    for (const outcome of outcomes) {
      appendUserBrowserOutcome(result, outcome.url, outcome, format, maxPages);
    }
    result.markdown_context = smartTruncate(
      result.pages.map((page) => page.markdown).filter(Boolean).join("\n\n---\n\n"),
      contextMaxChars,
    );
    result.used = result.pages_ok > 0 || result.queries.length > 0;
    if (result.pages_ok === 0 && !result.error) result.error = "no user-browser pages fetched successfully";
    if (result.pages_ok === 0 && !result.metadata.error_code) result.metadata.error_code = "no_pages_fetched";
    result.metadata.candidates = candidates.slice(0, maxPages);
    result.metadata.duration_ms = Date.now() - started;
    result.steps.push({ tool: "research_done", ms: result.metadata.duration_ms, pages_ok: result.pages_ok });
    return result;
  }

  const explorer = new WebExplorer(transport);
  const configuredPolicy = config.policy && typeof config.policy === "object" ? config.policy : {};
  const policy = new ExplorePolicy({
    ...configuredPolicy,
    maxDepth,
    maxPages: preferExplore ? maxPages : 1,
    timeoutMs,
    sameHostOnly: config.sameHostOnly ?? config.same_host_only ?? configuredPolicy.sameHostOnly ?? configuredPolicy.same_host_only ?? preferExplore,
    maxBodyBytes: config.maxBodyBytes ?? config.max_body_bytes ?? configuredPolicy.maxBodyBytes ?? configuredPolicy.max_body_bytes,
    maxTextChars: config.maxTextChars ?? config.max_text_chars ?? configuredPolicy.maxTextChars ?? configuredPolicy.max_text_chars,
    maxMarkdownChars: config.maxMarkdownChars ?? config.max_markdown_chars ?? configuredPolicy.maxMarkdownChars ?? configuredPolicy.max_markdown_chars,
    allowHosts,
    denyHosts,
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
  const bundle = typeof research?.toAgentMarkdown === "function"
    ? research.toAgentMarkdown()
    : research?.agent_markdown || md;
  return (
    "### Live web research (Markdown from HandoffKit browser)\n" +
    "Use the following fetched page content as evidence. Prefer these sources over invention.\n" +
    "Tools used: web_search, web_fetch_markdown, user_browser_bridge, html_to_markdown.\n\n" +
    bundle
  );
}
