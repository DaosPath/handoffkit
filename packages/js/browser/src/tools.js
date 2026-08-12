import { Tool } from "@handoffkit/core";
import { ExplorePolicy, policyFromArgs, resultToDict } from "./types.js";
import { makeTransport, defaultTransport } from "./transport.js";
import { htmlToMarkdown, extractTitle } from "./html_extract.js";
import { WebExplorer } from "./explorer.js";
import { webSearch } from "./search.js";
import { PageMarkdown, toReadmeMarkdown } from "./page.js";
import { gatherDeepWebResearch, gatherWebResearch } from "./research.js";

function resolveTransport(args = {}, fallback = null) {
  if (args.transport && typeof args.transport === "object" && typeof args.transport.get === "function") {
    return args.transport;
  }
  if (typeof args.transport === "string") {
    return makeTransport(args.transport);
  }
  return fallback ?? defaultTransport(true);
}

export function makeWebSearchTool(defaultTransportRef = null, defaults = {}) {
  return new Tool({
    name: "web_search",
    description:
      "Search the live web for a query. Returns ranked {title,url,score} hits. Prefer authoritative hosts. Follow up with web_fetch_markdown on the best URLs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Short keyword-focused search query" },
        max_results: { type: "integer", minimum: 1, maximum: 8, default: 6 },
        timeout_ms: { type: "integer", minimum: 1000, maximum: 60000, default: 20000 },
        allow_hosts: {
          type: "array",
          items: { type: "string" },
          description: "Optional host allowlist (e.g. wikipedia.org, nih.gov)",
        },
        deny_hosts: { type: "array", items: { type: "string" } },
        providers: {
          type: "array",
          items: { type: "string", enum: ["duckduckgo", "ddg", "wikipedia", "wiki", "user_browser"] },
          description: "Provider allowlist; user_browser requires an injected host bridge.",
        },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      if (!args.query || typeof args.query !== "string") {
        return { success: false, error: "query is required", results: [], count: 0 };
      }
      return webSearch(args.query, {
        transport: resolveTransport(args, defaultTransportRef),
        maxResults: args.max_results,
        timeoutMs: args.timeout_ms,
        allowHosts: args.allow_hosts,
        denyHosts: args.deny_hosts,
        providers: args.providers ?? defaults.providers,
        userBrowser: defaults.userBrowser,
      });
    },
  });
}

export function makeWebFetchTool(defaultTransportRef = null) {
  return new Tool({
    name: "web_fetch",
    description: "Fetch one URL and extract title, text, links, and markdown under ExplorePolicy budgets.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "Absolute http(s) URL" },
        timeout_ms: { type: "integer", minimum: 1000, maximum: 60000 },
        same_host_only: { type: "boolean", default: false },
        max_text_chars: { type: "integer" },
        max_markdown_chars: { type: "integer" },
      },
      required: ["url"],
    },
    async execute(args = {}) {
      if (!args.url) return { success: false, error: "url is required" };
      const explorer = new WebExplorer(resolveTransport(args, defaultTransportRef));
      const result = await explorer.fetch(args.url, policyFromArgs({
        ...args,
        same_host_only: args.same_host_only ?? false,
      }));
      return resultToDict(result);
    },
  });
}

export function makeWebExploreTool(defaultTransportRef = null) {
  return new Tool({
    name: "web_explore",
    description: "Bounded BFS crawl from a start URL. Use for docs sites when one page is not enough.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string" },
        max_depth: { type: "integer", minimum: 0, maximum: 3, default: 1 },
        max_pages: { type: "integer", minimum: 1, maximum: 12, default: 4 },
        timeout_ms: { type: "integer" },
        same_host_only: { type: "boolean", default: true },
      },
      required: ["url"],
    },
    async execute(args = {}) {
      if (!args.url) return { success: false, error: "url is required" };
      const explorer = new WebExplorer(resolveTransport(args, defaultTransportRef));
      const result = await explorer.explore(args.url, policyFromArgs({
        ...args,
        same_host_only: args.same_host_only ?? true,
      }));
      return resultToDict(result);
    },
  });
}

