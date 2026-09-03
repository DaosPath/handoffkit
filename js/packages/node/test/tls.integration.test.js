import assert from "node:assert/strict";
import { X509Certificate, randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";

import {
  AuthenticationError,
  AuthorizationError,
  CapabilityPolicy,
  CertificateIdentityPolicy,
  CredentialRotationPolicy,

  MessageEnvelope,
  PeerIdentity,
  ReplayDetectedError,
  ReplayProtection,
  SecurityConfig,
  SecurityError,
  SecurityProfile,
} from "@handoffkit/csp";

import {
  DurableReplayProtection,
  DurableRevocationPolicy,
  HYBRID_PQ_GROUP,
  NetworkConfig,
  ReloadableTlsContext,
  TcpTransport,
  buildSecurityTranscript,

  buildTlsOptions,
  certificateFingerprint,
  detectHybridPqSupport,
  getSupportedNodeCryptoCapabilities,
  RevocationEntry,

} from "../src/index.js";
import { generateTlsFixtures } from "../test-support/security-fixtures.mjs";

const generatedFixtures = generateTlsFixtures();
const FIXTURES = generatedFixtures.root;
after(() => generatedFixtures.cleanup());
const pathFor = (name) => resolve(FIXTURES, name);
const CA = pathFor("ca_cert.pem");
const ROGUE_CA = pathFor("rogue_ca_cert.pem");
const TRUST_DOMAIN = "handoffkit.internal";
const ISSUER = "CN=HandoffKit Test CA";
const NEXT_ISSUER = "CN=HandoffKit Next Test CA";

const OPERATION = "message:echo";

function fixtureIdentity(name, capabilities = [OPERATION]) {
  const certificate = new X509Certificate(fs.readFileSync(pathFor(`${name}_cert.pem`)));
  const identityUri = certificate.subjectAltName
    .split(/,\s*/)
    .find((value) => value.startsWith("URI:spiffe://"))
    .slice("URI:".length);
  const parsed = new URL(identityUri);
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  return new PeerIdentity({
    peer_id: parts[1],
    node_id: parts[3],
    worker_id: parts.length === 6 ? parts[5] : null,
    trust_domain: parsed.hostname,
    credential_fingerprint: certificateFingerprint(pathFor(`${name}_cert.pem`)),
    capabilities,
    issued_at: Math.floor(certificate.validFromDate.getTime() / 1000),
    expires_at: Math.floor(certificate.validToDate.getTime() / 1000),
  });
}

function identityPolicy(
  certificateNames,
  {
    expected = null,
    revoked = [],
    trustDomain = TRUST_DOMAIN,
    revocationPolicy = null,
    rotationPolicy = null,
    allowedIssuerNames = null,
  } = {},
) {

  const capabilitiesByFingerprint = Object.fromEntries(
    certificateNames.map((name) => [
      certificateFingerprint(pathFor(`${name}_cert.pem`)),
      [OPERATION],
    ]),
  );
  return new CertificateIdentityPolicy({
    trustDomain,
    capabilitiesByFingerprint,
    revokedFingerprints: revoked,
    expectedPeerId: expected?.peerId,
    expectedNodeId: expected?.nodeId,
    expectedWorkerId: expected?.workerId,
    allowedIssuerNames: allowedIssuerNames
      || (trustDomain === TRUST_DOMAIN ? [ISSUER] : []),
    revocationPolicy,
    rotationPolicy,

  });
}

function networkConfig(
  ownCertificate,
  acceptedPeers,
  {
    ca = CA,
    requireMtls = true,
    peerExpected = null,
    replayProtection = new ReplayProtection({ windowSeconds: 30, maxSkewSeconds: 3 }),
    revoked = [],
    profile = SecurityProfile.STANDARD,
    trustDomain = TRUST_DOMAIN,
    connectTimeoutMs = 1000,
    ioTimeoutMs = 1000,
    revocationPolicy = null,
    rotationPolicy = null,
    allowedIssuerNames = null,
    tlsContextProvider = null,

  } = {},
) {
  return new NetworkConfig({
    connectTimeoutMs,
    ioTimeoutMs,
    securityConfig: new SecurityConfig({
      profile,
      requireMtls,
      trustDomain,
      caCertPath: ca,
      certPath: ownCertificate ? pathFor(`${ownCertificate}_cert.pem`) : null,
      keyPath: ownCertificate ? pathFor(`${ownCertificate}_key.pem`) : null,
      replayWindowSeconds: 30,
      maxClockSkewSeconds: 3,
    }),
    identityPolicy: identityPolicy(acceptedPeers, {
      expected: peerExpected,
      revoked,
      trustDomain,
      revocationPolicy,
      rotationPolicy,
      allowedIssuerNames,
    }),
    capabilityPolicy: new CapabilityPolicy({ allowedOperations: [OPERATION] }),
    replayProtection,
    tlsContextProvider,

  });
}

function secureEnvelope(
  identity,
  {
    sessionId = "tls-session",
    sequence = 1,
    nonce = "nonce-1",
    operation = OPERATION,
    createdAt = new Date().toISOString(),
    declaredOverrides = {},
  } = {},
) {
  return new MessageEnvelope({
    messageId: `msg-${randomUUID()}`,
    sessionId,
    channel: "secure",
    kind: "data",
    source: identity.peerId,
    sequence,
    createdAt,
    payloadType: "json",
    payload: { ok: true },
    metadata: {
      peer_identity: { ...identity.toWire(), ...declaredOverrides },
      security_nonce: nonce,
      operation,
    },
  });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections?.();
  await closed;
}

test("Node TLS 1.3 mTLS uses SNI, hostname verification, and certificate identity", async (t) => {
  const clientIdentity = fixtureIdentity("client");
  const serverIdentity = fixtureIdentity("server");
  const serverConfig = networkConfig("server", ["client"], { peerExpected: clientIdentity });
  const clientConfig = networkConfig("client", ["server"], { peerExpected: serverIdentity });
  let resolveHandled;
  let rejectHandled;
  const handled = new Promise((resolvePromise, rejectPromise) => {
    resolveHandled = resolvePromise;
    rejectHandled = rejectPromise;
  });

  const server = await TcpTransport.startServer(async (transport) => {
    try {
      assert.deepEqual(transport.authenticatedPeer.toWire(), clientIdentity.toWire());
      assert.equal(transport.socket.getProtocol(), "TLSv1.3");
      assert.equal(transport.socket.servername, "localhost");
      const request = await transport.receive();
      assert.equal(
        request.metadata.security_transcript.format,
        "handoffkit.security.transcript",
      );

      await transport.send(secureEnvelope(serverIdentity, {
        sessionId: request.sessionId,
        nonce: "server-response-1",
      }));
      resolveHandled();
    } catch (error) {
      rejectHandled(error);
    } finally {
      await transport.close();
    }
  }, "127.0.0.1", 0, { config: serverConfig });
  t.after(() => closeServer(server));

  const client = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: clientConfig,
    servername: "localhost",
  });
  assert.deepEqual(client.authenticatedPeer.toWire(), serverIdentity.toWire());
  assert.equal(client.socket.getProtocol(), "TLSv1.3");
  await client.send(secureEnvelope(clientIdentity));
  const response = await client.receive();
  assert.equal(response.source, "server-peer");
  assert.equal(response.metadata.security_transcript.selected_profile, "standard");

  await handled;
  await client.close();
});

