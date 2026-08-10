import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EdgeRuntimeProfile,
  SessionConfig,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../../../contracts/test-fixtures/security/edge-runtime-profiles-v1.json",
  import.meta.url,
);

test("edge profiles match the shared fixture and drive session limits", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  assert.equal(fixture.format, "handoffkit.edge-profiles");
  assert.equal(fixture.format_version, 1);

  for (const expected of fixture.profiles) {
    const profile = EdgeRuntimeProfile.forProfile(expected.name);
    assert.deepEqual(profile.toWire(), expected);
    assert.deepEqual(EdgeRuntimeProfile.fromWire(expected).toWire(), expected);

    const session = SessionConfig.forProfile("edge-session", profile);
    assert.equal(session.channelCapacity, profile.channelCapacity);
    assert.equal(session.maxMessageBytes, profile.maxFrameBytes);
    assert.equal(session.ackTimeoutMs, profile.ackTimeoutMs);
    assert.equal(session.dedupCapacity, profile.dedupCapacity);
    assert.deepEqual(session.retryPolicy.toWire(), profile.reconnect.toWire());
    assert.equal(session.metadata.edge_profile, profile.name);
  }
});

test("edge profile label cannot be spoofed", () => {
  assert.throws(
    () => SessionConfig.forProfile("edge-session", "edge-small", {
      metadata: { edge_profile: "server" },
    }),
    /does not match/,
  );
});
