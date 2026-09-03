import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  CapabilityPolicy,
  CertificateIdentityPolicy,
  PeerIdentity,
  ReplayProtection,
  SecurityConfig,
  SecurityProfile,
  normalizeFingerprint,
} from "@handoffkit/csp";
import {
  DurableReplayProtection,
  NetworkConfig,
  certificateFingerprint,
} from "@handoffkit/node";

import {
  connectBrowserRealTls,
  startBrowserRealService,
} from "../src/index.js";

const enabled = process.env.HANDOFFKIT_BROWSER_REAL_TLS === "1";
const ISSUER = "CN=HandoffKit Test CA";

test("Browser Real mTLS request/response correlates and rejects a rogue CA", { timeout: 25_000 }, async (t) => {
  if (!enabled) {
    t.diagnostic("HANDOFFKIT_BROWSER_REAL_TLS is unset; this job is not mTLS socket evidence");
    return;
  }
  const { generateTlsFixtures } = await import("../../node/test-support/security-fixtures.mjs");
  const generatedFixtures = generateTlsFixtures();
  t.after(() => generatedFixtures.cleanup());
  const pathFor = (name) => resolve(generatedFixtures.root, name);
  const CA = pathFor("ca_cert.pem");
  const ROGUE_CA = pathFor("rogue_ca_cert.pem");
  const TRUST_DOMAIN = "handoffkit.internal";

  function fixtureIdentity(name, capabilities = ["browser:*"]) {
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

  function identityPolicy(certificateNames) {
    const capabilitiesByFingerprint = Object.fromEntries(
      certificateNames.map((name) => [
        certificateFingerprint(pathFor(`${name}_cert.pem`)),
        ["browser:*"],
      ]),
    );
    return new CertificateIdentityPolicy({
      trustDomain: TRUST_DOMAIN,
      capabilitiesByFingerprint,
      allowedIssuerNames: [ISSUER],
    });
  }

  function networkConfig(ownCertificate, acceptedPeers, {
    ca = CA,
    replayProtection = new ReplayProtection({ windowSeconds: 30, maxSkewSeconds: 3 }),
  } = {}) {
    void acceptedPeers;
    return new NetworkConfig({
      connectTimeoutMs: 1000,
      ioTimeoutMs: 1000,
      securityConfig: new SecurityConfig({
        profile: SecurityProfile.STANDARD,
        requireMtls: true,
        trustDomain: TRUST_DOMAIN,
        caCertPath: ca,
        certPath: pathFor(`${ownCertificate}_cert.pem`),
        keyPath: pathFor(`${ownCertificate}_key.pem`),
      }),
      identityPolicy: identityPolicy(["client", "server"]),
      capabilityPolicy: new CapabilityPolicy({ allowedOperations: ["browser:control"] }),
      replayProtection,
    });
  }

  const clientIdentity = fixtureIdentity("client");
  const serverIdentity = fixtureIdentity("server");
  t.diagnostic("fixtures ready");
  const replayDir = await mkdtemp(resolve(os.tmpdir(), "hk-browser-real-replay-"));
  t.after(() => rm(replayDir, { recursive: true, force: true }));
  const serverConfig = networkConfig("server", ["client"], {
    replayProtection: new DurableReplayProtection(resolve(replayDir, "replay.json")),
  });
  t.diagnostic("starting service");
  const clientConfig = networkConfig("client", ["server"]);
  const handle = await Promise.race([
    startBrowserRealService({
      host: "127.0.0.1",
      port: 0,
      networkConfig: serverConfig,
      grants: {
        [clientIdentity.credentialFingerprint]: ["browser:*"],
      },
      engine: {
        async launch() {
          return {
            page: {
              async goto() {},
              async content() { return "<p>ok</p>"; },
              async screenshot() { return Buffer.from("x"); },
            },
            async close() {},
          };
        },
      },
      replay: serverConfig.replayProtection,
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("service start timed out")), 5000)),
  ]);
  t.diagnostic(`listening ${JSON.stringify(handle.address)}`);
  const port = handle.address.port;
  t.diagnostic("connecting");
  const client = await Promise.race([
    connectBrowserRealTls({
      host: "127.0.0.1",
      port,
      networkConfig: clientConfig,
      servername: "localhost",
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("tls connect timed out")), 8000)),
  ]);
  t.diagnostic("connected");
  t.after(async () => {
    if (handle.firstError) t.diagnostic(`firstError ${JSON.stringify(handle.firstError)}`);
    await client.close();
    const closeStarted = Date.now();
    await handle.close();
    const closeMs = Date.now() - closeStarted;
    t.diagnostic(`handle.close ${closeMs}ms`);
    if (closeMs >= 2000) {
      throw new Error(`handle.close hung for ${closeMs}ms`);
    }
  });

  const peer = client.authenticatedPeer;
  assert.ok(peer, "authenticated peer missing after mTLS connect");
  assert.equal(peer.peerId, serverIdentity.peerId);
  assert.equal(peer.credentialFingerprint, serverIdentity.credentialFingerprint);
  assert.equal(client.identity.peerId, clientIdentity.peerId);
  assert.equal(client.identity.credentialFingerprint, clientIdentity.credentialFingerprint);
  t.diagnostic(`SAN/fingerprint client=${clientIdentity.peerId} server=${peer.peerId}`);

  t.diagnostic("dispatch session.start");
  const started = await client.dispatch({
    command_id: "tls-start",
    session_id: "tls-sess",
    name: "session.start",
    payload: { product: "real", session_id: "tls-sess" },
  });
  assert.equal(started.name, "session.started");
  assert.ok(client.lastRequestMessageId);
  assert.equal(client.lastResponseCorrelationId, client.lastRequestMessageId);

  const status = await client.dispatch({
    command_id: "tls-status",
    session_id: "tls-sess",
    name: "session.status",
    payload: {},
  });
  assert.equal(status.name, "session.status");
  assert.equal(client.lastResponseCorrelationId, client.lastRequestMessageId);

  await assert.rejects(
    () => client.dispatch({
      command_id: "tls-status",
      session_id: "tls-sess",
      name: "session.status",
      payload: {},
    }),
    (error) => error?.code === "replay_detected",
  );

  await assert.rejects(
    () => client.dispatch({
      command_id: "tls-eval",
      session_id: "tls-sess",
      name: "evaluate",
      payload: { expression: "1+1" },
    }),
    (error) => error?.code === "javascript_denied" || error?.code === "capability_denied",
  );

  handle.service.grants.set(
    normalizeFingerprint(clientIdentity.credentialFingerprint),
    ["browser:session.status"],
  );
  await assert.rejects(
    () => client.dispatch({
      command_id: "tls-nav-denied",
      session_id: "tls-sess",
      name: "navigate",
      payload: { url: "http://127.0.0.1/" },
    }),
    (error) => error?.code === "capability_denied",
  );

  await assert.rejects(
    () => connectBrowserRealTls({
      host: "127.0.0.1",
      port,
      networkConfig: networkConfig("client", ["server"], { ca: ROGUE_CA }),
      servername: "localhost",
    }),
    (error) => error instanceof Error,
  );

  assert.equal(handle.service.supervisor.ownedPids.size, 0);
});