test("Node TLS route rejects a validly rehashed downgrade transcript", async (t) => {
  let resolveResult;
  const result = new Promise((resolveCall) => { resolveResult = resolveCall; });
  const server = await TcpTransport.startServer(async (transport) => {
    try {
      await transport.receive();
      resolveResult("accepted");
    } catch (error) {
      resolveResult(error.code);
    } finally {
      await transport.close();
    }
  }, "127.0.0.1", 0, {
    config: networkConfig("server", ["client"]),
  });
  t.after(() => closeServer(server));
  const clientIdentity = fixtureIdentity("client");
  const client = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: networkConfig("client", ["server"]),
    servername: "localhost",
  });
  const original = secureEnvelope(clientIdentity, { sessionId: "downgrade" });
  const sender = new PeerIdentity({
    ...client.localCertificateIdentity.toWire(),
    capabilities: clientIdentity.capabilities,
  });
  const transcript = buildSecurityTranscript({
    protocolVersion: original.protocolVersion,
    requestedProfile: SecurityProfile.STANDARD,
    selectedProfile: SecurityProfile.LOCAL,
    sender,
    receiver: client.authenticatedPeer,
    tlsVersion: "TLSv1.3",
    negotiatedGroup: null,
    sessionId: original.sessionId,
    handshakeNonce: original.metadata.security_nonce,
    timestamp: original.createdAt,
  });
  const tampered = MessageEnvelope.fromWire({
    ...original.toWire(),
    metadata: { ...original.metadata, security_transcript: transcript.toWire() },
  });
  const payload = Buffer.from(tampered.toJSONString(), "utf8");
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  client.socket.write(frame);
  assert.equal(await result, "security_profile_mismatch");
  client.socket.destroy();
});


