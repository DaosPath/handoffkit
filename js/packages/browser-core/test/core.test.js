import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BrowserCapabilities,
  BrowserCoreError,
  BrowserError,
  BrowserPolicy,
  CONTRACT_VERSION,
  CORE_MODELS,
  HANDOFFKIT_BROWSER_CORE_VERSION,
  PLATFORM_SEARCH_PROVIDERS,
  parseCoreModel,
  redactSensitive,
  classifyNetworkTarget,
} from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const vectors = JSON.parse(
  await readFile(join(root, "shared", "contracts", "conformance", "browser-core-v1.json"), "utf8"),
);

const MODEL_FILES = {
  browser_error: "BrowserError",
  browser_capabilities: "BrowserCapabilities",
  browser_policy: "BrowserPolicy",
  browser_session_request: "BrowserSessionRequest",
  browser_session_state: "BrowserSessionState",
  browser_command: "BrowserCommand",
  browser_event: "BrowserEvent",
  search_request: "SearchRequest",
  search_result: "SearchResult",
  page_snapshot: "PageSnapshot",
  document_record: "DocumentRecord",
  provider_trace: "ProviderTrace",
  research_job: "ResearchJob",
  research_progress: "ResearchProgress",
  research_result: "ResearchResult",
};

test("package version matches runtime constant", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(HANDOFFKIT_BROWSER_CORE_VERSION, manifest.version);
  assert.equal(CONTRACT_VERSION, "1.20.0-alpha.2");
});

test("core sources do not import I/O", async () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = await readdir(srcRoot);
  const joined = (
    await Promise.all(files.filter((name) => name.endsWith(".js")).map((name) => readFile(join(srcRoot, name), "utf8")))
  ).join("\n");
  assert.doesNotMatch(joined, /node:fs|node:net|node:http|node:https|playwright|child_process|better-sqlite3|node:sqlite/);
});

for (const [key, modelName] of Object.entries(MODEL_FILES)) {
  test(`golden round-trip: ${modelName}`, () => {
    const expected = vectors.vectors[key];
    const parsed = parseCoreModel(modelName, expected);
    assert.deepEqual(parsed.toWire(), expected);
    assert.equal(typeof CORE_MODELS[modelName], "function");
  });
}

for (const negative of vectors.negative) {
  test(`negative: ${negative.id}`, () => {
    assert.throws(
      () => parseCoreModel(negative.model, negative.input),
      (error) => error instanceof BrowserCoreError && error.code === negative.error_code,
    );
  });
}

test("lite capabilities never claim a probed engine", () => {
  const caps = BrowserCapabilities.fromWire({
    product: "lite",
    engine: "chromium",
    engine_ready: true,
    probed_at: "2026-01-01T00:00:00Z",
    javascript: true,
  });
  assert.equal(caps.product, "lite");
  assert.equal(caps.engine, "");
  assert.equal(caps.engineReady, false);
  assert.equal(caps.javascript, false);
});

test("core product strips engine claims", () => {
  const caps = BrowserCapabilities.fromWire({
    product: "core",
    engine: "chromium",
    engine_ready: true,
    probed_at: "2026-01-01T00:00:00Z",
    javascript: true,
  });
  assert.equal(caps.engine, "");
  assert.equal(caps.engineReady, false);
  assert.equal(caps.javascript, false);
});

test("public bind is rejected without a secure configuration", () => {
  const policy = BrowserPolicy.fromWire({});
  assert.throws(
    () => policy.rejectPublicBind("0.0.0.0"),
    (error) => error instanceof BrowserCoreError && error.code === "public_bind_rejected",
  );
  assert.equal(policy.rejectPublicBind("127.0.0.1"), true);
});

test("redaction removes cookies and tokens from traces", () => {
  const redacted = redactSensitive({
    cookie: "sid=1",
    nested: { authorization: "Bearer secret", title: "ok" },
  });
  assert.equal(redacted.cookie, "[redacted]");
  assert.equal(redacted.nested.authorization, "[redacted]");
  assert.equal(redacted.nested.title, "ok");
});

