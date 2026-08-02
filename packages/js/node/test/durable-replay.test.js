import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ReplayDetectedError, SecurityError } from "@handoffkit/csp";
import { DurableReplayProtection } from "../src/index.js";

const sharedFixture = fileURLToPath(
  new URL("../../../contracts/test-fixtures/security/durable-replay-v1.json", import.meta.url),
);

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoffkit-node-replay-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function context(overrides = {}) {
  return {
    peer_id: overrides.peer_id || "peer-a",
    session_id: overrides.session_id || "session-a",
    credential_fingerprint: overrides.credential_fingerprint || `sha256:${"a".repeat(64)}`,
    security_profile: "standard",
  };
}

function record(protection, scope, sequence, nonce, replayContext) {
  protection.checkAndRecord(scope, sequence, nonce, Date.now() / 1000, replayContext);
}

test("Node durable replay rejects nonce and sequence after restart", (t) => {
  const filePath = path.join(workspace(t), "replay.json");
  const replayContext = context();
  const scope = `${replayContext.credential_fingerprint}|session-a`;
  const first = new DurableReplayProtection(filePath);
  record(first, scope, 1, "nonce-1", replayContext);

  const restored = new DurableReplayProtection(filePath);
  assert.throws(
    () => record(restored, scope, 2, "nonce-1", replayContext),
    (error) => error instanceof ReplayDetectedError && error.code === "replay_nonce",
  );
  assert.throws(
    () => record(restored, scope, 1, "nonce-2", replayContext),
    (error) => error instanceof ReplayDetectedError && error.code === "replay_sequence",
  );
  record(restored, scope, 2, "nonce-2", replayContext);
  assert.equal(restored.generation, 2);
});

test("Node loads the shared durable replay fixture", (t) => {
  const filePath = path.join(workspace(t), "shared-replay.json");
  fs.copyFileSync(sharedFixture, filePath);
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
  const restored = new DurableReplayProtection(filePath);
  assert.deepEqual(restored.status(), {
    format: "handoffkit.security.replay",
    format_version: 1,
    generation: 7,
    scopes: 1,
    nonces: 2,
  });
  const replayContext = context();
  assert.throws(
    () => restored.checkAndRecord(
      `${replayContext.credential_fingerprint}|session-a`,
      42,
      null,
      null,
      replayContext,
    ),
    (error) => error instanceof ReplayDetectedError && error.code === "replay_sequence",
  );
});

test("Node durable replay scopes peer, session, and rotated credential", (t) => {
  const protection = new DurableReplayProtection(path.join(workspace(t), "replay.json"));
  const values = [
    context(),
    context({ session_id: "session-b" }),
    context({ peer_id: "peer-b", session_id: "peer-b-session" }),
    context({ credential_fingerprint: `sha256:${"b".repeat(64)}` }),
  ];
  const scopes = [
    `${values[0].credential_fingerprint}|session-a`,
    `${values[1].credential_fingerprint}|session-b`,
    `${values[2].credential_fingerprint}|peer-b-session`,
    `${values[3].credential_fingerprint}|session-a`,
  ];
  scopes.forEach((scope, index) => record(protection, scope, 1, "same", values[index]));
  assert.equal(protection.status().scopes, 4);
});

for (const mutation of ["truncated", "checksum"]) {
  test(`Node durable replay quarantines ${mutation} state`, (t) => {
    const root = workspace(t);
    const filePath = path.join(root, "replay.json");
    const replayContext = context();
    const protection = new DurableReplayProtection(filePath);
    record(
      protection,
      `${replayContext.credential_fingerprint}|session-a`,
      1,
      "nonce-1",
      replayContext,
    );
    if (mutation === "truncated") {
      fs.writeFileSync(filePath, "{");
    } else {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      value.checksum = `sha256:${"0".repeat(64)}`;
      fs.writeFileSync(filePath, JSON.stringify(value));
    }
    assert.throws(
      () => new DurableReplayProtection(filePath),
      (error) => error instanceof SecurityError && error.code === "security_state_corrupt",
    );
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(fs.readdirSync(root).filter((name) => name.startsWith("replay.json.corrupt-")).length, 1);
  });
}

test("Node durable replay ignores orphaned pre-replace temp file", (t) => {
  const root = workspace(t);
  const filePath = path.join(root, "replay.json");
  const replayContext = context();
  const scope = `${replayContext.credential_fingerprint}|session-a`;
  const protection = new DurableReplayProtection(filePath);
  record(protection, scope, 1, "nonce-1", replayContext);
  fs.writeFileSync(path.join(root, ".replay.json.tmp-crash"), "{");
  const restored = new DurableReplayProtection(filePath);
  assert.throws(
    () => record(restored, scope, 1, "nonce-2", replayContext),
    ReplayDetectedError,
  );
});

test("Node durable replay capacity fails closed", (t) => {
  const filePath = path.join(workspace(t), "replay.json");
  const replayContext = context();
  const scope = `${replayContext.credential_fingerprint}|session-a`;
  const protection = new DurableReplayProtection(filePath, {
    maxScopes: 1,
    maxSeenNonces: 1,
  });
  record(protection, scope, 1, "nonce-1", replayContext);
  assert.throws(
    () => record(protection, scope, 2, "nonce-2", replayContext),
    (error) => error instanceof SecurityError && error.code === "replay_state_capacity",
  );
  assert.throws(
    () => record(protection, "other", 1, "other", context({ peer_id: "peer-b" })),
    (error) => error instanceof SecurityError && error.code === "replay_state_capacity",
  );
  const restored = new DurableReplayProtection(filePath, {
    maxScopes: 1,
    maxSeenNonces: 1,
  });
  assert.throws(
    () => record(restored, scope, 1, "nonce-new", replayContext),
    ReplayDetectedError,
  );
});

test("Node durable replay compacts expired records", (t) => {
  const filePath = path.join(workspace(t), "replay.json");
  const replayContext = context();
  const protection = new DurableReplayProtection(filePath, {
    windowSeconds: 1,
    stateTtlSeconds: 2,
  });
  const before = Date.now() / 1000;
  record(
    protection,
    `${replayContext.credential_fingerprint}|session-a`,
    1,
    "nonce-1",
    replayContext,
  );
  protection.compact({ now: before + 3 });
  assert.deepEqual(protection.status(), {
    format: "handoffkit.security.replay",
    format_version: 1,
    generation: 2,
    scopes: 0,
    nonces: 0,
  });
  assert.equal(new DurableReplayProtection(filePath, {
    windowSeconds: 1,
    stateTtlSeconds: 2,
  }).status().scopes, 0);
});

test("Node durable replay requires authenticated context", (t) => {
  const protection = new DurableReplayProtection(path.join(workspace(t), "replay.json"));
  assert.throws(
    () => protection.checkAndRecord("scope", 1, "nonce", Date.now() / 1000),
    (error) => error instanceof SecurityError && error.code === "replay_context_missing",
  );
});