for (const [serverCertificate, clientCa, code] of [
  ["wrong_host_server", CA, "ERR_TLS_CERT_ALTNAME_INVALID"],
  ["expired_server", CA, "CERT_HAS_EXPIRED"],
  ["server", ROGUE_CA, "SELF_SIGNED_CERT_IN_CHAIN"],
  ["rogue_server", CA, "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
]) {
  test(`Node TLS rejects ${serverCertificate}`, async (t) => {
    const serverConfig = networkConfig(serverCertificate, ["client"], { requireMtls: false });
    const server = await TcpTransport.startServer(
      async (transport) => transport.close(),
      "127.0.0.1",
      0,
      { config: serverConfig },
    );
    t.after(() => closeServer(server));
    const clientConfig = networkConfig("client", [serverCertificate], {
      ca: clientCa,
      requireMtls: false,
    });
    await assert.rejects(
      TcpTransport.connect("127.0.0.1", server.address().port, {
        config: clientConfig,
        servername: "localhost",
      }),
      (error) => error.code === code || error.cause?.code === code,
    );
  });
}

test("Node mTLS rejects a client without a certificate", async (t) => {
  const serverConfig = networkConfig("server", ["client"]);
  let called = false;
  const server = await TcpTransport.startServer(() => { called = true; }, "127.0.0.1", 0, {
    config: serverConfig,
  });
  t.after(() => closeServer(server));
  const clientConfig = networkConfig(null, ["server"], { requireMtls: false });
  let client;
  await assert.rejects(async () => {
    client = await TcpTransport.connect("127.0.0.1", server.address().port, {
      config: clientConfig,
      servername: "localhost",
    });
    await client.send(secureEnvelope(fixtureIdentity("client")));
    await client.receive();
  });
  client?.socket.destroy();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  assert.equal(called, false);
});

test("Node TLS handshake obeys connect timeout and close is bounded", async (t) => {
  let acceptedSocket = null;
  const stalled = createServer((socket) => { acceptedSocket = socket; });
  const port = await listen(stalled);
  t.after(async () => {
    acceptedSocket?.destroy();
    await closeServer(stalled);
  });
  const config = networkConfig("client", ["server"], {
    connectTimeoutMs: 30,
    ioTimeoutMs: 30,
  });
  await assert.rejects(
    TcpTransport.connect("127.0.0.1", port, { config, servername: "localhost" }),
    /timed out/,
  );
  acceptedSocket?.destroy();
});

for (const [field, value] of [
  ["peer_id", "spoofed-peer"],
  ["node_id", "spoofed-node"],
  ["worker_id", "spoofed-worker"],
  ["trust_domain", "evil.invalid"],
  ["credential_fingerprint", "sha256:00"],
  ["capabilities", ["*"]],
]) {
  test(`Node secure receive rejects spoofed ${field}`, async (t) => {
    const clientIdentity = fixtureIdentity("client");
    const serverConfig = networkConfig("server", ["client"]);
    let resolveResult;
    const result = new Promise((resolvePromise) => { resolveResult = resolvePromise; });
    const server = await TcpTransport.startServer(async (transport) => {
      try {
        await transport.receive();
        resolveResult(null);
      } catch (error) {
        resolveResult(error);
      } finally {
        await transport.close();
      }
    }, "127.0.0.1", 0, { config: serverConfig });
    t.after(() => closeServer(server));
    const client = await TcpTransport.connect("127.0.0.1", server.address().port, {
      config: networkConfig("client", ["server"]),
      servername: "localhost",
    });
    await client.send(secureEnvelope(clientIdentity, { declaredOverrides: { [field]: value } }));
    const error = await result;
    assert.ok(error instanceof AuthenticationError);
    assert.equal(error.code, "declared_identity_mismatch");
    assert.ok(error.details.fields.includes(field));
    client.socket.destroy();
  });
}

test("Node secure receive integrates reconnect replay scope and authorization", async (t) => {
  const clientIdentity = fixtureIdentity("client");
  const serverReplay = new ReplayProtection({ windowSeconds: 30, maxSkewSeconds: 3 });
  const serverConfig = networkConfig("server", ["client", "revoked_client"], {
    replayProtection: serverReplay,
  });
  const outcomes = [];
  let waiter = null;
  const put = (value) => {
    if (waiter) {
      const resolveWaiter = waiter;
      waiter = null;
      resolveWaiter(value);
    } else outcomes.push(value);
  };
  const take = () => outcomes.length > 0
    ? Promise.resolve(outcomes.shift())
    : new Promise((resolvePromise) => { waiter = resolvePromise; });
  const server = await TcpTransport.startServer(async (transport) => {
    try {
      await transport.receive();
      put(null);
    } catch (error) {
      put(error);
    } finally {
      await transport.close();
    }
  }, "127.0.0.1", 0, { config: serverConfig });
  t.after(() => closeServer(server));

  async function submit(envelope, certificate = "client") {
    const client = await TcpTransport.connect("127.0.0.1", server.address().port, {
      config: networkConfig(certificate, ["server"]),
      servername: "localhost",
    });
    await client.send(envelope);
    const outcome = await take();
    client.socket.destroy();
    return outcome;
  }

  const first = secureEnvelope(clientIdentity, { sequence: 1, nonce: "same" });
  assert.equal(await submit(first), null);
  assert.ok((await submit(first)) instanceof ReplayDetectedError);
  assert.ok((await submit(secureEnvelope(clientIdentity, {
    sequence: 2,
    nonce: "same",
  }))) instanceof ReplayDetectedError);
  assert.equal(await submit(secureEnvelope(clientIdentity, {
    sessionId: "other-session",
    sequence: 1,
    nonce: "same",
  })), null);
  const secondIdentity = fixtureIdentity("revoked_client");
  assert.equal(await submit(secureEnvelope(secondIdentity, {
    sequence: 1,
    nonce: "same",
  }), "revoked_client"), null);
  assert.ok((await submit(secureEnvelope(clientIdentity, {
    sessionId: "stale",
    sequence: 1,
    nonce: "stale",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  }))) instanceof ReplayDetectedError);
  assert.ok((await submit(secureEnvelope(clientIdentity, {
    sessionId: "future",
    sequence: 1,
    nonce: "future",
    createdAt: new Date(Date.now() + 10_000).toISOString(),
  }))) instanceof ReplayDetectedError);
  assert.equal(await submit(secureEnvelope(clientIdentity, {
    sessionId: "skew",
    sequence: 1,
    nonce: "skew",
    createdAt: new Date(Date.now() + 1_000).toISOString(),
  })), null);
  assert.ok((await submit(secureEnvelope(clientIdentity, {
    sessionId: "authz",
    sequence: 1,
    nonce: "authz",
    operation: "job:admin",
  }))) instanceof AuthorizationError);

  // The explicit in-memory fallback resets when no durable backend is
  // configured; the next test covers the durable listener-restart path.

  const restarted = new ReplayProtection({ windowSeconds: 30, maxSkewSeconds: 3 });
  assert.doesNotThrow(() => restarted.checkAndRecord(
    `${clientIdentity.credentialFingerprint}|${first.sessionId}`,
    first.sequence,
    "same",
    Date.parse(first.createdAt) / 1000,
  ));
});

test("Node secure receive restores durable replay after listener restart", async (t) => {
  const root = fs.mkdtempSync(resolve(FIXTURES, "node-durable-replay-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const replayPath = resolve(root, "replay.json");
  const clientIdentity = fixtureIdentity("client");
  const envelope = secureEnvelope(clientIdentity, {
    sequence: 1,
    nonce: "durable-nonce",
  });

  async function submit(replayProtection) {
    let resolveOutcome;
    const outcome = new Promise((resolvePromise) => { resolveOutcome = resolvePromise; });
    const server = await TcpTransport.startServer(async (transport) => {
      try {
        await transport.receive();
        resolveOutcome(null);
      } catch (error) {
        resolveOutcome(error);
      } finally {
        await transport.close();
      }
    }, "127.0.0.1", 0, {
      config: networkConfig("server", ["client"], { replayProtection }),
    });
    const client = await TcpTransport.connect("127.0.0.1", server.address().port, {
      config: networkConfig("client", ["server"]),
      servername: "localhost",
    });
    await client.send(envelope);
    const result = await outcome;
    client.socket.destroy();
    await closeServer(server);
    return result;
  }

  assert.equal(await submit(new DurableReplayProtection(replayPath, {
    windowSeconds: 30,
    maxSkewSeconds: 3,
  })), null);
  const replay = await submit(new DurableReplayProtection(replayPath, {
    windowSeconds: 30,
    maxSkewSeconds: 3,
  }));
  assert.ok(replay instanceof ReplayDetectedError);
  assert.ok(["replay_sequence", "replay_nonce"].includes(replay.code));
});


test("Node local revocation policy rejects an otherwise valid client certificate", async (t) => {
  const revoked = certificateFingerprint(pathFor("revoked_client_cert.pem"));
  const serverConfig = networkConfig("server", ["revoked_client"], { revoked: [revoked] });
  let called = false;
  const server = await TcpTransport.startServer(() => { called = true; }, "127.0.0.1", 0, {
    config: serverConfig,
  });
  t.after(() => closeServer(server));
  const client = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: networkConfig("revoked_client", ["server"]),
    servername: "localhost",
  });
  await client.send(secureEnvelope(fixtureIdentity("revoked_client")));
  await assert.rejects(client.receive());
  assert.equal(called, false);
  client.socket.destroy();
});

test("Node durable revocation reload updates a live TLS identity policy", async (t) => {
  const statePath = resolve(FIXTURES, `revocations-${randomUUID()}.json`);
  t.after(() => {
    try { fs.rmSync(statePath, { force: true }); } catch (_) {}
    for (const name of fs.readdirSync(FIXTURES)) {
      if (name.startsWith(`${statePath.split(/[\\/]/).at(-1)}.corrupt-`)) {
        try { fs.rmSync(resolve(FIXTURES, name), { force: true }); } catch (_) {}
      }
    }
  });
  const livePolicy = new DurableRevocationPolicy(statePath);
  const writerPolicy = new DurableRevocationPolicy(statePath);
  const calls = [];
  const waiters = [];
  const server = await TcpTransport.startServer(async (transport) => {
    const peerId = transport.authenticatedPeer.peerId;
    const waiter = waiters.shift();
    if (waiter) waiter(peerId);
    else calls.push(peerId);
    await transport.close();
  }, "127.0.0.1", 0, {
    config: networkConfig("server", ["client", "revoked_client"], {
      revocationPolicy: livePolicy,
    }),
  });
  t.after(() => closeServer(server));
  const waitForCall = () => (
    calls.length ? Promise.resolve(calls.shift()) : new Promise((resolveCall) => waiters.push(resolveCall))
  );
  const connect = (certificate) => TcpTransport.connect("127.0.0.1", server.address().port, {
    config: networkConfig(certificate, ["server"]),
    servername: "localhost",
  });

  const first = await connect("revoked_client");
  assert.equal(await waitForCall(), "revoked-peer");
  first.socket.destroy();

  const fingerprint = certificateFingerprint(pathFor("revoked_client_cert.pem"));
  writerPolicy.revoke(new RevocationEntry({
    kind: "certificate_fingerprint",
    value: fingerprint,
    reason: "test compromise",
    revokedAt: Math.floor(Date.now() / 1000),
  }));
  assert.equal(livePolicy.isRevoked("certificate_fingerprint", fingerprint), false);
  livePolicy.reload();
  assert.equal(livePolicy.isRevoked("certificate_fingerprint", fingerprint), true);

  const rejected = await connect("revoked_client");
  await rejected.send(secureEnvelope(fixtureIdentity("revoked_client")));
  await assert.rejects(rejected.receive());
  rejected.socket.destroy();
  await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  assert.equal(calls.length, 0);
  assert.equal(waiters.length, 0);

  const renewed = await connect("client");
  assert.equal(await waitForCall(), "client-peer");
  renewed.socket.destroy();
  assert.equal(
    new DurableRevocationPolicy(statePath).isRevoked("certificate_fingerprint", fingerprint),
    true,
  );
});

test("Node TLS credentials rotate atomically on a live listener", async (t) => {
  const now = Math.floor(Date.now() / 1000);
  const oldClient = fixtureIdentity("client");
  const newClient = fixtureIdentity("client_rotated");
  const oldServer = fixtureIdentity("server");
  const newServer = fixtureIdentity("server_rotated");
  const clientRotation = new CredentialRotationPolicy({
    currentFingerprint: oldClient.credentialFingerprint,
    maxClockSkewSeconds: 0,
  });
  const serverRotation = new CredentialRotationPolicy({
    currentFingerprint: oldServer.credentialFingerprint,
    maxClockSkewSeconds: 0,
  });
  const baseServer = networkConfig("server", ["client", "client_rotated"], {
    rotationPolicy: clientRotation,
  });
  const baseClient = networkConfig("client", ["server", "server_rotated"], {
    rotationPolicy: serverRotation,
  });
  const serverProvider = new ReloadableTlsContext(baseServer.securityConfig, { isServer: true });
  const clientProvider = new ReloadableTlsContext(baseClient.securityConfig);
  const serverConfig = new NetworkConfig({
    ...baseServer,
    tlsContextProvider: serverProvider,
  });
  const clientConfig = new NetworkConfig({
    ...baseClient,
    tlsContextProvider: clientProvider,
  });
  const calls = [];
  const waiters = [];
  const waitForCall = () => (calls.length
    ? Promise.resolve(calls.shift())
    : Promise.race([
      new Promise((resolveCall) => waiters.push(resolveCall)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("callback timed out")), 2000)),
    ]));
  const server = await TcpTransport.startServer(async (transport) => {
    await transport.receive();
    const fingerprint = transport.authenticatedPeer.credentialFingerprint;
    const waiter = waiters.shift();
    if (waiter) waiter(fingerprint);
    else calls.push(fingerprint);
    await transport.close();
  }, "127.0.0.1", 0, { config: serverConfig });
  t.after(() => closeServer(server));

  const existing = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: clientConfig,
    servername: "localhost",
  });
  const nextServerSecurity = new SecurityConfig({
    ...baseServer.securityConfig,
    certPath: pathFor("server_rotated_cert.pem"),
    keyPath: pathFor("server_rotated_key.pem"),
  });
  const beforeFailedReload = serverProvider.status({ now });
  assert.throws(() => serverProvider.reload(new SecurityConfig({
    ...nextServerSecurity,
    keyPath: pathFor("server_key.pem"),
  }), { now }));
  assert.deepEqual(serverProvider.status({ now }), beforeFailedReload);

  serverProvider.reload(nextServerSecurity, { transitionSeconds: 60, now });
  clientProvider.reload(new SecurityConfig({
    ...baseClient.securityConfig,
    certPath: pathFor("client_rotated_cert.pem"),
    keyPath: pathFor("client_rotated_key.pem"),
  }), { transitionSeconds: 60, now });
  clientRotation.rotate(newClient.credentialFingerprint, { transitionUntil: now + 60 });
  serverRotation.rotate(newServer.credentialFingerprint, { transitionUntil: now + 60 });

  await existing.send(secureEnvelope(oldClient, {
    sessionId: "existing-after-reload",
    nonce: "existing",
  }));
  assert.equal(await waitForCall(), oldClient.credentialFingerprint);
  existing.socket.destroy();

  const rotated = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: clientConfig,
    servername: "localhost",
  });
  await rotated.send(secureEnvelope(newClient, {
    sessionId: "rotated-new",
    nonce: "rotated",
  }));
  assert.equal(await waitForCall(), newClient.credentialFingerprint);
  rotated.socket.destroy();

  const oldTransition = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: networkConfig("client", ["server_rotated"]),
    servername: "localhost",
  });
  await oldTransition.send(secureEnvelope(oldClient, {
    sessionId: "old-transition",
    nonce: "old-transition",
  }));
  assert.equal(await waitForCall(), oldClient.credentialFingerprint);
  oldTransition.socket.destroy();

  clientRotation.setTransitionUntil(now - 1);
  const rejected = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: networkConfig("client", ["server_rotated"]),
    servername: "localhost",
  });
  await rejected.send(secureEnvelope(oldClient, {
    sessionId: "old-expired",
    nonce: "old-expired",
  }));
  await assert.rejects(rejected.receive());
  rejected.socket.destroy();
  await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  assert.equal(calls.length, 0);

  const status = serverProvider.status({ now });
  assert.equal(status.current_fingerprint, newServer.credentialFingerprint);
  assert.equal(status.previous_fingerprint, oldServer.credentialFingerprint);
  assert.equal(status.generation, 2);
  assert.equal(Object.keys(status).some((key) => key.includes("path")), false);
});

