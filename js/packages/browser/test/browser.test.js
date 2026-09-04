import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  ExplorePolicy,
  decodeHtmlEntities,
  extractTitle,
  extractText,
  extractLinks,
  htmlToMarkdown,
  preferMainContent,
  htmlTableToMarkdown,
  extractJsonLd,
  isRobotsAllowed,
  ProjectWebIndex,
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
  searchUserBrowserMany,
  exploreUserBrowser,
  createDefaultBrowserBridge,
  DEFAULT_BROWSER_PROVIDER,
  HANDOFFKIT_BROWSER_VERSION,
  runFixtureGrounding,
  liveGroundingOracle,
  scoreLiveGroundingRun,
} from "../src/index.js";

test("version matches package", () => {
  assert.equal(HANDOFFKIT_BROWSER_VERSION, "1.20.0-alpha.1");

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
  assert.deepEqual(result.providers_requested, [
    "google_browser",
    "project_index",
    "google_http",
    "duckduckgo",
    "wikipedia",
  ]);
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
    providers: ["not_a_provider"],
  });
  assert.equal(unavailable.success, false);
  assert.equal(unavailable.error_code, "provider_unavailable");
  assert.match(unavailable.errors[0], /unsupported provider/);
});

test("DuckDuckGo challenge pages fail closed with a structured code", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=blocked",
    "<html><body><h1>Anomaly detected</h1><p>Automated queries are rate limited.</p></body></html>",
  );
  const result = await webSearch("blocked", { transport, providers: ["duckduckgo"] });
  assert.equal(result.success, false);
  assert.equal(result.error_code, "duckduckgo_soft_block");
  assert.deepEqual(result.provider_codes, ["duckduckgo_soft_block"]);
});

test("google provider uses HandoffKit HTTP transport and drops sponsored redirects", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://www.google.com/search?hl=en&num=8&q=OpenAI",
    `<html><body>
      <a href="/aclk?sa=l&adurl=https%3A%2F%2Fads.example%2F">Sponsored</a>
      <a href="/url?q=https%3A%2F%2Fexample.org%2Fpaper&amp;sa=U">Primary paper</a>
      <a href="/search?q=OpenAI">Google navigation</a>
      <a href="https://example.org/direct">Direct source</a>
    </body></html>`,
  );
  const result = await webSearch("OpenAI", {
    transport,
    providers: ["google"],
    maxResults: 4,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.providers_used, ["google"]);
  assert.equal(result.engine, "google_html");
  assert.deepEqual(result.results.map((item) => item.url), [
    "https://example.org/direct",
    "https://example.org/paper",
  ]);
  assert.equal(result.results.some((item) => item.title === "Sponsored"), false);
});

test("HTML extraction removes ad and consent containers from text and links", async () => {
  const html = `<html><head><title>Evidence</title></head><body>
    <div class="ad-banner"><a href="https://ads.example/click">Buy</a></div>
    <div id="cookie-consent">Accept cookies</div>
    <main><p>Primary evidence remains.</p><a href="/source">Source</a></main>
  </body></html>`;
  assert.match(extractText(html), /Primary evidence remains/);
  assert.doesNotMatch(extractText(html), /Buy|Accept cookies/);
  assert.deepEqual(extractLinks(html, "https://example.org/"), [
    { href: "/source", absolute: "https://example.org/source", text: "Source" },
  ]);
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

test("default_browser bridge uses bounded loopback JSON and feeds research", async () => {
  const calls = [];
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(JSON.stringify(payload).length) },
    text: async () => JSON.stringify(payload),
  });
  const bridge = createDefaultBrowserBridge({
    endpoint: "http://127.0.0.1:8765/v1",
    token: "test-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const payload = JSON.parse(options.body);
      if (url.endsWith("/search")) {
        return response({ results: [{ title: "Default browser result", url: "https://default.example/page" }] });
      }
      assert.equal(payload.url, "https://default.example/page");
      return response({
        status: 200,
        url: payload.url,
        final_url: payload.url,
        html: "<html><head><title>Default page</title></head><body><main><h1>Evidence</h1><p>Browser bridge page.</p></main></body></html>",
      });
    },
  });
  assert.equal(bridge.provider, DEFAULT_BROWSER_PROVIDER);
  const result = await gatherWebResearch({
    query: "default browser",
    providers: ["default_browser"],
    userBrowser: bridge,
    maxPages: 1,
  });
  assert.equal(result.pages_ok, 1);
  assert.equal(result.metadata.page_transport, "default_browser_bridge");
  assert.equal(result.metadata.default_browser_required, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  const unsafe = createDefaultBrowserBridge({ endpoint: "http://remote.example:8765" });
  const blocked = await unsafe.search("x");
  assert.equal(blocked.error_code, "default_browser_insecure_endpoint");
  const missing = await webSearch("x", { providers: ["default_browser"] });
  assert.equal(missing.error_code, "default_browser_bridge_required");
});

