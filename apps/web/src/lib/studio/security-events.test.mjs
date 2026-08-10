import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  emptyStudioSecuritySnapshot,
  assertGoGatewayEvents,
  markStudioSecurityDisconnected,
  parseStudioSecurityEvent,
  parseStudioSecurityNdjson,
  reduceStudioSecurityEvents,
  StudioSecurityEventError,
} from "./security-events.ts";

const fixtureUrl = new URL(
  "../../../../../packages/contracts/test-fixtures/security/studio-security-events-v1.ndjson",
  import.meta.url,
);
const conformanceIndexUrl = new URL(
  "../../../../../packages/contracts/conformance/security-finalization-v1.json",
  import.meta.url,
);

async function fixtureText() {
  return readFile(fixtureUrl, "utf8");
}

test("Studio parses and reduces the shared real-event corpus", async () => {
  const events = parseStudioSecurityNdjson(await fixtureText());
  const snapshot = reduceStudioSecurityEvents(events, {
    generatedAt: "2026-08-01T12:06:03Z",
  });

  assert.equal(events.length, 8);
  assert.equal(snapshot.source.status, "connected");
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0].identity_source, "certificate-san");
  assert.equal(snapshot.sessions[0].credential_fingerprint, "sha256:0123456789ab...cdef1234");
  assert.equal(snapshot.sessions[0].reconnects, 1);
  assert.equal(snapshot.sessions[0].replay_rejections, 1);
  assert.equal(snapshot.sessions[0].certificate_state, "expired");
  assert.equal(snapshot.jobs[0].progress, 0.5);
  assert.equal(snapshot.artifacts.length, 2);
  assert.equal(snapshot.artifacts[0].verification, "rejected");
  assert.equal(snapshot.metrics.replay_rejections, 1);
  assert.equal(snapshot.errors[0].code, "credential_expired");
});

test("Studio is accurately scoped in the finalization conformance index", async () => {
  const index = JSON.parse(await readFile(conformanceIndexUrl, "utf8"));
  assert.equal(index.wire_version, "1.0");
  assert.deepEqual(index.studio_security_events.emitters, ["go-ml-gateway"]);
  assert.deepEqual(index.studio_security_events.parsers, ["go", "typescript"]);
  assert.equal(
    index.studio_security_events.fixture,
    "test-fixtures/security/studio-security-events-v1.ndjson",
  );
});

test("Studio rejects secrets, untruncated fingerprints, unknown fields, and corrupt JSON", async () => {
  const [firstLine] = (await fixtureText()).trim().split(/\r?\n/);
  const base = JSON.parse(firstLine);

  for (const mutate of [
    (event) => { event.payload.credential_fingerprint = `sha256:${"a".repeat(64)}`; },
    (event) => { event.payload.non_public_material = "redacted"; },
  ]) {
    const event = structuredClone(base);
    mutate(event);
    assert.throws(
      () => parseStudioSecurityEvent(event),
      (error) => error instanceof StudioSecurityEventError,
    );
  }

  const rejection = {
    ...base,
    event_id: "event-secret",
    event_type: "security.rejected",
    payload: {
      session_id: "session-alpha",
      category: "worker",
      code: "worker_error",
      message: "Bearer secret-value at C:\\private\\worker.log",
    },
  };
  assert.throws(
    () => parseStudioSecurityEvent(rejection),
    (error) => error instanceof StudioSecurityEventError && error.code === "studio_event_secret_detected",
  );
  assert.throws(
    () => parseStudioSecurityNdjson(`${firstLine}\n{"broken":`),
    (error) => error instanceof StudioSecurityEventError && error.code === "studio_event_json_invalid",
  );
});

test("Studio rejects non-Go runtime claims from the configured production source", async () => {
  const [firstLine] = (await fixtureText()).trim().split(/\r?\n/);
  const event = JSON.parse(firstLine);
  event.runtime = "cpp";
  assert.throws(
    () => assertGoGatewayEvents([parseStudioSecurityEvent(event)]),
    (error) => error instanceof StudioSecurityEventError && error.code === "studio_event_emitter_untrusted",
  );
});

test("Studio empty and reconnect states never invent runtime data", () => {
  const empty = emptyStudioSecuritySnapshot("unconfigured");
  assert.deepEqual(empty.sessions, []);
  assert.deepEqual(empty.jobs, []);
  assert.deepEqual(empty.artifacts, []);
  assert.equal(empty.source.event_count, 0);

  const disconnected = markStudioSecurityDisconnected(empty);
  assert.equal(disconnected.source.status, "disconnected");
  assert.equal(disconnected.source.error_code, "studio_stream_disconnected");
  assert.deepEqual(disconnected.sessions, []);
});
