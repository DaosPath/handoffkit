import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  PeerIdentity,
  SecurityProfile,
  SecurityProfileMismatchError,
} from "@handoffkit/csp";
import {
  buildSecurityTranscript,
  verifySecurityTranscript,
} from "../src/index.js";

const fixture = JSON.parse(fs.readFileSync(resolve(
  import.meta.dirname,
  "../../../contracts/test-fixtures/security/security-transcript-v1.json",
), "utf8"));
const sender = PeerIdentity.fromWire(fixture.sender);
const receiver = PeerIdentity.fromWire(fixture.receiver);
const expected = {
  protocolVersion: "1.0",
  profile: SecurityProfile.STANDARD,
  sender,
  receiver,
  tlsVersion: "TLSv1.3",
  negotiatedGroup: null,
  sessionId: "session-transcript-1",
  handshakeNonce: "nonce-transcript-1",
  timestamp: "2026-01-01T00:00:00Z",
};

test("Node security transcript matches the shared canonical fixture", () => {
  const transcript = buildSecurityTranscript({
    ...expected,
    requestedProfile: SecurityProfile.STANDARD,
    selectedProfile: SecurityProfile.STANDARD,
  });
  assert.deepEqual(transcript.toWire(), fixture.transcript);
  assert.deepEqual(verifySecurityTranscript(fixture.transcript, expected).toWire(), fixture.transcript);
});

test("Node security transcript rejects hash tamper, downgrade, and identity change", () => {
  assert.throws(
    () => verifySecurityTranscript({
      ...fixture.transcript,
      timestamp: "2026-01-01T00:00:01Z",
    }, expected),
    (error) => error.code === "security_transcript_hash_mismatch",
  );

  const downgrade = buildSecurityTranscript({
    ...expected,
    requestedProfile: SecurityProfile.STANDARD,
    selectedProfile: SecurityProfile.LOCAL,
  });
  assert.throws(
    () => verifySecurityTranscript(downgrade, expected),
    (error) => error instanceof SecurityProfileMismatchError,
  );

  const wrongReceiver = new PeerIdentity({ ...receiver.toWire(), peer_id: "other-peer" });
  const wrongIdentity = buildSecurityTranscript({
    ...expected,
    receiver: wrongReceiver,
    requestedProfile: SecurityProfile.STANDARD,
    selectedProfile: SecurityProfile.STANDARD,
  });
  assert.throws(
    () => verifySecurityTranscript(wrongIdentity, expected),
    (error) => error.code === "security_transcript_identity_mismatch",
  );
});
