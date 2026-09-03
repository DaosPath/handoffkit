import assert from "node:assert/strict";
import test from "node:test";

import { makeFixtureMapTransport } from "../src/index.js";
import { webSearch } from "../src/search.js";
import { PROVIDER_ALIASES } from "@handoffkit/browser-core";

const SEARX_BODY = JSON.stringify({
  query: "OpenAI",
  results: [
    { title: "OpenAI API", url: "https://openai.com/api" },
    { title: "OpenAI Blog", url: "https://openai.com/blog" },
    { title: "no url", url: "" },
    { title: "js only", url: "javascript:void(0)" },
  ],
  unresponsive_engines: [],
});

test("searxng aliases are registered in browser-core", () => {
  assert.equal(PROVIDER_ALIASES.sx, "searxng");
  assert.equal(PROVIDER_ALIASES.dodo, "searxng");
});

test("webSearch searxng provider parses fixture JSON results", async () => {
  process.env.HANDOFFKIT_SEARXNG_URL = "http://127.0.0.1:8888";
  const transport = makeFixtureMapTransport();
  transport.setPage("http://127.0.0.1:8888/search?q=OpenAI&format=json", SEARX_BODY);

  const result = await webSearch("OpenAI", {
    transport,
    providers: ["searxng"],
    maxResults: 4,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.providers_requested, ["searxng"]);
  assert.deepEqual(result.providers_used, ["searxng"]);
  assert.ok(result.results.every((r) => r.url.startsWith("https://")));
  delete process.env.HANDOFFKIT_SEARXNG_URL;
});

test("webSearch searxng without HANDOFFKIT_SEARXNG_URL fails gracefully", async () => {
  delete process.env.HANDOFFKIT_SEARXNG_URL;
  delete process.env.HANDOFFKIT_SEARXNG_URLS;
  const transport = makeFixtureMapTransport();
  const result = await webSearch("OpenAI", {
    transport,
    providers: ["searxng"],
    maxResults: 4,
  });
  assert.equal(result.success, false);
  const trace = result.provider_trace.find((t) => t.provider === "searxng");
  assert.equal(trace.error_code, "provider_unavailable");
});

test("webSearch searxng supports engines, categories, and page params", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "http://127.0.0.1:8888/search?q=OpenAI&format=json&engines=brave,mojeek&categories=general&pageno=2",
    SEARX_BODY,
  );
  const result = await webSearch("OpenAI", {
    transport,
    providers: ["searxng"],
    maxResults: 4,
    searxng: { baseUrl: "http://127.0.0.1:8888", engines: ["brave", "mojeek"], categories: "general", page: 2 },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.providers_used, ["searxng"]);
});

test("webSearch searxng rejects unknown categories fail-closed", async () => {
  const transport = makeFixtureMapTransport();
  const result = await webSearch("OpenAI", {
    transport,
    providers: ["searxng"],
    maxResults: 4,
    searxng: { baseUrl: "http://127.0.0.1:8888", categories: ["telepathy"] },
  });
  assert.equal(result.success, false);
  const trace = result.provider_trace.find((t) => t.provider === "searxng");
  assert.equal(trace.error_code, "searxng_invalid_options");
});

test("webSearch searxng falls over to the next instance", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage("http://127.0.0.1:8888/search?q=OpenAI&format=json", JSON.stringify({ results: [] }));
  transport.setPage("http://127.0.0.1:8889/search?q=OpenAI&format=json", SEARX_BODY);
  const result = await webSearch("OpenAI", {
    transport,
    providers: ["searxng"],
    maxResults: 4,
    searxng: { baseUrls: ["http://127.0.0.1:8888", "http://127.0.0.1:8889"] },
  });
  assert.equal(result.success, true);
  assert.deepEqual(
    result.results.map((r) => r.url),
    ["https://openai.com/api", "https://openai.com/blog"],
  );
});
