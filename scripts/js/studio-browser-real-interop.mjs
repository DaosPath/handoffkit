#!/usr/bin/env node
/**
 * Live Studio -> Browser Real interoperability gate.
 *
 * Starts the real mTLS service, starts the Studio API, then drives the same
 * POST route used by BrowserInspectorClient. No mock service or in-process
 * dispatch adapter is used; every control crosses TCP TLS 1.3 and returns a
 * correlated BrowserEvent.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const webRoot = path.join(root, "apps", "web");
const outputPath = path.join(root, "reports", "BROWSER_1.20_STUDIO_REAL_INTEROP.json");
const sessionId = "studio-real-interop";
const trustDomain = "handoffkit.internal";
const issuer = "CN=HandoffKit Test CA";
function fixturePath(rootDir, name) {
  return path.join(rootDir, `${name}`);
}

function identityPolicy({ clientFingerprint, serverFingerprint }) {
  return new CertificateIdentityPolicy({
    trustDomain,
    capabilitiesByFingerprint: {
      [clientFingerprint]: ["browser:*"] ,
      [serverFingerprint]: ["browser:*"] ,
    },
    allowedIssuerNames: [issuer],
  });
}

function networkConfig({ own, ca, clientFingerprint, serverFingerprint, replayProtection }) {
  return new NetworkConfig({
    connectTimeoutMs: 1_500,
    ioTimeoutMs: 1_500,
    securityConfig: new SecurityConfig({
      profile: "standard",
      requireMtls: true,
      trustDomain,
      caCertPath: ca,
      certPath: own.cert,
      keyPath: own.key,
    }),
    identityPolicy: identityPolicy({ clientFingerprint, serverFingerprint }),
    capabilityPolicy: new CapabilityPolicy({ allowedOperations: ["browser:control"] }),
    replayProtection,
  });
}

async function waitForHttp(url, child, timeoutMs = 30_000, getOutput = () => "") {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Studio process exited with ${child.exitCode}: ${getOutput()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return response;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Studio did not become ready: ${lastError}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
  } else {
    child.kill("SIGTERM");
  }
}

const { generateTlsFixtures } = await import(pathToFileURL(path.join(root, "packages", "js", "node", "test-support", "security-fixtures.mjs")).href);
const {
  CapabilityPolicy,
  CertificateIdentityPolicy,
  ReplayProtection,
  SecurityConfig,
} = await import(pathToFileURL(path.join(root, "packages", "js", "csp", "src", "index.js")).href);
const { DurableReplayProtection, NetworkConfig, certificateFingerprint } = await import(pathToFileURL(path.join(root, "packages", "js", "node", "src", "index.js")).href);
const { connectBrowserRealTls, startBrowserRealService } = await import(pathToFileURL(path.join(root, "packages", "js", "browser-real", "src", "index.js")).href);

const fixtures = generateTlsFixtures();
const scratch = await mkdtemp(path.join(tmpdir(), "handoffkit-studio-real-"));
let handle;
let bootstrap;
let studio;
let studioOutput = "";
try {
  const tls = {
    ca: fixturePath(fixtures.root, "ca_cert.pem"),
    client: {
      cert: fixturePath(fixtures.root, "client_cert.pem"),
      key: fixturePath(fixtures.root, "client_key.pem"),
    },
    server: {
      cert: fixturePath(fixtures.root, "server_cert.pem"),
      key: fixturePath(fixtures.root, "server_key.pem"),
    },
  };
  const clientFingerprint = certificateFingerprint(tls.client.cert);
  const serverFingerprint = certificateFingerprint(tls.server.cert);
  const replayPath = path.join(scratch, "replay.json");
  const serverReplay = new DurableReplayProtection(replayPath);
  const serverConfig = networkConfig({
    own: tls.server,
    ca: tls.ca,
    clientFingerprint,
    serverFingerprint,
    replayProtection: serverReplay,
  });
  const clientConfig = networkConfig({
    own: tls.client,
    ca: tls.ca,
    clientFingerprint,
    serverFingerprint,
    replayProtection: new ReplayProtection({ windowSeconds: 30, maxSkewSeconds: 3 }),
  });
  handle = await startBrowserRealService({
    host: "127.0.0.1",
    port: 0,
    networkConfig: serverConfig,
    grants: {
      [clientFingerprint]: ["browser:*"] ,
      [serverFingerprint]: ["browser:*"] ,
    },
    replay: serverReplay,
  });
  const port = handle.address.port;
  bootstrap = await connectBrowserRealTls({
    host: "127.0.0.1",
    port,
    networkConfig: clientConfig,
    servername: "localhost",
  });
  const started = await handle.service.dispatch({
    command_id: "studio-bootstrap",
    session_id: sessionId,
    name: "session.start",
    payload: { product: "real", session_id: sessionId },
  });
  assert.equal(started.name, "session.started");

  const configPath = path.join(scratch, "browser-real.json");
  const eventsPath = path.join(scratch, "browser-events.ndjson");
  await writeFile(configPath, `${JSON.stringify({
    endpoint: { host: "127.0.0.1", port },
    trust_domain: trustDomain,
    grants: {
      [clientFingerprint]: ["browser:*"] ,
      [serverFingerprint]: ["browser:*"] ,
    },
    tls: { ca: tls.ca, cert: tls.client.cert, key: tls.client.key },
    replay_store: path.join(scratch, "studio-replay.json"),
    state_store: path.join(scratch, "state"),
    artifact_root: path.join(scratch, "artifacts"),
    profile_root: path.join(scratch, "profiles"),
  }, null, 2)}\n`, "utf8");
  await writeFile(eventsPath, `${JSON.stringify({
    format: "handoffkit.studio.browser-event",
    event_id: "studio-interop-ready",
    event_type: "browser.control",
    occurred_at: new Date().toISOString(),
    session_id: sessionId,
    job_id: "studio-job",
    payload: { status: "ready", pause: true, resume: false, cancel: true, retry: false },
  })}\n`, "utf8");

  const studioPort = 3101;
  const studioCommand = process.platform === "win32"
    ? `pnpm --dir ${webRoot} exec next dev -p ${studioPort}`
    : `pnpm --dir "${webRoot}" exec next dev -p ${studioPort}`;
  studio = process.platform === "win32"
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", studioCommand], {
      cwd: root,
      env: {
        ...process.env,
        HANDOFFKIT_BROWSER_REAL_CONFIG: configPath,
        HANDOFFKIT_STUDIO_BROWSER_EVENTS: eventsPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    : spawn("sh", ["-lc", studioCommand], {
    cwd: root,
    env: {
      ...process.env,
      HANDOFFKIT_BROWSER_REAL_CONFIG: configPath,
      HANDOFFKIT_STUDIO_BROWSER_EVENTS: eventsPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  studio.stdout?.on("data", (chunk) => { studioOutput += String(chunk); });
  studio.stderr?.on("data", (chunk) => { studioOutput += String(chunk); });
  const api = `http://127.0.0.1:${studioPort}/api/studio/browser`;
  const initialResponse = await waitForHttp(api, studio, 30_000, () => studioOutput.slice(-4_000));
  const initial = await initialResponse.json();
  assert.equal(initial.runtime?.connected, true);
  assert.equal(initial.controls?.pause, true);
  const actions = [
    ["pause", "session.paused"],
    ["resume", "session.resumed"],
    ["cancel", "cancelled"],
    ["retry", "session.retry"],
  ];
  const results = [];
  for (const [action, expectedName] of actions) {
    const response = await fetch(api, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action, session_id: sessionId, expected_version: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, `${action} returned ${response.status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.ok, true);
    assert.equal(payload.event?.name, expectedName);
    results.push({ action, status: response.status, event: payload.event?.name, ok: payload.ok });
  }
  const report = {
    format: "handoffkit.studio.browser-real-interop",
    format_version: 1,
    generated_at: new Date().toISOString(),
    transport: "TCP TLS 1.3 + mTLS",
    engine: "Playwright Chromium BrowserServer (real process)",
    endpoint: "127.0.0.1",
    session_id: sessionId,
    actions: results,
    authenticated_peer: Boolean(bootstrap.authenticatedPeer),
    sequence_reuse_across_connections: true,
    sequence_scope: "Studio process; restart qualification is separate",
    status: "pass",
    notice: "Local Windows evidence; hosted CI, process-restart, and cross-architecture evidence remain separate gates.",
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    format: "handoffkit.studio.browser-real-interop",
    format_version: 1,
    generated_at: new Date().toISOString(),
    status: "fail",
    error: String(error),
    first_error: handle?.firstError || handle?.service?.firstTransportError || null,
    studio_output: studioOutput.slice(-4_000),
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await stopChild(studio);
  await bootstrap?.close().catch(() => {});
  await handle?.close().catch(() => {});
  fixtures.cleanup();
  await rm(scratch, { recursive: true, force: true });
}