export function makeHtmlToMarkdownTool(defaultTransportRef = null) {
  return new Tool({
    name: "html_to_markdown",
    description: "Convert an HTML string (or fetch a URL) into compact Markdown for agent context.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        html: { type: "string" },
        url: { type: "string" },
        max_chars: { type: "integer", default: 60000 },
        include_links: { type: "boolean", default: true },
        include_header: { type: "boolean", default: true },
        format: { type: "string", enum: ["markdown", "readme"], default: "markdown" },
        timeout_ms: { type: "integer" },
      },
    },
    async execute(args = {}) {
      let html = typeof args.html === "string" ? args.html : "";
      let url = typeof args.url === "string" ? args.url : "";
      if (!html && url) {
        const transport = resolveTransport(args, defaultTransportRef);
        const resp = await transport.get({
          url,
          timeoutMs: args.timeout_ms ?? 15000,
          headers: {
            "User-Agent": "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
          },
        });
        if (resp.error || !resp.body) {
          return { success: false, url, error: resp.error || "empty body", format: "markdown" };
        }
        html = resp.body;
        url = resp.finalUrl || url;
      }
      if (!html) {
        return { success: false, error: "html or url is required", format: "markdown" };
      }
      let markdown = htmlToMarkdown(html, {
        baseUrl: url,
        maxChars: args.max_chars ?? 60000,
        includeLinksSection: args.include_links ?? true,
        includeSourceHeader: args.include_header ?? true,
      });
      if (args.format === "readme") {
        markdown = toReadmeMarkdown({
          title: extractTitle(html),
          url,
          markdown,
        });
      }
      return {
        success: true,
        url,
        title: extractTitle(html),
        markdown,
        markdown_chars: markdown.length,
        format: args.format === "readme" ? "readme" : "markdown",
      };
    },
  });
}

export function makeWebFetchMarkdownTool(defaultTransportRef = null) {
  return new Tool({
    name: "web_fetch_markdown",
    description:
      "Fetch a URL and return PageMarkdown: title, markdown, excerpt, links, fetched_at. Prefer this after web_search.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string" },
        timeout_ms: { type: "integer", default: 15000 },
        max_chars: { type: "integer", default: 60000 },
        format: { type: "string", enum: ["markdown", "readme"], default: "markdown" },
      },
      required: ["url"],
    },
    async execute(args = {}) {
      if (!args.url) return { success: false, error: "url is required", format: "markdown" };
      const policy = new ExplorePolicy({
        timeoutMs: args.timeout_ms ?? 15000,
        maxMarkdownChars: args.max_chars ?? 60000,
        emitMarkdown: true,
        sameHostOnly: false,
      });
      const explorer = new WebExplorer(resolveTransport(args, defaultTransportRef));
      const result = await explorer.fetch(args.url, policy);
      return PageMarkdown.fromExploreResult(result, {
        maxChars: args.max_chars ?? 60000,
        format: args.format ?? "markdown",
      }).toDict();
    },
  });
}

export function makeWebResearchTool(defaultTransportRef = null, defaults = {}) {
  return new Tool({
    name: "web_research",
    description:
      "Run search-then-fetch research and return a ResearchPack with markdown_context and citations for answering grounded questions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        max_pages: { type: "integer", minimum: 1, maximum: 8, default: 3 },
        timeout_ms: { type: "integer" },
        allow_hosts: { type: "array", items: { type: "string" } },
        deny_hosts: { type: "array", items: { type: "string" } },
        providers: {
          type: "array",
          items: { type: "string", enum: ["duckduckgo", "ddg", "wikipedia", "wiki", "user_browser"] },
          description: "Provider allowlist; user_browser requires an injected host bridge.",
        },
        seed_only: { type: "boolean", default: false },
        seed_urls: { type: "array", items: { type: "string" } },
        format: { type: "string", enum: ["markdown", "readme"], default: "markdown" },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      if (!args.query) return { success: false, error: "query is required" };
      const pack = await gatherWebResearch({
        query: args.query,
        transport: resolveTransport(args, defaultTransportRef),
        maxPages: args.max_pages ?? 3,
        timeoutMs: args.timeout_ms,
        allowHosts: args.allow_hosts,
        denyHosts: args.deny_hosts,
        providers: args.providers ?? defaults.providers,
        userBrowser: defaults.userBrowser,
        seedOnly: args.seed_only,
        seedUrls: args.seed_urls,
        format: args.format ?? "markdown",
      });
      const dict = pack.toDict();
      // omit huge markdown duplication in tool result metadata path if needed — keep full for agents
      return { success: pack.pages_ok > 0, ...dict };
    },
  });
}

