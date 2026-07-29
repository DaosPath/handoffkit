import test from "node:test";
import assert from "node:assert/strict";
import {
  SecurityProfile,
  SecurityConfig,
  PeerIdentity,
  CapabilityPolicy,
  ReplayProtection,
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
    /cannot be used with public bind/
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
    () => rp.checkAndRecord("s2", 1, "nonce-1"),
    /Duplicate nonce detected/
  );
});

test("getSupportedCryptoCapabilities", () => {
  const caps = getSupportedCryptoCapabilities();
  assert.equal(caps.tls13_supported, true);
  assert.ok(caps.profiles_supported.includes("hybrid-pq"));
});
