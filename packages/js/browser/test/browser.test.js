import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ExplorePolicy,
  decodeHtmlEntities,
  extractTitle,
  extractText,
  extractLinks,
  htmlToMarkdown,
  preferMainContent,
  makeFixtureMapTransport,
  WebExplorer,
  webSearch,
  gatherWebResearch,
  gatherDeepWebResearch,
  registerBrowserTools,
  keywordCompress,
  resultToDict,
  createBrowserAgentKit,
  PageMarkdown,
  toReadmeMarkdown,
  rankSearchHits,
  hostScore,
  detectSoftBlock,
  smartTruncate,
  BrowserCache,
  ResearchPack,
  HANDOFFKIT_BROWSER_VERSION,
} from "../src/index.js";

test("version matches package", () => {
  assert.equal(HANDOFFKIT_BROWSER_VERSION, "1.16.0");
});

test("html extract: title text links entities", () => {
  const html = `<html><head><title>Hello &amp; World</title></head>
<body><p>Alpha <b>beta</b></p><a href="/x">Link X</a>
<script>nope()</script></body></html>`;
  assert.equal(extractTitle(html), "Hello & World");
  const text = extractText(html);
  assert.match(text, /Alpha/);
  assert.doesNotMatch(text, /nope/);
  assert.equal(decodeHtmlEntities("a&nbsp;b&lt;c"), "a b<c");
  const links = extractLinks(html, "https://example.com/");
  assert.equal(links[0].absolute, "https://example.com/x");
});

test("preferMainContent drops nav chrome", () => {
  const html = `<html><body><nav>Menu</nav><main><h1>Core</h1><p>Body text</p></main><footer>Foot</footer></body></html>`;
  const main = preferMainContent(html);
  assert.match(main, /Core/);
  assert.doesNotMatch(main, /Menu/);
  assert.doesNotMatch(main, /Foot/);
});