/**
 * Run bounded multi-query/multi-hop research without opening a user browser
 * window. This is the agent-facing deep route; it always uses WebTransport
 * (HTTP or an explicit fixture/map transport) and returns its limits and
 * provider in ResearchPack.metadata.
 */
export function makeDeepWebResearchTool(defaultTransportRef = null, defaults = {}) {
  return new Tool({
    name: "web_deep_research",
    description:
      "Run bounded multi-query, multi-hop research and return a grounded ResearchPack; user_browser is used only when explicitly configured.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        task: { type: "string" },
        max_pages: { type: "integer", minimum: 1, maximum: 100, default: 8 },
        max_depth: { type: "integer", minimum: 0, maximum: 4, default: 2 },
        max_sub_queries: { type: "integer", minimum: 1, maximum: 8, default: 3 },
        max_results_per_query: { type: "integer", minimum: 1, maximum: 20, default: 8 },
        providers: {
          type: "array",
          items: { type: "string", enum: ["duckduckgo", "ddg", "wikipedia", "wiki", "user_browser"] },
          description: "Provider allowlist; user_browser requires an injected host bridge.",
        },
        timeout_ms: { type: "integer", minimum: 1000, maximum: 60000, default: 20000 },
        concurrency: { type: "integer", minimum: 1, maximum: 8, default: 3 },
        allow_hosts: { type: "array", items: { type: "string" } },
        deny_hosts: { type: "array", items: { type: "string" } },
        seed_urls: { type: "array", items: { type: "string" } },
        auto_search: { type: "boolean", default: true },
        context_max_chars: { type: "integer", minimum: 1000, maximum: 200000, default: 96000 },
        format: { type: "string", enum: ["markdown", "readme"], default: "markdown" },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      if (!args.query || typeof args.query !== "string") {
        return { success: false, error: "query is required" };
      }
      const pack = await gatherDeepWebResearch({
        query: args.query,
        task: args.task,
        transport: resolveTransport(args, defaultTransportRef),
        maxPages: args.max_pages ?? 8,
        maxDepth: args.max_depth ?? 2,
        maxSubQueries: args.max_sub_queries ?? 3,
        maxResultsPerQuery: args.max_results_per_query ?? 8,
        providers: args.providers ?? defaults.providers,
        userBrowser: defaults.userBrowser,
        timeoutMs: args.timeout_ms ?? 20000,
        concurrency: args.concurrency ?? 3,
        allowHosts: args.allow_hosts,
        denyHosts: args.deny_hosts,
        seedUrls: args.seed_urls,
        autoSearch: args.auto_search ?? true,
        contextMaxChars: args.context_max_chars ?? 96000,
        format: args.format ?? "markdown",
      });
      return { success: pack.pages_ok > 0, ...pack.toDict() };
    },
  });
}

/** Register all browser tools on a @handoffkit/core ToolRegistry. */
export function registerBrowserTools(registry, transport = null, defaults = {}) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError("registerBrowserTools requires a ToolRegistry");
  }
  const t = transport ?? defaultTransport(true);
  registry.register(makeWebSearchTool(t, defaults));
  registry.register(makeWebFetchTool(t));
  registry.register(makeWebExploreTool(t));
  registry.register(makeHtmlToMarkdownTool(t));
  registry.register(makeWebFetchMarkdownTool(t));
  registry.register(makeWebResearchTool(t, defaults));
  registry.register(makeDeepWebResearchTool(t, defaults));
  return registry;
}

/** Alias matching C++ naming. */
export function registerWebExplorerTools(registry, transport = null, defaults = {}) {
  return registerBrowserTools(registry, transport, defaults);
}
