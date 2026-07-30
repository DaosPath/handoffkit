import test from "node:test";
import assert from "node:assert/strict";
import {
  SecurityProfile,
  SecurityConfig,
  PeerIdentity,
  CapabilityPolicy,
  ReplayProtection,
  SignedArtifact,
  SecurityProfileUnavailableError,
  assertSecurityProfileSupported,
  getSupportedCryptoCapabilities,
} from "../src/security.js";

test("SecurityProfile constants", () => {
  assert.equal(SecurityProfile.LOCAL, "local");
  assert.equal(SecurityProfile.STANDARD, "standard");
  assert.equal(SecurityProfile.HYBRID_PQ, "hybrid-pq");
  assert.equal(SecurityProfile.RESEARCH, "research");
});

test("SecurityConfig listen address validation", () => {
  const cfg = new SecurityConfig({ profile: "local", allowInsecureLoopback: false });
  cfg.validateListenAddress("127.0.0.1");
  cfg.validateListenAddress("localhost");

  assert.throws(
    () => cfg.validateListenAddress("192.168.1.1"),
    /cannot listen on non-loopback interface/
  );

  const cfgPublic = new SecurityConfig({ allowInsecureLoopback: true });
  assert.throws(
    () => cfgPublic.validateListenAddress("0.0.0.0"),
    /cannot listen on non-loopback interface/
  );
});

test("PeerIdentity serialization and expiration", () => {
  const peer = new PeerIdentity({
    peer_id: "p1",
    node_id: "n1",
    capabilities: ["job:training"],
    issued_at: 1000,
    expires_at: 2000,
  });

  assert.equal(peer.peerId, "p1");
  assert.equal(peer.isValidAt(1500), true);
  assert.equal(peer.isValidAt(2500), false);

  const wire = peer.toWire();
  const restored = PeerIdentity.fromWire(wire);
  assert.equal(restored.peerId, "p1");
  assert.deepEqual(restored.capabilities, ["job:training"]);
});

test("CapabilityPolicy authorization", () => {
  const policy = new CapabilityPolicy({ allowedOperations: ["job:training"] });
  const peer = new PeerIdentity({
    peer_id: "p1",
    node_id: "n1",
    capabilities: ["job:training"],
    issued_at: Math.floor(Date.now() / 1000) - 100,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });

  policy.authorizeJob("training", peer);

  assert.throws(
    () => policy.authorizeJob("evaluation", peer),
    /not authorized to execute job type/
  );
});

test("ReplayProtection sequence and nonces", () => {
  const rp = new ReplayProtection({ windowSeconds: 300, maxSkewSeconds: 10 });
  rp.checkAndRecord("s1", 1, "nonce-1");
  rp.checkAndRecord("s1", 2, "nonce-2");

  assert.throws(
    () => rp.checkAndRecord("s1", 2, "nonce-3"),
    /not strictly monotonic/
  );

  assert.throws(
    () => rp.checkAndRecord("s1", 3, "nonce-1"),
    /Duplicate nonce detected/
  );
  rp.checkAndRecord("s2", 1, "nonce-1");
});

test("getSupportedCryptoCapabilities", () => {
  const caps = getSupportedCryptoCapabilities();
  assert.equal(caps.contracts_only, true);
  assert.equal(caps.tls13_supported, false);
  assert.equal(caps.hybrid_pq_supported, false);
  assert.deepEqual(caps.signature_algorithms, []);
  assert.ok(!caps.profiles_supported.includes("hybrid-pq"));
  assert.throws(
    () => assertSecurityProfileSupported("hybrid-pq", caps),
    (error) => error instanceof SecurityProfileUnavailableError
      && error.code === "security_profile_unavailable"
      && error.toWire().details.profile === "hybrid-pq",
  );
});

test("SignedArtifact browser-safe contract emits canonical payload without claiming verification", () => {
  const artifact = new SignedArtifact({
    artifact_id: "artifact-1",
    content_hash: "8416cac54bfdbe4faec6d73fdb57ae7cfa81703b311b66de3639e826a185f1e4",
    signature: "test-only-unverified-field",
    algorithm: "ed25519",
    signer_identity: "spiffe://handoffkit.internal/producer/build-1",
    key_fingerprint: "sha256:a6b5df2969959ff5ce26aea82bb88678604b0d0f07200e7845755f4b9af5bba6",
    created_at: 1800000000,
  });
  assert.equal(
    new TextDecoder().decode(artifact.canonicalPayload()),
    "{\"algorithm\":\"ed25519\",\"artifact_id\":\"artifact-1\","
      + "\"content_hash\":\"8416cac54bfdbe4faec6d73fdb57ae7cfa81703b311b66de3639e826a185f1e4\","
      + "\"created_at\":1800000000,\"key_fingerprint\":\"sha256:"
      + "a6b5df2969959ff5ce26aea82bb88678604b0d0f07200e7845755f4b9af5bba6\","
      + "\"signer_identity\":\"spiffe://handoffkit.internal/producer/build-1\"}",
  );
});