test("htmlToMarkdown produces README-style markdown", () => {
  const html = `<html><head><title>Doc</title></head><body>
<main><h1>Intro</h1><p>Hello <strong>world</strong>.</p>
<a href="https://example.com/a">A</a></main>
</body></html>`;
  const md = htmlToMarkdown(html, { baseUrl: "https://example.com/page" });
  assert.match(md, /^# Doc/m);
  assert.match(md, /Source: https:\/\/example.com\/page/);
  assert.match(md, /## Links/);
});

test("toReadmeMarkdown adds contents", () => {
  const md = toReadmeMarkdown({
    title: "Guide",
    url: "https://example.com",
    markdown: "# Guide\n\n## One\n\ntext\n\n## Two\n\nmore\n",
  });
  assert.match(md, /## Contents/);
  assert.match(md, /- One/);
});

test("fixture explore crawl same-host", async () => {
  const transport = makeFixtureMapTransport();
  const explorer = new WebExplorer(
    transport,
    new ExplorePolicy({ maxDepth: 1, maxPages: 4, sameHostOnly: true }),
  );
  const result = await explorer.explore("https://fixture.local/");
  assert.equal(result.success, true);
  assert.ok(result.pagesFetched >= 2);
  assert.match(result.markdown, /Fixture/);
  assert.doesNotMatch(result.markdown, /secret_should_not_appear/);
  const wire = resultToDict(result);
  assert.equal(wire.success, true);
  assert.ok(Array.isArray(wire.steps));
});

test("createBrowserAgentKit registers tools including web_research", async () => {
  const kit = createBrowserAgentKit({ fixture: true });
  const names = kit.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "html_to_markdown",
    "web_deep_research",
    "web_explore",
    "web_fetch",
    "web_fetch_markdown",
    "web_research",
    "web_search",
  ]);
  const out = await kit.registry.aexecute({
    name: "web_fetch_markdown",
    arguments: { url: "https://fixture.local/about.html" },
  });
  assert.equal(out.success, true);
  assert.match(String(out.output.markdown), /About/);
  assert.ok(out.output.excerpt);
  assert.ok(out.output.fetched_at);
  const deep = await kit.registry.aexecute({
    name: "web_deep_research",
    arguments: {
      query: "fixture",
      seed_urls: ["https://fixture.local/"],
      auto_search: false,
      max_pages: 2,
      max_depth: 1,
    },
  });
  assert.equal(deep.success, true);
  assert.equal(deep.output.metadata.user_browser_required, false);
});

test("createBrowserAgentKit carries provider defaults into helpers and tools", async () => {
  const kit = createBrowserAgentKit({ fixture: true, providers: ["wiki"] });
  kit.transport.setPage(
    "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=6&search=OpenAI",
    JSON.stringify(["OpenAI", ["OpenAI"], [""], ["https://en.wikipedia.org/wiki/OpenAI"]]),
  );
  const direct = await kit.search("OpenAI");
  assert.deepEqual(direct.providers_requested, ["wiki"]);
  assert.deepEqual(direct.providers_used, ["wikipedia"]);
  const tool = await kit.registry.aexecute({
    name: "web_search",
    arguments: { query: "OpenAI" },
  });
  assert.equal(tool.success, true);
  assert.deepEqual(tool.output.providers_requested, ["wiki"]);
});

test("keywordCompress drops stopwords", () => {
  assert.equal(keywordCompress("What is the name of the capital of France?"), "capital France");
});

test("rankSearchHits prefers wikipedia", () => {
  const ranked = rankSearchHits([
    { title: "Blog", url: "https://random-blog.example/post" },
    { title: "Wiki", url: "https://en.wikipedia.org/wiki/Metformin" },
  ]);
  assert.equal(ranked[0].url.includes("wikipedia"), true);
  assert.ok(hostScore("https://nih.gov/x") > hostScore("https://example.com/x"));
});

test("detectSoftBlock and smartTruncate", () => {
  assert.equal(detectSoftBlock("just a moment... cloudflare", 403).blocked, true);
  const long = `${"# Title\n\n"}${"para\n\n".repeat(5000)}`;
  const cut = smartTruncate(long, 200);
  assert.ok(cut.length < long.length);
  assert.match(cut, /truncated/);
});

test("webSearch against fixture search endpoints", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=OpenAI",
    `<html><body>
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2F">OpenAI Home</a>
</body></html>`,
  );
  transport.setPage(
    "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=4&search=OpenAI",
    JSON.stringify(["OpenAI", ["OpenAI"], [""], ["https://en.wikipedia.org/wiki/OpenAI"]]),
  );
  const result = await webSearch("OpenAI", { transport, maxResults: 4 });
  assert.equal(result.success, true);
  assert.ok(result.results.some((r) => r.title));
  assert.deepEqual(result.providers_requested, ["duckduckgo", "wikipedia"]);
  assert.ok(result.providers_used.includes("duckduckgo"));

  const wikiOnly = await webSearch("OpenAI", {
    transport,
    maxResults: 4,
    providers: ["wiki"],
  });
  assert.equal(wikiOnly.success, true);
  assert.deepEqual(wikiOnly.providers_requested, ["wiki"]);
  assert.deepEqual(wikiOnly.providers_used, ["wikipedia"]);
  assert.deepEqual(wikiOnly.errors, []);

  const unavailable = await webSearch("OpenAI", {
    transport,
    providers: ["bing"],
  });
  assert.equal(unavailable.success, false);
  assert.equal(unavailable.error_code, "provider_unavailable");
  assert.match(unavailable.errors[0], /unsupported provider/);
});

test("user_browser provider uses an explicit host bridge", async () => {
  let observed;
  const bridge = {
    async search(query, options) {
      observed = { query, options };
      return {
        results: [
          { title: "User result", url: "https://example.org/from-user#fragment" },
          { title: "unsafe", url: "javascript:alert(1)" },
          { title: "duplicate", url: "https://example.org/from-user" },
        ],
      };
    },
  };
  const result = await webSearch("local browser query", {
    providers: ["user_browser"],
    userBrowser: bridge,
    maxResults: 4,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.providers_requested, ["user_browser"]);
  assert.deepEqual(result.providers_used, ["user_browser"]);
  assert.equal(result.engine, "user_browser_bridge");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, "https://example.org/from-user");
  assert.equal(observed.query, "local browser query");
  assert.equal(observed.options.maxResults, 4);
});

