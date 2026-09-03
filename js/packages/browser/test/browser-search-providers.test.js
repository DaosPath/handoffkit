import assert from "node:assert/strict";
import test from "node:test";

import { makeFixtureMapTransport } from "../src/index.js";
import { SUPPORTED_SEARCH_PROVIDERS, providerEngine, webSearch } from "../src/search.js";

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
  for (const provider of ["brave", "bing", "kagi"]) {
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
