import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ArtifactSignatureError, SecurityError } from "@handoffkit/csp";
import {
  ArtifactSigner,
  ArtifactSigningCredential,
  ArtifactTrustPolicy,
  DurableRevocationPolicy,
  RevocationEntry,
  verifySignedArtifact,
} from "../src/index.js";

const sharedFixture = fileURLToPath(
  new URL("../../../contracts/test-fixtures/security/durable-revocation-v1.json", import.meta.url),
);

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoffkit-node-revocation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function entry(kind = "certificate_fingerprint", value = `sha256:${"a".repeat(64)}`, options = {}) {
  const revokedAt = options.revokedAt ?? Math.floor(Date.now() / 1000);
  return new RevocationEntry({
    kind,
    value,
    reason: "credential compromise",
    revokedAt,
    effectiveAt: options.effectiveAt,
    expiresAt: options.expiresAt,
  });
}

test("Node durable revocation persists all supported subjects", (t) => {
  const filePath = path.join(workspace(t), "revocations.json");
  const policy = new DurableRevocationPolicy(filePath);
  policy.revoke(entry());
  policy.revoke(entry("peer_id", "peer-a"));
  policy.revoke(entry("issuer", "CN=HandoffKit Test CA"));
  policy.revoke(entry("trust_domain", "HANDOFFKIT.INTERNAL"));

  const restored = new DurableRevocationPolicy(filePath);
  assert.equal(restored.status().generation, 4);
  assert.equal(restored.isRevoked("certificate_fingerprint", `${"AA:".repeat(31)}AA`), true);
  assert.equal(restored.isRevoked("peer_id", "peer-a"), true);
  assert.equal(restored.isRevoked("issuer", "CN=HandoffKit Test CA"), true);
  assert.equal(restored.isRevoked("trust_domain", "handoffkit.internal"), true);
  assert.equal(restored.isRevoked("peer_id", "peer-b"), false);
  assert.equal(restored.isRevoked("certificate_fingerprint", `sha256:${"b".repeat(64)}`), false);
});

test("Node loads the shared durable revocation fixture", (t) => {
  const filePath = path.join(workspace(t), "shared-revocations.json");
  fs.copyFileSync(sharedFixture, filePath);
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
  const policy = new DurableRevocationPolicy(filePath);
  assert.deepEqual(policy.status({ now: 1_800_000_000 }), {
    format: "handoffkit.security.revocations",
    format_version: 1,
    generation: 3,
    entries: 3,
    active: 2,
  });
  assert.equal(policy.isRevoked(
    "certificate_fingerprint",
    `sha256:${"a".repeat(64)}`,
    { now: 1_800_000_000 },
  ), true);
  assert.equal(policy.isRevoked(
    "signer_fingerprint",
    `sha256:${"b".repeat(64)}`,
    { now: 1_800_000_000 },
  ), true);
  assert.equal(policy.isRevoked("peer_id", "peer-b", { now: 1_800_000_000 }), false);
});

test("Node durable revocation supports effective windows, remove, and live reload", (t) => {
  const filePath = path.join(workspace(t), "revocations.json");
  const reader = new DurableRevocationPolicy(filePath);
  const writer = new DurableRevocationPolicy(filePath);
  const now = Math.floor(Date.now() / 1000);
  writer.revoke(entry("peer_id", "future-peer", {
    revokedAt: now,
    effectiveAt: now + 10,
    expiresAt: now + 20,
  }));
  assert.equal(reader.isRevoked("peer_id", "future-peer", { now: now + 11 }), false);
  reader.reload();
  assert.equal(reader.isRevoked("peer_id", "future-peer", { now: now + 9 }), false);
  assert.equal(reader.isRevoked("peer_id", "future-peer", { now: now + 10 }), true);
  assert.equal(reader.isRevoked("peer_id", "future-peer", { now: now + 20 }), false);
  assert.equal(writer.remove("peer_id", "future-peer"), true);
  reader.reload();
  assert.equal(reader.isRevoked("peer_id", "future-peer", { now: now + 11 }), false);
});

test("Node revocation capacity fails closed and corruption is quarantined", (t) => {
  const root = workspace(t);
  const filePath = path.join(root, "revocations.json");
  const policy = new DurableRevocationPolicy(filePath, { maxEntries: 1 });
  policy.revoke(entry());
  assert.throws(
    () => policy.revoke(entry("peer_id", "peer-a")),
    (error) => error instanceof SecurityError && error.code === "revocation_state_capacity",
  );
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  value.checksum = "sha256:00";
  fs.writeFileSync(filePath, JSON.stringify(value), { mode: 0o600 });
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
  assert.throws(
    () => new DurableRevocationPolicy(filePath),
    (error) => error instanceof SecurityError && error.code === "security_state_corrupt",
  );
  assert.equal(fs.existsSync(filePath), false);
  assert.ok(fs.readdirSync(root).some((name) => name.includes("corrupt-")));
});

test("Node Ed25519 verification enforces durable signer revocation", (t) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const credential = new ArtifactSigningCredential({
    signerIdentity: "producer-a",
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
  });
  const signer = new ArtifactSigner(
    privateKey.export({ type: "pkcs8", format: "pem" }),
    "producer-a",
  );
  const artifact = signer.sign("artifact-a", Buffer.from("verified payload"));
  const revocations = new DurableRevocationPolicy(
    path.join(workspace(t), "revocations.json"),
  );
  const policy = new ArtifactTrustPolicy([credential], { revocationPolicy: revocations });
  assert.equal(verifySignedArtifact(Buffer.from("verified payload"), artifact, policy), true);
  revocations.revoke(entry("signer_fingerprint", credential.fingerprint));
  assert.throws(
    () => verifySignedArtifact(Buffer.from("verified payload"), artifact, policy),
    (error) => error instanceof ArtifactSignatureError && error.code === "artifact_signer_revoked",
  );
});