test("user_browser fails closed without a bridge and never falls back", async () => {
  const result = await webSearch("needs user session", { providers: ["user_browser"] });
  assert.equal(result.success, false);
  assert.equal(result.error_code, "user_browser_bridge_required");
  assert.deepEqual(result.providers_used, []);
  assert.match(result.errors[0], /injected search bridge/);
});

test("kit carries user_browser bridge and combines it only when explicitly requested", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=OpenAI",
    '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2F">OpenAI</a>',
  );
  const bridge = { search: () => [{ title: "Session", url: "https://example.org/session" }] };
  const kit = createBrowserAgentKit({
    transport,
    providers: ["duckduckgo", "user_browser"],
    userBrowser: bridge,
  });
  const result = await kit.search("OpenAI");
  assert.equal(result.success, true);
  assert.deepEqual(result.providers_used, ["duckduckgo", "user_browser"]);
  const tool = await kit.registry.aexecute({
    name: "web_search",
    arguments: { query: "OpenAI", providers: ["user_browser"] },
  });
  assert.equal(tool.success, true);
  assert.deepEqual(tool.output.providers_used, ["user_browser"]);
});

test("user_browser bridge feeds bounded research with explicit metadata", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://example.org/session",
    "<html><head><title>Session page</title></head><body><main><p>session evidence</p></main></body></html>",
  );
  const calls = [];
  const pack = await gatherWebResearch({
    query: "session evidence",
    transport,
    providers: ["user_browser"],
    userBrowser: {
      search: () => [{ title: "Session", url: "https://example.org/session" }],
      fetch: async (url) => {
        calls.push(url);
        return { url, title: "Session page", markdown: "session evidence", links: [] };
      },
    },
    maxPages: 1,
  });
  assert.equal(pack.pages_ok, 1);
  assert.equal(pack.metadata.execution_mode, "background_user_browser_bridge");
  assert.equal(pack.metadata.user_browser_required, true);
  assert.equal(pack.metadata.user_browser_bridge_configured, true);
  assert.ok(pack.metadata.providers_used.includes("user_browser"));
  assert.deepEqual(calls, ["https://example.org/session"]);
  assert.match(pack.toAgentMarkdown(), /## Evidence/);
  assert.match(pack.toDict().agent_markdown, /session evidence/);
});

test("user_browser exploration is bounded, follows links, and never falls back to HTTP", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage("https://example.org/session", "<p>HTTP fallback must not be used</p>");
  const pages = new Map([
    ["https://example.org/session", {
      title: "Session root",
      markdown: "root evidence",
      links: [{ href: "/next", text: "Next" }, { href: "javascript:bad" }],
    }],
    ["https://example.org/next", {
      title: "Session next",
      markdown: "next evidence",
      links: [{ href: "/session#again", text: "Root" }],
    }],
  ]);
  const bridge = {
    search: () => [{ title: "Session", url: "https://example.org/session" }],
    fetch: async (url) => ({ url, ...(pages.get(url) ?? { error_code: "missing" }) }),
  };
  const pack = await gatherWebResearch({
    query: "session",
    transport,
    providers: ["user_browser"],
    userBrowser: bridge,
    maxPages: 2,
    preferExplore: true,
    maxDepth: 1,
  });
  assert.equal(pack.pages_ok, 2);
  assert.equal(pack.metadata.page_transport, "user_browser_bridge");
  assert.deepEqual(pack.urls_fetched, ["https://example.org/session", "https://example.org/next"]);
  assert.equal(pack.pages.some((page) => page.markdown.includes("HTTP fallback")), false);
  assert.ok(pack.steps.some((step) => step.tool === "user_browser_explore_step" && step.depth === 1));
});

test("user_browser research fails closed when page access is not exposed", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage("https://example.org/session", "<p>must not be read</p>");
  const pack = await gatherWebResearch({
    seedUrls: ["https://example.org/session"],
    seedOnly: true,
    transport,
    providers: ["user_browser"],
    userBrowser: { search: () => [] },
    maxPages: 1,
  });
  assert.equal(pack.pages_ok, 0);
  assert.equal(pack.metadata.error_code, "user_browser_fetch_bridge_required");
  assert.match(pack.error, /injected fetch/);
});

