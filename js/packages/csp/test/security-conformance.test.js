import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  AuthorizationError,
  CapabilityPolicy,
  PeerIdentity,
  ReplayProtection,
  SecurityConfig,
  SecurityError,
  SignedArtifact,
  negotiateSecurityProfile,
} from "../src/index.js";

const contractsRoot = join(import.meta.dirname, "..", "..", "..", "..", "shared", "contracts");
const vectors = JSON.parse(await readFile(
  join(contractsRoot, "conformance", "security-v1.json"),
  "utf8",
));

test("security wire conformance", async () => {
  const config = JSON.parse(await readFile(join(contractsRoot, "fixtures", "security_config.json")));
  assert.deepEqual(SecurityConfig.fromWire(config).toWire(), config);
  const peer = JSON.parse(await readFile(join(contractsRoot, "fixtures", "peer_identity.json")));
  assert.deepEqual(PeerIdentity.fromWire(peer).toWire(), peer);
  const artifact = JSON.parse(await readFile(join(contractsRoot, "fixtures", "signed_artifact.json")));
  const signed = SignedArtifact.fromWire(artifact);
  assert.deepEqual(signed.toWire(), artifact);
  assert.equal(new TextDecoder().decode(signed.canonicalPayload()), vectors.signed_artifact.canonical_payload);
});

for (const profileCase of vectors.profile_negotiation) {
  test(`profile negotiation: ${profileCase.id}`, () => {
    if (profileCase.error_code) {
      assert.throws(
        () => negotiateSecurityProfile(
          profileCase.required,
          profileCase.offered,
          profileCase.supported,
        ),
        (error) => error instanceof SecurityError && error.code === profileCase.error_code,
      );
    } else {
      assert.equal(
        negotiateSecurityProfile(
          profileCase.required,
          profileCase.offered,
          profileCase.supported,
        ),
        profileCase.selected,
      );
    }
  });
}

for (const authorizationCase of vectors.authorization) {
  test(`authorization: ${authorizationCase.id}`, () => {
    const peer = new PeerIdentity({
      peerId: "peer",
      nodeId: "node",
      capabilities: authorizationCase.peer_capabilities,
    });
    const policy = new CapabilityPolicy({
      allowedOperations: authorizationCase.allowed_operations,
    });
    assert.equal(
      policy.isOperationAuthorized(authorizationCase.operation, peer),
      authorizationCase.authorized,
    );
    if (!authorizationCase.authorized && authorizationCase.operation.startsWith("job:")) {
      assert.throws(
        () => policy.authorizeJob(authorizationCase.operation.slice(4), peer),
        (error) => error instanceof AuthorizationError && error.code === "authorization_denied",
      );
    }
  });
}

for (const replayCase of vectors.replay) {
  test(`replay: ${replayCase.id}`, () => {
    const replay = new ReplayProtection({ windowSeconds: 30, maxSkewSeconds: 3 });
    const now = Date.now() / 1000;
    for (const operation of replayCase.operations) {
      const apply = () => replay.checkAndRecord(
        `${operation.peer}\0${operation.session}`,
        operation.sequence,
        operation.nonce,
        now + operation.timestamp_offset,
      );
      if (operation.error_code) {
        assert.throws(
          apply,
          (error) => error instanceof SecurityError && error.code === operation.error_code,
        );
      } else {
        apply();
      }
    }
  });
}
