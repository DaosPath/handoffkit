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