test("gatherWebResearch + ResearchPack + cache", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=Fixture",
    `<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fabout.html">About Fixture</a>`,
  );
  const cacheRoot = await mkdtemp(path.join(tmpdir(), "hk-browser-cache-"));
  try {
    const pack = await gatherWebResearch({
      query: "Fixture",
      transport,
      maxPages: 2,
      autoSearch: true,
      cache: new BrowserCache({ root: cacheRoot }),
    });
    assert.ok(pack instanceof ResearchPack);
    assert.ok(pack.used);
    assert.ok(pack.pages_ok >= 1);
    assert.match(pack.markdown_context, /About|Fixture|Source:/);
    assert.ok(pack.toDict().citations.length >= 1);

    const again = await gatherWebResearch({
      seedUrls: ["https://fixture.local/about.html"],
      seedOnly: true,
      transport,
      maxPages: 1,
      cache: new BrowserCache({ root: cacheRoot }),
    });
    assert.ok(again.steps.some((s) => s.tool === "cache_hit"));
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test("gatherDeepWebResearch stays background-only and bounded", async () => {
  const transport = makeFixtureMapTransport();
  const pack = await gatherDeepWebResearch({
    task: "Explain the fixture guide.",
    seedUrls: ["https://fixture.local/"],
    transport,
    maxPages: 3,
    maxDepth: 1,
    maxSubQueries: 2,
    autoSearch: false,
  });
  assert.equal(pack.mode, "deep_search_then_explore");
  assert.equal(pack.metadata.execution_mode, "background_http");
  assert.equal(pack.metadata.user_browser_required, false);
  assert.equal(pack.metadata.max_depth, 1);
  assert.ok(pack.pages_ok >= 2);
  assert.ok(pack.steps.some((step) => step.tool === "web_explore_step"));
  assert.match(pack.markdown_context, /Fixture|Guide/);
});

test("gatherDeepWebResearch expands queries through the background transport", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=OpenAI+product+docs",
    '<a class="result__a" href="https://fixture.local/">Fixture</a>',
  );
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=OpenAI+security",
    '<a class="result__a" href="https://fixture.local/about.html">About</a>',
  );
  const pack = await gatherDeepWebResearch({
    task: "OpenAI product docs. OpenAI security.",
    transport,
    maxPages: 3,
    maxDepth: 1,
    maxSubQueries: 2,
    maxResultsPerQuery: 2,
  });
  assert.deepEqual(pack.queries, ["OpenAI product docs", "OpenAI security"]);
  assert.equal(pack.steps.filter((step) => step.tool === "web_search").length, 2);
  assert.equal(pack.metadata.candidates.length, 2);
  assert.ok(pack.pages_ok >= 2);
});

test("gatherDeepWebResearch cache is observable and reused", async () => {
  const transport = makeFixtureMapTransport();
  const cacheRoot = await mkdtemp(path.join(tmpdir(), "hk-deep-cache-"));
  try {
    const first = await gatherDeepWebResearch({
      query: "fixture",
      seedUrls: ["https://fixture.local/"],
      autoSearch: false,
      maxPages: 2,
      maxDepth: 0,
      transport,
      cache: new BrowserCache({ root: cacheRoot }),
    });
    assert.equal(first.pages_ok, 1);
    assert.equal(first.metadata.cache_writes, 1);

    const second = await gatherDeepWebResearch({
      query: "fixture",
      seedUrls: ["https://fixture.local/"],
      autoSearch: false,
      maxPages: 2,
      maxDepth: 0,
      transport,
      cache: new BrowserCache({ root: cacheRoot }),
    });
    assert.equal(second.pages_ok, 1);
    assert.equal(second.metadata.cache_hits, 1);
    assert.ok(second.steps.some((step) => step.cache_hit === true));
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test("PageMarkdown from explore", async () => {
  const kit = createBrowserAgentKit({ fixture: true });
  const page = await kit.fetchMarkdown("https://fixture.local/", { format: "readme" });
  assert.ok(page instanceof PageMarkdown);
  assert.match(page.markdown, /# Fixture Home|Contents|Welcome/);
});

test("live smoke gated by BROWSER_LIVE", { skip: process.env.BROWSER_LIVE !== "1" }, async () => {
  const search = await webSearch("metformin", { maxResults: 3 });
  assert.equal(search.success, true);
  assert.ok(search.count > 0);
});