test("Node TLS trust store reload accepts a new CA without listener restart", async (t) => {
  const trustBundle = pathFor(`ca-transition-${randomUUID()}.pem`);
  fs.writeFileSync(
    trustBundle,
    Buffer.concat([
      fs.readFileSync(CA),
      fs.readFileSync(pathFor("next_ca_cert.pem")),
    ]),
    { mode: 0o600 },
  );
  t.after(() => fs.rmSync(trustBundle, { force: true }));
  const baseServer = networkConfig("server", ["client", "next_client"], {
    allowedIssuerNames: [ISSUER, NEXT_ISSUER],
  });
  const provider = new ReloadableTlsContext(baseServer.securityConfig, { isServer: true });
  const serverConfig = new NetworkConfig({ ...baseServer, tlsContextProvider: provider });
  let accepted = 0;
  let resolveAccepted;
  let acceptedPromise = new Promise((resolveCall) => { resolveAccepted = resolveCall; });
  const server = await TcpTransport.startServer(async (transport) => {
    accepted += 1;
    resolveAccepted();
    await transport.close();
  }, "127.0.0.1", 0, { config: serverConfig });
  t.after(() => closeServer(server));
  const nextClientConfig = networkConfig("next_client", ["server"], { ca: trustBundle });

  let rejected = null;
  try {
    rejected = await TcpTransport.connect("127.0.0.1", server.address().port, {
      config: nextClientConfig,
      servername: "localhost",
    });
  } catch (error) {
    assert.ok(error instanceof Error);
  }
  if (rejected) {
    await assert.rejects(rejected.receive());
    rejected.socket.destroy();
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  assert.equal(accepted, 0);

  const before = provider.status().trust_anchor_hash;
  provider.reload(new SecurityConfig({
    ...baseServer.securityConfig,
    caCertPath: trustBundle,
  }), { transitionSeconds: 60 });
  assert.notEqual(provider.status().trust_anchor_hash, before);
  acceptedPromise = new Promise((resolveCall) => { resolveAccepted = resolveCall; });
  const connected = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: nextClientConfig,
    servername: "localhost",
  });
  await Promise.race([
    acceptedPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("callback timed out")), 2000)),
  ]);
  connected.socket.destroy();
  assert.equal(accepted, 1);
});


