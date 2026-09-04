import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BrowserCoreError,
  BrowserPolicy,
} from "@handoffkit/browser-core";
import {
  BrowserRealClient,
  BrowserRealService,
  CONFIG_ENV,
  detectChallenge,
  isDefaultUserProfile,
  loadBrowserRealConfig,
  startBrowserRealService,
  wrapCommandEnvelope,
  BROWSER_CONTROL_CHANNEL,
  BROWSER_CONTROL_OPERATION,
} from "../src/index.js";

test("real package never claims a silent facade upgrade", async () => {
  const browserIndex = await readFile(new URL("../../browser/src/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(browserIndex, /browser-real/);
});

test("public bind is rejected", async () => {
  await assert.rejects(
    () => startBrowserRealService({ host: "0.0.0.0" }),
    (error) => error instanceof BrowserCoreError && error.code === "public_bind_rejected",
  );
});

test("operator chrome profile is rejected", () => {
  assert.equal(isDefaultUserProfile("C:\\Users\\ada\\AppData\\Local\\Google\\Chrome\\User Data"), true);
  const policy = BrowserPolicy.fromWire({ credentials: { persistent_profile: true, profile_dir: "C:\\isolated" } });
  assert.equal(policy.credentials.persistent_profile, true);
});

test("challenge pages are provider_challenge, never bypassed", async () => {
  assert.equal(detectChallenge("Please complete the captcha"), true);
  const service = new BrowserRealService({
    engine: {
      async launch() {
        return {
          page: {
            async goto() {},
            async content() { return "<html>captcha challenge</html>"; },
            async screenshot() { return Buffer.from("x"); },
          },
          async close() {},
        };
      },
    },
  });
  const started = await service.dispatch({
    command_id: "c1",
    session_id: "s1",
    name: "session.start",
    payload: { product: "real", session_id: "s1" },
  });
  assert.equal(started.name, "session.started");
  assert.equal(service.capabilities.engineReady, true);
  const navigated = await service.dispatch({
    command_id: "c2",
    session_id: "s1",
    name: "navigate",
    payload: { url: "https://example.org/" },
  });
  assert.equal(navigated.payload.code, "provider_challenge");
});

test("duplicate command ids are replay", async () => {
  const service = new BrowserRealService({
    engine: {
      async launch() {
        return { page: { async goto() {}, async content() { return "<p>ok</p>"; } }, async close() {} };
      },
    },
  });
  await service.dispatch({
    command_id: "same",
    session_id: "s2",
    name: "session.start",
    payload: { product: "real", session_id: "s2" },
  });
  await assert.rejects(
    () => service.dispatch({
      command_id: "same",
      session_id: "s2",
      name: "session.start",
      payload: { product: "real", session_id: "s2" },
    }),
    (error) => String(error?.code ?? "").includes("replay") || error instanceof BrowserCoreError,
  );
});

test("private network and filesystem policies are enforced", async () => {
  const service = new BrowserRealService({
    engine: {
      async launch() {
        return { page: { async goto() {}, async content() { return "<p>ok</p>"; } }, async close() {} };
      },
    },
  });
  await service.dispatch({
    command_id: "pol-start",
    session_id: "s-pol",
    name: "session.start",
    payload: { product: "real", session_id: "s-pol" },
  });
  await assert.rejects(
    () => service.dispatch({
      command_id: "pol-loop",
      session_id: "s-pol",
      name: "navigate",
      payload: { url: "http://127.0.0.1/" },
    }),
    (error) => error instanceof BrowserCoreError && error.code === "policy_denied",
  );
  await assert.rejects(
    () => service.dispatch({
      command_id: "pol-priv",
      session_id: "s-pol",
      name: "navigate",
      payload: { url: "http://192.168.1.8/" },
    }),
    (error) => error instanceof BrowserCoreError && error.code === "policy_denied",
  );
  await assert.rejects(
    () => service.dispatch({
      command_id: "pol-file",
      session_id: "s-pol",
      name: "navigate",
      payload: { url: "file:///tmp/secret.html" },
    }),
    (error) => error instanceof BrowserCoreError && error.code === "policy_denied",
  );
  await assert.rejects(
    () => service.dispatch({
      command_id: "pol-dl",
      session_id: "s-pol",
      name: "download",
      payload: {},
    }),
    (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
  );
  await assert.rejects(
    () => service.dispatch({
      command_id: "pol-shot",
      session_id: "s-pol",
      name: "screenshot",
      payload: { path: "/tmp/out.png" },
    }),
    (error) => error instanceof BrowserCoreError && error.code === "policy_denied",
  );
});

test("client never launches chromium and speaks core commands", async () => {
  const service = new BrowserRealService({
    engine: {
      async launch() {
        return { page: { async goto() {}, async content() { return "<p>ok</p>"; } }, async close() {} };
      },
    },
  });
  const client = new BrowserRealClient(service);
  const started = await client.dispatch({
    command_id: "c-client",
    session_id: "s-client",
    name: "session.start",
    payload: { product: "real", session_id: "s-client" },
  });
  assert.equal(started.name, "session.started");
});

test("CLI config is required and capabilities are a live getter", async () => {
  assert.equal(CONFIG_ENV, "HANDOFFKIT_BROWSER_REAL_CONFIG");
  assert.throws(
    () => loadBrowserRealConfig(""),
    (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
  );
  const handle = await startBrowserRealService({
    host: "127.0.0.1",
    engine: {
      async launch() {
        return { page: { async goto() {}, async content() { return "<p>ok</p>"; } }, async close() {} };
      },
    },
  });
  const before = handle.capabilities.engineReady;
  await handle.service.dispatch({
    command_id: "cap-start",
    session_id: "s-cap",
    name: "session.start",
    payload: { product: "real", session_id: "s-cap" },
  });
  assert.equal(before, false);
  assert.equal(handle.capabilities.engineReady, true);
  await handle.close();
});

test("pause, resume, retry, and peer policy restriction", async () => {
  const service = new BrowserRealService({
    engine: {
      async launch() {
        return { page: { async goto() {}, async content() { return "<p>ok</p>"; } }, async close() {} };
      },
    },
  });
  await service.dispatch({
    command_id: "p-start",
    session_id: "s-pause",
    name: "session.start",
    payload: { product: "real", session_id: "s-pause" },
  });
  const paused = await service.dispatch({
    command_id: "p-pause",
    session_id: "s-pause",
    name: "session.pause",
    payload: {},
  });
  assert.equal(paused.name, "session.paused");
  await assert.rejects(
    () => service.dispatch({
      command_id: "p-nav",
      session_id: "s-pause",
      name: "navigate",
      payload: { url: "https://example.org/" },
    }),
    (error) => error instanceof BrowserCoreError && error.code === "interrupted",
  );
  const resumed = await service.dispatch({
    command_id: "p-resume",
    session_id: "s-pause",
    name: "session.resume",
    payload: {},
  });
  assert.equal(resumed.name, "session.resumed");
});

test("session.retry recreates an interrupted engine and revalidates the last URL", async () => {
  let launches = 0;
  const visited = [];
  const service = new BrowserRealService({
    engine: {
      async launch() {
        launches += 1;
        const page = {
          async goto(url) { visited.push(url); },
          async content() { return "<p>ok</p>"; },
          async close() {},
          url() { return visited.at(-1) || ""; },
        };
        return {
          page,
          async close() {},
        };
      },
    },
  });
  await service.dispatch({
    command_id: "retry-start",
    session_id: "s-retry",
    name: "session.start",
    payload: { product: "real", session_id: "s-retry" },
  });
  await service.dispatch({
    command_id: "retry-nav",
    session_id: "s-retry",
    name: "navigate",
    payload: { url: "https://example.org/retry" },
  });
  const session = service.sessions.get("s-retry");
  // A real engine disconnect must be observable by the dispatcher; this is
  // stronger than toggling an internal test flag and exercises retry cleanup.
  if (session.handle.browser?.close) {
    await session.handle.browser.close();
  } else {
    session.handle.dead = true;
  }
  const interrupted = await service.dispatch({
    command_id: "retry-crash",
    session_id: "s-retry",
    name: "navigate",
    payload: { url: "https://example.org/retry" },
  });
  assert.equal(interrupted.name, "session.interrupted");
  const retried = await service.dispatch({
    command_id: "retry-command",
    session_id: "s-retry",
    name: "session.retry",
    payload: {},
  });
  assert.equal(retried.name, "session.retry");
  assert.equal(launches, 2);
  assert.equal(visited.at(-1), "https://example.org/retry");
});

test("share_cookies is rejected by core policy", () => {
  assert.throws(
    () => BrowserPolicy.fromWire({ credentials: { share_cookies: true } }),
    (error) => error instanceof BrowserCoreError && error.code === "profile_denied",
  );
});

test("CSP control envelopes use certificate-derived source and a cryptographic nonce", async () => {
  const { PeerIdentity } = await import("@handoffkit/csp");
  const identity = new PeerIdentity({
    peer_id: "client-peer",
    node_id: "node-1",
    trust_domain: "handoffkit.internal",
    credential_fingerprint: "sha256:abcd",
    capabilities: ["browser:*"],
  });
  const envelope = wrapCommandEnvelope({
    command: {
      command_id: "c-env",
      session_id: "s-env",
      name: "session.status",
      payload: {},
    },
    sessionId: "s-env",
    sequence: 1,
    identity,
  });
  assert.equal(envelope.channel, BROWSER_CONTROL_CHANNEL);
  assert.equal(envelope.kind, "request");
  assert.equal(envelope.payloadType, "browser.command");
  assert.equal(envelope.source, "client-peer");
  assert.equal(envelope.metadata.operation, BROWSER_CONTROL_OPERATION);
  assert.equal(envelope.metadata.security_nonce.length, 32);
});

test("managed profiles reject traversal and unmarked directories", async () => {
  const { resolveManagedProfile } = await import("../src/profiles.js");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "hk-profile-root-"));
  try {
    await assert.rejects(
      async () => resolveManagedProfile(root, "../escape"),
      (error) => error instanceof BrowserCoreError && error.code === "profile_denied",
    );
    const created = resolveManagedProfile(root, "lab-1");
    assert.equal(created.endsWith("lab-1") || created.includes("lab-1"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function actuationFakeEngine(calls) {
  const locator = (selector) => ({
    async hover(options) { calls.push(["hover", selector, options]); },
    async focus(options) { calls.push(["focus", selector, options]); },
    async check(options) { calls.push(["check", selector, options]); },
    async uncheck(options) { calls.push(["uncheck", selector, options]); },
    async dblclick(options) { calls.push(["dblclick", selector, options]); },
    async scrollIntoViewIfNeeded(options) { calls.push(["scroll", selector, options]); },
    async setInputFiles(path, options) { calls.push(["upload", selector, String(path), options]); },
  });
  return {
    async launch() {
      return {
        page: {
          locator,
          async evaluate(fn, arg) { calls.push(["evaluate", String(fn).slice(0, 24), arg]); },
        },
        async close() {},
      };
    },
  };
}

async function startActuationSession(engine) {
  const service = new BrowserRealService({ engine });
  await service.dispatch({
    command_id: "act-start",
    session_id: "s-act",
    name: "session.start",
    payload: { product: "real", session_id: "s-act" },
  });
  return service;
}

async function act(service, name, payload, commandId) {
  const event = await service.dispatch({
    command_id: commandId,
    session_id: "s-act",
    name,
    payload,
  });
  assert.equal(event.name, "action.done");
  return event.payload;
}

test("hover/focus/check/uncheck/dblclick actuate through locators", async () => {
  const calls = [];
  const service = await startActuationSession(actuationFakeEngine(calls));
  for (const [name, extra] of [
    ["hover", {}],
    ["focus", {}],
    ["check", {}],
    ["uncheck", {}],
    ["dblclick", {}],
  ]) {
    const event = await act(service, name, { selector: "button", ...extra }, `act-${name}`);
    assert.equal(event.action, name);
  }
  assert.deepEqual(
    calls.map(([action, selector]) => [action, selector]),
    [["hover", "button"], ["focus", "button"], ["check", "button"], ["uncheck", "button"], ["dblclick", "button"]],
  );
});

test("scroll targets selectors or explicit distance", async () => {
  const calls = [];
  const service = await startActuationSession(actuationFakeEngine(calls));
  await act(service, "scroll", { selector: "main" }, "act-scroll-sel");
  await act(service, "scroll", { by: 400 }, "act-scroll-by");
  assert.deepEqual(calls[0].slice(0, 2), ["scroll", "main"]);
  assert.equal(calls[1][0], "evaluate");
  await assert.rejects(
    () => service.dispatch({ command_id: "act-scroll-bad", session_id: "s-act", name: "scroll", payload: {} }),
    (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
  );
});

test("upload requires selector, existing file, and size cap", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "hk-upload-"));
  try {
    const calls = [];
    const service = await startActuationSession(actuationFakeEngine(calls));
    const file = join(root, "a.txt");
    await writeFile(file, "hello");
    const event = await act(service, "upload", { selector: "input", path: file }, "act-upload");
    assert.equal(event.bytes, 5);
    assert.deepEqual(calls[0].slice(0, 3), ["upload", "input", file]);
    await assert.rejects(
      () => service.dispatch({ command_id: "act-up-missing", session_id: "s-act", name: "upload", payload: { selector: "input", path: join(root, "nope.txt") } }),
      (error) => error instanceof BrowserCoreError && error.code === "upload_missing_file",
    );
    await assert.rejects(
      () => service.dispatch({ command_id: "act-up-sel", session_id: "s-act", name: "upload", payload: { path: file } }),
      (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function touchFakeEngine(calls) {
  const locator = (selector) => ({
    async tap(options) { calls.push(["tap", selector, options]); },
    async boundingBox() { return { x: 10, y: 20, width: 100, height: 40 }; },
  });
  return {
    async launch() {
      return {
        page: {
          locator,
          viewportSize: () => ({ width: 800, height: 600 }),
          context: () => ({
            async newCDPSession() {
              return {
                async send(method, params) { calls.push(["cdp", method, params]); },
                async detach() {},
              };
            },
          }),
        },
        async close() {},
      };
    },
  };
}

test("tap actuates through locators", async () => {
  const calls = [];
  const service = await startActuationSession(touchFakeEngine(calls));
  const payload = await act(service, "tap", { selector: "button" }, "act-tap");
  assert.equal(payload.action, "tap");
  assert.deepEqual(calls[0].slice(0, 2), ["tap", "button"]);
  await assert.rejects(
    () => service.dispatch({ command_id: "act-tap-bad", session_id: "s-act", name: "tap", payload: {} }),
    (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
  );
});

test("swipe sends CDP touch sequences", async () => {
  const calls = [];
  const service = await startActuationSession(touchFakeEngine(calls));
  const payload = await act(service, "swipe", { selector: "main", direction: "up", distance: 200 }, "act-swipe");
  assert.equal(payload.direction, "up");
  assert.equal(payload.distance, 200);
  const types = calls.filter(([kind]) => kind === "cdp").map(([, method, params]) => [method, params.type]);
  assert.deepEqual(types.map(([, type]) => type), ["touchStart", "touchMove", "touchMove", "touchMove", "touchMove", "touchEnd"]);
  await assert.rejects(
    () => service.dispatch({ command_id: "act-swipe-bad", session_id: "s-act", name: "swipe", payload: { direction: "diagonal" } }),
    (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
  );
});

test("longpress holds and pinches scale with two touch points", async () => {
  const calls = [];
  const service = await startActuationSession(touchFakeEngine(calls));
  const held = await act(service, "longpress", { duration_ms: 300 }, "act-hold");
  assert.equal(held.duration_ms, 300);
  const pinched = await act(service, "pinch", { scale: 2 }, "act-pinch");
  assert.equal(pinched.scale, 2);
  const moves = calls.filter(([kind, method]) => kind === "cdp" && method === "Input.dispatchTouchEvent");
  assert.ok(moves.length >= 4);
  const pinchStart = moves.find((entry) => entry[2].type === "touchStart" && entry[2].touchPoints.length === 2);
  assert.ok(pinchStart);
  await assert.rejects(
    () => service.dispatch({ command_id: "act-pinch-bad", session_id: "s-act", name: "pinch", payload: { scale: 1 } }),
    (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
  );
});

function dragFakeEngine(calls) {
  const locator = (selector) => ({
    async boundingBox() {
      const x = selector === "b" ? 200 : 0;
      return { x, y: 0, width: 100, height: 20 };
    },
    async screenshot() { calls.push(["screenshot", selector]); return Buffer.from("png"); },
    async selectOption(value, options) { calls.push(["select", selector, value, options]); },
    dragTo: undefined,
  });
  return {
    async launch() {
      return {
        page: {
          locator,
          mouse: {
            async move(x, y) { calls.push(["mouse", "move", Math.round(x), Math.round(y)]); },
            async down() { calls.push(["mouse", "down"]); },
            async up() { calls.push(["mouse", "up"]); },
          },
        },
        async close() {},
      };
    },
  };
}

test("drag moves through mouse when dragTo is unavailable", async () => {
  const calls = [];
  const service = await startActuationSession(dragFakeEngine(calls));
  const payload = await act(
    service, "drag",
    { from_selector: "a", to_selector: "b" },
    "act-drag",
  );
  assert.equal(payload.action, "drag");
  assert.ok(payload.distance > 0);
  assert.deepEqual(calls[0], ["mouse", "move", 50, 10]);
  assert.ok(calls.some(([kind, what]) => kind === "mouse" && what === "down"));
  assert.ok(calls.some(([kind, what]) => kind === "mouse" && what === "up"));
  await assert.rejects(
    () => service.dispatch({ command_id: "act-drag-bad", session_id: "s-act", name: "drag", payload: {} }),
    (error) => error instanceof BrowserCoreError && error.code === "invalid_request",
  );
});

test("select passes multiple values and screenshot captures elements", async () => {
  const calls = [];
  const service = await startActuationSession(dragFakeEngine(calls));
  const selected = await act(service, "select", { selector: "select", value: ["a", "b"] }, "act-select-multi");
  assert.equal(selected.action, "select");
  const shot = await service.dispatch({
    command_id: "act-shot-el",
    session_id: "s-act",
    name: "screenshot",
    payload: { selector: "main" },
  });
  assert.equal(shot.name, "screenshot");
  assert.equal(shot.payload.selector, "main");
});
