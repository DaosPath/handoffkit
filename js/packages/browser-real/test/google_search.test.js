import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleBrowserSearch, parseGoogleOrganicResults } from "../src/index.js";

test("Google parser keeps organic HTTPS targets and drops internal/ad links", () => {
  const html = `
    <a href="https://www.google.com/search?q=other">internal</a>
    <a href="/url?q=https%3A%2F%2Fexample.org%2Fguide%23top">redirected</a>
    <a href="https://example.org/other">direct</a>
    <a href="https://www.googleadservices.com/pagead/aclk?x=1">ad</a>
    <a href="javascript:alert(1)">script</a>
    <a href="https://example.org/guide">duplicate</a>
  `;
  assert.deepEqual(parseGoogleOrganicResults(html, 10), [
    { title: "redirected", url: "https://example.org/guide", snippet: "", provider: "google_browser" },
    { title: "direct", url: "https://example.org/other", snippet: "", provider: "google_browser" },
  ]);
});

test("Google Browser provider requires an explicit session", async () => {
  const search = createGoogleBrowserSearch({ dispatch: async () => { throw new Error("must not dispatch"); } });
  const result = await search("current status", { maxResults: 5 });
  assert.equal(result.error_code, "provider_unavailable");
  assert.deepEqual(result.hits, []);
});

test("Google challenge is fail-closed before DOM extraction", async () => {
  const calls = [];
  const search = createGoogleBrowserSearch({
    async dispatch(command) {
      calls.push(command.name);
      return { payload: { html: "unusual traffic — complete the captcha" } };
    },
  });
  const result = await search("current status", { session_id: "s1" });
  assert.equal(result.error_code, "provider_challenge");
  assert.deepEqual(result.hits, []);
  assert.deepEqual(calls, ["navigate"]);
});

test("Google Browser provider returns only parsed organic results", async () => {
  const search = createGoogleBrowserSearch({
    async dispatch(command) {
      if (command.name === "navigate") return { payload: { html: "<html>results</html>" } };
      return { payload: { html: '<a href="https://example.org/a">A</a><a href="https://google.com/search?q=x">internal</a>' } };
    },
  });
  const result = await search("current status", { session_id: "s1", maxResults: 5 });
  assert.equal(result.error_code, "");
  assert.deepEqual(result.hits, [
    { title: "A", url: "https://example.org/a", snippet: "", provider: "google_browser" },
  ]);
});
