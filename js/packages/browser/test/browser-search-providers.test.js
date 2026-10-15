import assert from "node:assert/strict";
import test from "node:test";

import { makeFixtureMapTransport } from "../src/index.js";
import { SUPPORTED_SEARCH_PROVIDERS, providerEngine, suggestQueries, webSearch } from "../src/search.js";

const BRAVE_BODY = JSON.stringify({
  query: { original: "OpenAI" },
  web: {
    results: [
      { title: "OpenAI API", url: "https://openai.com/api" },
      { title: "OpenAI Blog", url: "https://openai.com/blog" },
      { title: "no url", url: "" },
    ],
  },
});

const BING_BODY = JSON.stringify({
  queryContext: { originalQuery: "OpenAI" },
  webPages: {
    value: [
      { name: "OpenAI API", url: "https://openai.com/api" },
      { name: "OpenAI Blog", url: "https://openai.com/blog" },
      { name: "no url", url: "" },
    ],
  },
});

const KAGI_BODY = JSON.stringify({
  meta: { id: "abc", node: "us" },
  data: [
    { t: 0, title: "OpenAI API", url: "https://openai.com/api" },
    { t: 0, title: "OpenAI Blog", url: "https://openai.com/blog" },
    { t: 0, title: "no url", url: "" },
  ],
});

const KEYS = ["HANDOFFKIT_BRAVE_API_KEY", "HANDOFFKIT_BING_API_KEY", "HANDOFFKIT_KAGI_API_KEY"];

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

test("brave/bing/kagi are supported providers with json engines", () => {
  for (const provider of ["brave", "bing", "kagi", "mojeek", "marginalia", "startpage"]) {
    assert.ok(SUPPORTED_SEARCH_PROVIDERS.includes(provider));
  }
  assert.equal(providerEngine(["brave"]), "brave_json");
  assert.equal(providerEngine(["bing"]), "bing_json");
  assert.equal(providerEngine(["kagi"]), "kagi_json");
});

test("webSearch brave provider parses fixture JSON results", async () => {
  process.env.HANDOFFKIT_BRAVE_API_KEY = "test-key";
  const transport = makeFixtureMapTransport();
  transport.setPage("https://api.search.brave.com/res/v1/web/search?q=OpenAI&count=4", BRAVE_BODY);
  try {
    const result = await webSearch("OpenAI", { transport, providers: ["brave"], maxResults: 4 });
    assert.equal(result.success, true);
    assert.deepEqual(result.providers_used, ["brave"]);
    assert.deepEqual(
      result.results.map((r) => r.url),
      ["https://openai.com/api", "https://openai.com/blog"],
    );
  } finally {
    clearKeys();
  }
});

test("webSearch bing provider parses fixture JSON results", async () => {
  process.env.HANDOFFKIT_BING_API_KEY = "test-key";
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://api.bing.microsoft.com/v7.0/search?q=OpenAI&count=4&responseFilter=Webpages",
    BING_BODY,
  );
  try {
    const result = await webSearch("OpenAI", { transport, providers: ["bing"], maxResults: 4 });
    assert.equal(result.success, true);
    assert.deepEqual(result.providers_used, ["bing"]);
    assert.deepEqual(
      result.results.map((r) => r.url),
      ["https://openai.com/api", "https://openai.com/blog"],
    );
  } finally {
    clearKeys();
  }
});

test("webSearch kagi provider parses fixture JSON results", async () => {
  process.env.HANDOFFKIT_KAGI_API_KEY = "test-key";
  const transport = makeFixtureMapTransport();
  transport.setPage("https://kagi.com/api/v0/search?q=OpenAI", KAGI_BODY);
  try {
    const result = await webSearch("OpenAI", { transport, providers: ["kagi"], maxResults: 4 });
    assert.equal(result.success, true);
    assert.deepEqual(result.providers_used, ["kagi"]);
    assert.deepEqual(
      result.results.map((r) => r.url),
      ["https://openai.com/api", "https://openai.com/blog"],
    );
  } finally {
    clearKeys();
  }
});