test("unknown error codes fail closed", () => {
  assert.throws(
    () => BrowserError.fromWire({ code: "made_up" }),
    (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
  );
});

test("platform search provider order is frozen", () => {
  assert.deepEqual([...PLATFORM_SEARCH_PROVIDERS], [
    "google_browser",
    "project_index",
    "google_http",
    "duckduckgo",
    "wikipedia",
  ]);
});

test("network and filesystem policies fail closed by default", () => {
  const policy = BrowserPolicy.fromWire({});
  assert.equal(classifyNetworkTarget("http://127.0.0.1/").kind, "loopback");
  assert.equal(classifyNetworkTarget("http://10.0.0.5/").kind, "private");
  assert.equal(classifyNetworkTarget("https://example.org/").kind, "public");
  assert.equal(classifyNetworkTarget("data:text/html,ok").kind, "local");
  assert.throws(
    () => policy.assertNetworkUrl("http://192.168.1.8/"),
    (error) => error instanceof BrowserCoreError && error.code === "policy_denied",
  );
  assert.throws(
    () => policy.assertNetworkUrl("file:///tmp/x"),
    (error) => error instanceof BrowserCoreError && error.code === "policy_denied",
  );
  assert.equal(policy.assertNetworkUrl("https://example.org/"), true);
  assert.throws(
    () => policy.assertFilesystem("read"),
    (error) => error instanceof BrowserCoreError && error.code === "policy_denied",
  );
  assert.equal(policy.assertFilesystem("download"), true);
});

test("share_cookies and reuse_user_profile fail closed", () => {
  assert.throws(
    () => BrowserPolicy.fromWire({ credentials: { share_cookies: true } }),
    (error) => error instanceof BrowserCoreError && error.code === "profile_denied",
  );
  assert.throws(
    () => BrowserPolicy.fromWire({ credentials: { reuse_user_profile: true } }),
    (error) => error instanceof BrowserCoreError && error.code === "profile_denied",
  );
});

test("peer policy can only restrict local policy", () => {
  const local = BrowserPolicy.fromWire({
    network: { allow_public: true, allow_loopback: true, max_redirects: 5, timeout_ms: 15000 },
    javascript: { allow_evaluate: true },
  });
  const restricted = local.restrictWith({
    network: { allow_public: true, allow_loopback: false, max_redirects: 2, timeout_ms: 8000 },
    javascript: { allow_evaluate: false },
  });
  const wire = restricted.toWire();
  assert.equal(wire.network.allow_loopback, false);
  assert.equal(wire.network.max_redirects, 2);
  assert.equal(wire.javascript.allow_evaluate, false);
});

test("CGNAT, multicast, and IPv4-mapped addresses are private", () => {
  assert.equal(classifyNetworkTarget("http://100.64.0.1/").kind, "private");
  assert.equal(classifyNetworkTarget("http://224.0.0.1/").kind, "private");
  assert.equal(classifyNetworkTarget("http://[::ffff:10.1.2.3]/").kind, "private");
});

test("redaction also covers bearer values and URL userinfo", () => {
  assert.equal(redactSensitive("Bearer abc.def"), "[redacted]");
  assert.equal(redactSensitive("https://user:pass@example.org/x"), "https://[redacted]:[redacted]@example.org/x");
});

test("session.pause and artifact error codes are accepted", () => {
  const command = parseCoreModel("BrowserCommand", {
    contract_version: CONTRACT_VERSION,
    command_id: "cmd-pause-1",
    request_id: "req-1",
    session_id: "sess-1",
    name: "session.pause",
    issued_at: "2026-01-01T00:00:00Z",
    deadline_at: "",
    idempotency_key: "",
    payload: {},
  });
  assert.equal(command.name, "session.pause");
  const error = parseCoreModel("BrowserError", {
    contract_version: CONTRACT_VERSION,
    code: "download_too_large",
    message: "download exceeded 50 MiB",
    retryable: false,
    details: {},
    request_id: "req-1",
    command_id: "cmd-1",
    session_id: "sess-1",
    occurred_at: "2026-01-01T00:00:00Z",
  });
  assert.equal(error.code, "download_too_large");
});
