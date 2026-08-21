#!/usr/bin/env node
/**
 * Real TCP TLS/mTLS HK-CSP interop: C++ BrowserRealTlsClient -> Node service.
 *
 * This gate qualifies protocol, certificate identity, transcript, replay, and
 * correlation. The injected session engine is deliberately reported as such;
 * this script does not claim Chromium or Playwright coverage.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outputPath = path.join(root, "reports", "BROWSER_1.20_BROWSER_REAL_CPP_INTEROP.json");
const trustDomain = "handoffkit.internal";
const issuer = "CN=HandoffKit Test CA";
const sessionId = "cpp-browser-real-interop";

function fixturePath(rootDir, name) {
  return path.join(rootDir, name);
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
    connectTimeoutMs: 2_000,
    ioTimeoutMs: 2_000,
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

function cppBinary() {
  const candidates = [
    process.env.HANDOFFKIT_CPP_BROWSER_REAL_CLIENT,
    path.join(root, ".local-tests", "cpp-tls-build", process.platform === "win32" ? "test_browser_real_tls.exe" : "test_browser_real_tls"),
    path.join(root, "packages", "cpp", "build", process.platform === "win32" ? "test_browser_real_tls.exe" : "test_browser_real_tls"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`C++ Browser Real client binary unavailable; checked ${candidates.join(", ")}`);
  }
  return found;
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

async function runCpp(binary, configPath, timeoutMs = 20_000) {
  const child = spawn(binary, [configPath], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("C++ Browser Real client timed out")), timeoutMs);
      timer.unref?.();
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    if (exitCode.code !== 0) {
      throw new Error(`C++ Browser Real client exited ${exitCode.code ?? "null"}/${exitCode.signal ?? ""}: ${stderr || stdout}`);
    }
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) throw new Error("C++ Browser Real client produced no evidence");
    return JSON.parse(lines.at(-1));
  } finally {
    await stopChild(child);
  }
}

const { generateTlsFixtures } = await import(pathToFileURL(path.join(root, "packages", "js", "node", "test-support", "security-fixtures.mjs")).href);
const {
  CapabilityPolicy,
  CertificateIdentityPolicy,
  ReplayProtection,
  SecurityConfig,
} = await import(pathToFileURL(path.join(root, "packages", "js", "csp", "src", "index.js")).href);
const {
  DurableReplayProtection,
  NetworkConfig,
  certificateFingerprint,
  peerIdentityFromCertificate,
} = await import(pathToFileURL(path.join(root, "packages", "js", "node", "src", "index.js")).href);
const { startBrowserRealService } = await import(pathToFileURL(path.join(root, "packages", "js", "browser-real", "src", "index.js")).href);

const fixtures = generateTlsFixtures();
const scratch = await mkdtemp(path.join(tmpdir(), "handoffkit-browser-cpp-"));
let handle;
let report;
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
  const replay = new DurableReplayProtection(path.join(scratch, "replay.json"));
  const serverConfig = networkConfig({
    own: tls.server,
    ca: tls.ca,
    clientFingerprint,
    serverFingerprint,
    replayProtection: replay,
  });

  handle = await startBrowserRealService({
    host: "127.0.0.1",
    port: 0,
    networkConfig: serverConfig,
    grants: {
      [clientFingerprint]: ["browser:*"] ,
      [serverFingerprint]: ["browser:*"] ,
    },
    replay,
    // Protocol gate only. No Chromium capability is claimed by this script.
    engine: {
      async launch() {
        const page = {
          async goto() {},
          async content() { return "<p>interop</p>"; },
          async screenshot() { return Buffer.from("interop"); },
          async goBack() { return true; },
        };
        return { page, async close() {} };
      },
    },
  });
  assert.ok(handle.address?.port, "Node Browser Real service did not expose a TCP port");

  const clientIdentity = peerIdentityFromCertificate(tls.client.cert, ["browser:*"]).toWire();
  const now = Date.now();
  const issued = new Date(now).toISOString();
  const deadline = new Date(now + 10_000).toISOString();
  const commands = [
    {
      contract_version: "1.20.0-alpha.1",
      command_id: "cpp-session-start",
      request_id: "cpp-request-start",
      session_id: sessionId,
      name: "session.start",
      issued_at: issued,
      deadline_at: deadline,
      idempotency_key: "cpp-session-start-key",
      payload: { product: "real", session_id: sessionId, headless: true },
    },
    {
      contract_version: "1.20.0-alpha.1",
      command_id: "cpp-session-status",
      request_id: "cpp-request-status",
      session_id: sessionId,
      name: "session.status",
      issued_at: new Date(Date.now()).toISOString(),
      deadline_at: new Date(Date.now() + 10_000).toISOString(),
      idempotency_key: "cpp-session-status-key",
      payload: {},
    },
  ];
  const configPath = path.join(scratch, "cpp-client.json");
  await writeFile(configPath, `${JSON.stringify({
    host: "127.0.0.1",
    port: handle.address.port,
    server_name: "localhost",
    trust_domain: trustDomain,
    ca_cert_path: tls.ca,
    cert_path: tls.client.cert,
    key_path: tls.client.key,
    server_fingerprint: serverFingerprint,
    expected_server: { peer_id: "server-peer", node_id: "server-node" },
    client_identity: clientIdentity,
    commands,
  }, null, 2)}\n`, "utf8");

  const binary = cppBinary();
  const cpp = await runCpp(binary, configPath);
  assert.equal(cpp.status, "pass");
  assert.equal(cpp.transport, "tcp_tls_mtls");
  assert.equal(cpp.tls_version, "TLSv1.3");
  assert.equal(cpp.local_peer_id, "client-peer");
  assert.equal(cpp.authenticated_peer_id, "server-peer");
  assert.equal(cpp.authenticated_node_id, "server-node");
  assert.equal(cpp.response_count, commands.length);
  assert.deepEqual(cpp.responses.map((event) => event.name), ["session.started", "session.status"]);
  report = {
    format: "handoffkit.browser-real.cpp-tcp-interop",
    format_version: 1,
    generated_at: new Date().toISOString(),
    status: "pass",
    transport: "TCP TLS 1.3 + mTLS",
    direction: "C++ BrowserRealTlsClient -> Node BrowserRealService",
    authenticated_peer: {
      peer_id: cpp.authenticated_peer_id,
      node_id: cpp.authenticated_node_id,
      worker_id: cpp.authenticated_worker_id,
      credential_fingerprint: cpp.authenticated_fingerprint,
    },
    commands: cpp.responses.map((event) => ({ name: event.name, session_id: event.session_id })),
    local_identity_derived_from_certificate: true,
    response_correlation_checked_by_cpp: true,
    response_transcript_checked_by_cpp: true,
    response_replay_checked_by_cpp: true,
    engine: "injected deterministic session engine; Chromium/Playwright not claimed",
    notice: "Local Windows evidence. Hosted Linux/macOS ARM64 and Chromium soak remain separate gates.",
  };
} catch (error) {
  report = {
    format: "handoffkit.browser-real.cpp-tcp-interop",
    format_version: 1,
    generated_at: new Date().toISOString(),
    status: "fail",
    error: String(error?.message ?? error),
    first_error: handle?.firstError || handle?.service?.firstTransportError || null,
  };
  process.exitCode = 1;
} finally {
  await handle?.close().catch(() => {});
  fixtures.cleanup();
  await rm(scratch, { recursive: true, force: true });
}

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