test("webSearch key-gated providers fail closed without keys", async () => {
  clearKeys();
  const transport = makeFixtureMapTransport();
  for (const provider of ["brave", "bing", "kagi"]) {
    const result = await webSearch("OpenAI", { transport, providers: [provider], maxResults: 4 });
    assert.equal(result.success, false);
    const trace = result.provider_trace.find((t) => t.provider === provider);
    assert.equal(trace.error_code, "provider_unavailable");
  }
});
test("webSearch dedups tracking variants canonically", async () => {
  process.env.HANDOFFKIT_BRAVE_API_KEY = "test-key";
  process.env.HANDOFFKIT_BING_API_KEY = "test-key";
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://api.search.brave.com/res/v1/web/search?q=OpenAI&count=8",
    JSON.stringify({ web: { results: [{ title: "A", url: "https://openai.com/api?utm_source=x" }] } }),
  );
  transport.setPage(
    "https://api.bing.microsoft.com/v7.0/search?q=OpenAI&count=8&responseFilter=Webpages",
    JSON.stringify({ webPages: { value: [{ name: "A", url: "https://openai.com/api?fbclid=y" }] } }),
  );
  try {
    const result = await webSearch("OpenAI", { transport, providers: ["brave", "bing"] });
    assert.equal(result.success, true);
    assert.deepEqual(
      result.results.map((r) => r.url),
      ["https://openai.com/api"],
    );
  } finally {
    clearKeys();
  }
});

test("json fetch retries once after 429", async () => {
  process.env.HANDOFFKIT_BRAVE_API_KEY = "test-key";
  let calls = 0;
  const transport = {
    async get() {
      calls += 1;
      if (calls === 1) return { status: 429, body: "", headers: {} };
      return { status: 200, body: BRAVE_BODY, headers: {} };
    },
  };
  try {
    const result = await webSearch("OpenAI", { transport, providers: ["brave"], maxResults: 4 });
    assert.equal(result.success, true);
    assert.equal(calls, 2);
  } finally {
    clearKeys();
  }
});

test("webSearch keyless html engines parse anchors", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://www.mojeek.com/search?q=OpenAI",
    '<html><body><a class="title" href="https://openai.com/api">OpenAI API</a>' +
      '<a href="https://www.mojeek.com/preferences">prefs</a></body></html>',
  );
  transport.setPage(
    "https://search.marginalia.nu/search?query=OpenAI",
    '<html><body><a href="https://openai.com/blog">OpenAI Blog</a></body></html>',
  );
  transport.setPage(
    "https://www.startpage.com/sp/search?query=OpenAI",
    '<html><body><a class="w-gl__result-title" href="https://openai.com/api">OpenAI API</a>' +
      '<a href="https://www.startpage.com/r">internal</a></body></html>',
  );
  for (const [provider, expected] of [
    ["mojeek", ["https://openai.com/api"]],
    ["marginalia", ["https://openai.com/blog"]],
    ["startpage", ["https://openai.com/api"]],
  ]) {
    const result = await webSearch("OpenAI", { transport, providers: [provider], maxResults: 4 });
    assert.equal(result.success, true);
    assert.deepEqual(result.providers_used, [provider]);
    assert.deepEqual(result.results.map((r) => r.url), expected);
  }
});

test("suggestQueries returns completions and fails closed", async () => {
  process.env.HANDOFFKIT_BRAVE_API_KEY = "test-key";
  process.env.HANDOFFKIT_BING_API_KEY = "test-key";
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://api.search.brave.com/res/v1/suggest?q=Open",
    JSON.stringify({ suggestions: [{ query: "OpenAI" }, "OpenAI API"] }),
  );
  transport.setPage(
    "https://api.bing.microsoft.com/v7.0/Suggestions?q=Open",
    JSON.stringify({ suggestionGroups: [{ searchSuggestions: [{ displayText: "OpenAI" }] }] }),
  );
  try {
    const brave = await suggestQueries("brave", "Open", { transport });
    assert.deepEqual(brave.suggestions, ["OpenAI", "OpenAI API"]);
    const bing = await suggestQueries("bing", "Open", { transport });
    assert.deepEqual(bing.suggestions, ["OpenAI"]);
    const unknown = await suggestQueries("nope", "Open", { transport });
    assert.equal(unknown.error_code, "unsupported_provider");
  } finally {
    clearKeys();
  }
  const keyless = await suggestQueries("brave", "Open", { transport: makeFixtureMapTransport() });
  assert.equal(keyless.error_code, "provider_unavailable");
});