test("Node hybrid-pq is provider-detected, negotiated, or rejected without fallback", async (t) => {
  const capabilities = getSupportedNodeCryptoCapabilities();
  assert.equal(capabilities.hybrid_pq_supported, detectHybridPqSupport());
  assert.equal(
    capabilities.profiles_supported.includes(SecurityProfile.HYBRID_PQ),
    capabilities.hybrid_pq_supported,
  );
  if (!capabilities.hybrid_pq_supported) {
    if (process.env.HANDOFFKIT_REQUIRE_HYBRID_PQ === "1") {
      assert.fail(`active Node provider ${capabilities.provider} lacks ${HYBRID_PQ_GROUP}`);
    }
    assert.throws(
      () => buildTlsOptions(new SecurityConfig({ profile: SecurityProfile.HYBRID_PQ })),
      (error) => error.code === "security_profile_unavailable",
    );
    return;
  }

  const clientIdentity = fixtureIdentity("client");
  const serverConfig = networkConfig("server", ["client"], {
    profile: SecurityProfile.HYBRID_PQ,
  });
  let resolveHandled;
  const handled = new Promise((resolvePromise) => { resolveHandled = resolvePromise; });
  const server = await TcpTransport.startServer(async (transport) => {
    await transport.receive();
    resolveHandled();
    await transport.close();
  }, "127.0.0.1", 0, { config: serverConfig });
  let client = null;
  t.after(async () => {
    client?.socket.destroy();
    await closeServer(server);
  });
  client = await TcpTransport.connect("127.0.0.1", server.address().port, {
    config: networkConfig("client", ["server"], { profile: SecurityProfile.HYBRID_PQ }),
    servername: "localhost",
  });
  await client.send(secureEnvelope(clientIdentity));
  await handled;
  const traceProbe = spawnSync(
    process.execPath,
    [resolve(dirname(fileURLToPath(import.meta.url)), "../test-support/hybrid-trace-probe.mjs"), FIXTURES],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(traceProbe.status, 0, traceProbe.stderr || traceProbe.stdout);
  assert.match(
    traceProbe.stderr,
    new RegExp(`ServerHello[\\s\\S]*NamedGroup: ${HYBRID_PQ_GROUP}`),
  );
  client.socket.destroy();
  t.diagnostic(`negotiated ${HYBRID_PQ_GROUP} with ${capabilities.provider}`);
});

test("Node secure profiles reject tlsOptions overrides before network use", async () => {
  const standardClient = networkConfig("client", ["server"]);
  await assert.rejects(
    TcpTransport.connect("127.0.0.1", 9, {
      config: standardClient,
      servername: "localhost",
      tlsOptions: { rejectUnauthorized: false },
    }),
    (error) => error instanceof SecurityError
      && error.code === "tls_context_override_forbidden",
  );

  const standardServer = networkConfig("server", ["client"]);
  await assert.rejects(
    TcpTransport.startServer(() => {}, "127.0.0.1", 0, {
      config: standardServer,
      tlsOptions: { requestCert: false },
    }),
    (error) => error instanceof SecurityError
      && error.code === "tls_context_override_forbidden",
  );

  const hybridClient = networkConfig("client", ["server"], {
    profile: SecurityProfile.HYBRID_PQ,
  });
  const expectedCode = detectHybridPqSupport()
    ? "tls_context_override_forbidden"
    : "security_profile_unavailable";
  await assert.rejects(
    TcpTransport.connect("127.0.0.1", 9, {
      config: hybridClient,
      servername: "localhost",
      tlsOptions: { minVersion: "TLSv1.3", maxVersion: "TLSv1.3" },
    }),
    (error) => error instanceof SecurityError && error.code === expectedCode,
  );
});

test("Node secure transport rejects direct socket wrapping", () => {
  const standard = networkConfig("client", ["server"]);
  assert.throws(
    () => new TcpTransport({ write() {} }, { config: standard }),
    (error) => error instanceof SecurityError
      && error.code === "secure_transport_factory_required",
  );

  const hybrid = networkConfig("client", ["server"], {
    profile: SecurityProfile.HYBRID_PQ,
  });
  const expectedCode = detectHybridPqSupport()
    ? "secure_transport_factory_required"
    : "security_profile_unavailable";
  assert.throws(
    () => new TcpTransport({ write() {} }, { config: hybrid }),
    (error) => error instanceof SecurityError && error.code === expectedCode,
  );
});
