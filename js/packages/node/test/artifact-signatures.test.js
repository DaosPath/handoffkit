import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ArtifactSignatureError, SecurityError, SignedArtifact } from "@handoffkit/csp";
import {
  ArtifactSigner,
  ArtifactSigningCredential,
  ArtifactTrustPolicy,
  FileKeyStore,
  getSupportedNodeCryptoCapabilities,
  verifySignedArtifact,
} from "../src/index.js";

const VECTOR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../shared/contracts/test-fixtures/artifact-signing/vector.json",
);
const NOW = 1_800_000_000;
const IDENTITY = "spiffe://handoffkit.internal/producer/build-1";

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKey: publicKey.export({ format: "pem", type: "spki" }),
  };
}

function credential(pair, options = {}) {
  return new ArtifactSigningCredential({
    signerIdentity: options.signerIdentity || IDENTITY,
    publicKey: pair.publicKey,
    validFrom: options.validFrom ?? NOW - 100,
    validUntil: options.validUntil ?? NOW + 100,
    revoked: options.revoked || false,
  });
}

test("Node Ed25519 verifies the public shared canonical artifact vector", () => {
  const vector = JSON.parse(fs.readFileSync(VECTOR_PATH, "utf8"));
  const data = Buffer.from(vector.data_base64, "base64");
  const artifact = SignedArtifact.fromWire(vector.signed_artifact);
  const policy = new ArtifactTrustPolicy([new ArtifactSigningCredential({
    signerIdentity: artifact.signerIdentity,
    publicKey: vector.public_key_pem,
    validFrom: NOW - 100,
    validUntil: NOW + 100,
  })]);

  assert.equal(
    Buffer.from(artifact.canonicalPayload()).toString("utf8"),
    vector.canonical_payload,
  );
  assert.equal(verifySignedArtifact(data, artifact, policy, { now: NOW }), true);
  assert.deepEqual(getSupportedNodeCryptoCapabilities().signature_algorithms, ["ed25519"]);
  assert.deepEqual(getSupportedNodeCryptoCapabilities().digest_algorithms, ["sha256"]);
});

for (const [name, mutate, expectedCode] of [
  ["content tamper", ({ data, artifact }) => ({ data: Buffer.from("tampered"), artifact }), "artifact_integrity_mismatch"],
  ["signature tamper", ({ data, artifact }) => ({
    data,
    artifact: SignedArtifact.fromWire({ ...artifact.toWire(), signature: "AAAA" }),
  }), "artifact_signature_invalid"],
  ["wrong signer claim", ({ data, artifact }) => ({
    data,
    artifact: SignedArtifact.fromWire({
      ...artifact.toWire(),
      signer_identity: "spiffe://evil.invalid/producer",
    }),
  }), "artifact_signer_mismatch"],
]) {
  test(`Node rejects artifact ${name}`, () => {
    const pair = keyPair();
    const data = Buffer.from("signed payload");
    const artifact = new ArtifactSigner(pair.privateKey, IDENTITY)
      .sign("artifact-2", data, { createdAt: NOW });
    const candidate = mutate({ data, artifact });
    assert.throws(
      () => verifySignedArtifact(
        candidate.data,
        candidate.artifact,
        new ArtifactTrustPolicy([credential(pair)]),
        { now: NOW },
      ),
      (error) => error instanceof ArtifactSignatureError && error.code === expectedCode,
    );
  });
}

test("Node rejects untrusted, expired, revoked, and non-allowlisted signers", () => {
  const pair = keyPair();
  const wrongPair = keyPair();
  const data = Buffer.from("signed payload");
  const artifact = new ArtifactSigner(pair.privateKey, IDENTITY)
    .sign("artifact-3", data, { createdAt: NOW });
  const policies = [
    [new ArtifactTrustPolicy([credential(wrongPair)]), "artifact_signer_untrusted"],
    [new ArtifactTrustPolicy([credential(pair, { validUntil: NOW - 1 })]), "artifact_signer_expired"],
    [new ArtifactTrustPolicy([credential(pair, { revoked: true })]), "artifact_signer_revoked"],
    [new ArtifactTrustPolicy([credential(pair)], { allowedAlgorithms: [] }), "artifact_algorithm_unsupported"],
  ];
  for (const [policy, expectedCode] of policies) {
    assert.throws(
      () => verifySignedArtifact(data, artifact, policy, { now: NOW }),
      (error) => error.code === expectedCode,
    );
  }
});

test("Node FileKeyStore enforces lifecycle and private-key permissions", () => {
  const localTests = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.local-tests");
  fs.mkdirSync(localTests, { recursive: true });
  const directory = fs.mkdtempSync(resolve(localTests, "node-keystore-"));
  const keyPath = resolve(directory, "private.pem");
  fs.writeFileSync(keyPath, "test-only-private-key", { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  const store = new FileKeyStore({ keyPath });
  assert.equal(store.getPrivateKey(), "test-only-private-key");
  store.close();
  assert.throws(
    () => store.getPrivateKey(),
    (error) => error instanceof SecurityError && error.code === "keystore_closed",
  );
  if (process.platform !== "win32") {
    fs.chmodSync(keyPath, 0o644);
    assert.throws(
      () => new FileKeyStore({ keyPath }).getPrivateKey(),
      (error) => error.code === "insecure_key_permissions",
    );
  }
});
