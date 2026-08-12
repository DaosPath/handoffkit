import { ToolRegistry } from "@handoffkit/core";
import { ExplorePolicy } from "./types.js";
import { defaultTransport, makeTransport, makeFixtureMapTransport } from "./transport.js";
import { registerBrowserTools } from "./tools.js";
import { gatherDeepWebResearch, gatherWebResearch, ResearchPack } from "./research.js";
import { webSearch } from "./search.js";
import { DEFAULT_SEARCH_PROVIDERS } from "./search.js";
import { WebExplorer } from "./explorer.js";
import { BrowserCache, defaultCacheRoot } from "./cache.js";
import { PageMarkdown } from "./page.js";

/**
 * One-shot construction kit: registry + defaults for serious agent builds.
 */
export function createBrowserAgentKit(options = {}) {
  const transport =
    options.transport ??
    (options.transportKind
      ? makeTransport(options.transportKind, options.transportOptions ?? {})
      : options.fixture
        ? makeFixtureMapTransport()
        : defaultTransport(true));

  const policy = options.policy instanceof ExplorePolicy
    ? options.policy
    : new ExplorePolicy(options.policy ?? {});

  const cache =
    options.cache instanceof BrowserCache
      ? options.cache
      : options.cacheRoot || options.useCache
        ? new BrowserCache({
            root: options.cacheRoot || defaultCacheRoot(),
            ttlMs: options.cacheTtlMs ?? 24 * 60 * 60 * 1000,
          })
        : null;

  const defaults = {
    maxPages: options.maxPages ?? 4,
    maxResults: options.maxResults ?? 6,
    timeoutMs: options.timeoutMs ?? policy.timeoutMs ?? 20000,
    allowHosts: options.allowHosts ?? [],
    denyHosts: options.denyHosts ?? [],
    providers: Array.isArray(options.providers) && options.providers.length
      ? [...options.providers]
      : [...DEFAULT_SEARCH_PROVIDERS],
    userBrowser: options.userBrowser ?? options.user_browser ?? null,
    format: options.format ?? "markdown",
    concurrency: options.concurrency ?? 2,
    contextMaxChars: options.contextMaxChars ?? 48000,
  };

  const registry = options.registry ?? new ToolRegistry();
  registerBrowserTools(registry, transport, {
    providers: defaults.providers,
    userBrowser: defaults.userBrowser,
  });

  const explorer = new WebExplorer(transport, policy);

  return {
    transport,
    policy,
    registry,
    explorer,
    cache,
    defaults,
    tools: registry.list(),
    search(query, opts = {}) {
      return webSearch(query, {
        transport,
        maxResults: opts.maxResults ?? opts.max_results ?? defaults.maxResults,
        timeoutMs: opts.timeoutMs ?? opts.timeout_ms ?? defaults.timeoutMs,
        allowHosts: opts.allowHosts ?? defaults.allowHosts,
        denyHosts: opts.denyHosts ?? defaults.denyHosts,
        providers: opts.providers ?? opts.provider ?? defaults.providers,
        userBrowser: opts.userBrowser ?? opts.user_browser ?? defaults.userBrowser,
      });
    },
    async fetchMarkdown(url, opts = {}) {
      const result = await explorer.fetch(url, {
        ...policy.toDict(),
        timeout_ms: opts.timeoutMs ?? defaults.timeoutMs,
        same_host_only: false,
        emit_markdown: true,
        max_markdown_chars: opts.maxChars ?? defaults.contextMaxChars,
      });
      return PageMarkdown.fromExploreResult(result, {
        maxChars: opts.maxChars ?? defaults.contextMaxChars,
        format: opts.format ?? defaults.format,
      });
    },
    gather(config = {}) {
      return gatherWebResearch({
        transport,
        cache,
        maxPages: defaults.maxPages,
        timeoutMs: defaults.timeoutMs,
        allowHosts: defaults.allowHosts,
        denyHosts: defaults.denyHosts,
        format: defaults.format,
        concurrency: defaults.concurrency,
        contextMaxChars: defaults.contextMaxChars,
        providers: defaults.providers,
        userBrowser: defaults.userBrowser,
        ...config,
      });
    },
    deepGather(config = {}) {
      return gatherDeepWebResearch({
        transport,
        cache,
        maxPages: Math.max(defaults.maxPages, 8),
        timeoutMs: defaults.timeoutMs,
        allowHosts: defaults.allowHosts,
        denyHosts: defaults.denyHosts,
        format: defaults.format,
        concurrency: Math.max(defaults.concurrency, 3),
        contextMaxChars: Math.max(defaults.contextMaxChars, 96000),
        providers: defaults.providers,
        userBrowser: defaults.userBrowser,
        ...config,
      });
    },
    ResearchPack,
  };
}