test("default_browser bridge interoperates over a real loopback TCP server", async () => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body || "{}");
    response.setHeader("content-type", "application/json");
    if (request.url === "/search") {
      response.end(JSON.stringify({ results: [{ title: "TCP result", url: `http://127.0.0.1:${server.address().port}/page` }] }));
      return;
    }
    assert.equal(request.url, "/fetch");
    response.end(JSON.stringify({
      status: 200,
      url: payload.url,
      final_url: payload.url,
      html: "<html><head><title>TCP page</title></head><body><main><p>Real loopback evidence.</p></main></body></html>",
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const port = server.address().port;
    const bridge = createDefaultBrowserBridge({ endpoint: `http://127.0.0.1:${port}` });
    const pack = await gatherWebResearch({
      query: "tcp default browser",
      providers: ["default_browser"],
      userBrowser: bridge,
      maxPages: 1,
    });
    assert.equal(pack.pages_ok, 1);
    assert.equal(pack.pages[0].title, "TCP page");
    assert.equal(pack.metadata.page_transport, "default_browser_bridge");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("user_browser searchMany merges query provenance and partial errors", async () => {
  const calls = [];
  const bridge = {
    async search(query) {
      calls.push(query);
      if (query === "missing") return { results: [], error_code: "empty", error: "no session hit" };
      return {
        results: [
          { title: `Result ${query}`, url: "https://example.org/shared", snippet: query },
          { title: query, url: `https://example.org/${query}` },
        ],
      };
    },
  };
  const result = await searchUserBrowserMany(bridge, ["alpha", "beta", "missing"], {
    maxQueries: 3,
    maxResultsPerQuery: 3,
    concurrency: 2,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.queries, ["alpha", "beta", "missing"]);
  assert.deepEqual(calls, ["alpha", "beta", "missing"]);
  const shared = result.hits.find((hit) => hit.url === "https://example.org/shared");
  assert.deepEqual(shared.queries, ["alpha", "beta"]);
  assert.equal(result.metadata.partial, true);
  assert.ok(result.errors.some((error) => error.includes("missing")));
});

test("user_browser exploration prioritizes relevant links and skips action links", async () => {
  const pages = {
    "https://example.org/root": {
      title: "Root",
      markdown: "root",
      links: [
        { href: "/logout", text: "logout" },
        { href: "/misc", text: "misc" },
        { href: "/guide", text: "guide" },
      ],
    },
    "https://example.org/guide": { title: "Guide", markdown: "guide evidence", links: [] },
    "https://example.org/misc": { title: "Misc", markdown: "misc evidence", links: [] },
  };
  const result = await exploreUserBrowser(
    { fetch: async (url) => ({ url, ...(pages[url] ?? { error_code: "missing" }) }) },
    "https://example.org/root",
    { query: "guide", maxPages: 2, maxDepth: 1 },
  );
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.steps[1].url, "https://example.org/guide");
  assert.equal(result.metadata.action_links_skipped, 1);
  assert.equal(result.steps[0].blockedLinks.includes("https://example.org/logout"), true);
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
  const many = await kit.searchMany(["OpenAI", "session"], { maxQueries: 2 });
  assert.equal(many.success, true);
  assert.equal(many.metadata.queries_executed, 2);
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

test("user_browser research expands focused query variants before fetching", async () => {
  const calls = [];
  const pages = {
    "https://example.org/alpha": { title: "Alpha", markdown: "alpha evidence", links: [] },
    "https://example.org/beta": { title: "Beta", markdown: "beta evidence", links: [] },
  };
  const bridge = {
    search: async (query) => {
      calls.push(query);
      return [{ title: query, url: `https://example.org/${query}` }];
    },
    fetch: async (url) => ({ url, ...(pages[url] ?? { error_code: "missing" }) }),
  };
  const pack = await gatherWebResearch({
    query: "alpha",
    task: "beta",
    providers: ["user_browser"],
    userBrowser: bridge,
    maxPages: 2,
    maxSubQueries: 2,
  });
  assert.deepEqual(pack.queries, ["alpha", "beta"]);
  assert.deepEqual(calls, ["alpha", "beta"]);
  assert.equal(pack.pages_ok, 2);
  assert.equal(pack.metadata.search_query_count, 2);
  assert.match(pack.toAgentMarkdown(), /alpha evidence/);
  assert.match(pack.toAgentMarkdown(), /beta evidence/);
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

test("provider_trace and strict_provider stay explicit", async () => {
  const transport = makeFixtureMapTransport();
  const result = await webSearch("OpenAI", { transport, providers: ["wikipedia"] });
  assert.ok(Array.isArray(result.provider_trace));
  assert.equal(result.provider_trace[0].provider, "wikipedia");
  const strict = await webSearch("OpenAI", {
    transport,
    providers: ["google_browser", "wikipedia"],
    strict_provider: true,
  });
  assert.equal(strict.error_code, "strict_provider_rejected");
  assert.equal(strict.success, false);
});

test("html tables and json-ld extract without claiming ad-free pages", () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Article"}</script></head>
<body><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>`;
  assert.match(htmlTableToMarkdown(html), /\| A \| B \|/);
  assert.equal(extractJsonLd(html)[0]["@type"], "Article");
});

test("robots.txt is heuristic allow/deny only", () => {
  const robots = "User-agent: *\nDisallow: /secret\nAllow: /\n";
  assert.equal(isRobotsAllowed(robots, "https://example.org/secret"), false);
  assert.equal(isRobotsAllowed(robots, "https://example.org/public"), true);
});

test("project index is opt-in and not a web-wide index", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hk-index-"));
  try {
    const index = new ProjectWebIndex({ root, enabled: true });
    await index.open();
    const ingested = await index.ingest({
      url: "https://example.org/a",
      title: "Alpha",
      markdown: "alpha evidence about widgets",
    });
    assert.equal(ingested.ok, true);
    const found = await index.search("widgets");
    assert.equal(found.hits[0].url, "https://example.org/a");
    assert.match(found.disclaimer, /not a complete index/i);
    await index.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project index ranks with SQLite FTS5 when available", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hk-index-fts-"));
  try {
    const index = new ProjectWebIndex({ root, enabled: true });
    await index.open();
    await index.ingest({ url: "https://example.org/a", title: "Alpha", markdown: "alpha widgets and gadgets" });
    await index.ingest({ url: "https://example.org/b", title: "Beta", markdown: "beta widgets widgets widgets" });
    const found = await index.search("widgets");
    assert.equal(found.backend, "fts5");
    assert.equal(found.hits[0].url, "https://example.org/b");
    await index.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture grounding scorer meets thresholds without inventing URLs", () => {
  const corpus = JSON.parse(readFileSync(new URL(
    "../../../../shared/contracts/conformance/browser-grounding-fixture-v1.json",
    import.meta.url,
  ), "utf8"));
  const metrics = runFixtureGrounding(corpus);
  assert.equal(metrics.scoreable, 30);
  assert.equal(metrics.invented_citations, 0);
  assert.equal(metrics.passed, true);
});

test("live grounding scorer requires real page evidence and fails closed on tampering", () => {
  const corpus = {
    source_policy: { require_https: true, allow_hosts: ["example.org"], reject_fixture_hosts: ["fixture.handoffkit.test"] },
    gates: { min_scoreable: 2, factual_accuracy: 1, completeness: 1, citation_entailment: 1, direct_claims_with_evidence: 1, invented_citations: 0 },
    questions: [
      { id: "q1", page_id: "q1", source_url: "https://example.org/a", required_facts: ["Alpha"], evidence_terms: ["Alpha", "is"], expect: "supported" },
      { id: "q2", page_id: "q2", source_url: "https://example.org/b", required_facts: [], negative_evidence: ["fictional"], expect: "not_found" },
    ],
  };
  const pages = [
    { page_id: "q1", success: true, url: "https://example.org/a", final_url: "https://example.org/a", markdown: "Alpha is a live fact.", sha256: "a".repeat(64), hash_verified: true },
    { page_id: "q2", success: true, url: "https://example.org/b", final_url: "https://example.org/b", markdown: "The material is fictional.", sha256: "b".repeat(64), hash_verified: true },
  ];
  const answers = liveGroundingOracle(corpus, pages);
  const metrics = scoreLiveGroundingRun(corpus, answers, pages);
  assert.equal(metrics.passed, true);
  assert.equal(metrics.model_accuracy_measured, false);
  assert.equal(scoreLiveGroundingRun(corpus, answers, pages.map((page) => ({ ...page, hash_verified: false }))).passed, false);
  const missingClaims = { ...answers, q1: { ...answers.q1, answer: "Alpha", claims: [], citations: [] } };
  assert.equal(scoreLiveGroundingRun(corpus, missingClaims, pages).passed, false);
  const tampered = { ...answers, q1: { ...answers.q1, claims: [{ ...answers.q1.claims[0], quote: "invented" }] } };
  assert.equal(scoreLiveGroundingRun(corpus, tampered, pages).passed, false);
});

test("live smoke gated by BROWSER_LIVE", { skip: process.env.BROWSER_LIVE !== "1" }, async () => {
  const search = await webSearch("metformin", { maxResults: 3 });
  assert.equal(search.success, true);
  assert.ok(search.count > 0);
});
