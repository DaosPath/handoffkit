import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import fc from "fast-check";

import {
  ArtifactRef,
  ChannelConfig,
  CspRuntime,
  DeliveryAck,
  DeliveryNack,
  JobProgress,
  MessageEnvelope,
  ProcessError,
  RetryPolicy,
  SessionConfig,
  WorkerCapabilities,
  makeEnvelope,
  sanitizeErrorMessage,
  validationErrorCode,
} from "../src/index.js";

const contractsRoot = join(import.meta.dirname, "..", "..", "..", "contracts");
const propertyOptions = { numRuns: 100, seed: 0x1180, endOnFailure: true };

function validateCorpusCase(kind, value) {
  if (kind === "message_envelope") return MessageEnvelope.fromWire(value).toWire();
  if (kind === "session_config") return SessionConfig.fromWire(value).toWire();
  if (kind === "channel_config") return ChannelConfig.fromWire(value).toWire();
  if (kind === "delivery_ack") return new DeliveryAck({ messageId: value.message_id, processedAt: value.processed_at, metadata: value.metadata }).toWire();
  if (kind === "delivery_nack") return new DeliveryNack({ messageId: value.message_id, code: value.code, message: value.message, retryable: value.retryable, processedAt: value.processed_at, metadata: value.metadata }).toWire();
  if (kind === "process_error") return new ProcessError({ code: value.code, message: value.message, processId: value.process_id, retryable: value.retryable, details: value.details, timestamp: value.timestamp }).toWire();
  if (kind === "artifact_ref") return new ArtifactRef(value).toWire();
  if (kind === "worker_capabilities") return new WorkerCapabilities(value).toWire();
  if (kind === "job_progress") return new JobProgress(value).toWire();
  throw new Error(`unsupported corpus kind: ${kind}`);
}

test("shared differential validation corpus", async () => {
  const corpus = JSON.parse(await readFile(join(contractsRoot, "corpus", "csp-validation.json"), "utf8"));
  for (const corpusCase of corpus.cases) {
    try {
      const canonical = validateCorpusCase(corpusCase.kind, corpusCase.value);
      assert.equal(corpusCase.valid, true, corpusCase.id);
      assert.deepEqual(canonical, corpusCase.value, corpusCase.id);
    } catch (error) {
      assert.equal(corpusCase.valid, false, `${corpusCase.id}: ${error}`);
      assert.equal(validationErrorCode(error), corpusCase.error_code, corpusCase.id);
    }
  }
});

test("envelope encode/decode and retry properties", () => {
  const identifier = fc.stringMatching(/^[A-Za-z0-9]{1,24}$/);
  fc.assert(
    fc.property(
      identifier,
      identifier,
      identifier,
      fc.nat(0xffffffff),
      fc.jsonValue(),
      fc.boolean(),
      (messageId, sessionId, channel, sequence, payload, requiresAck) => {
        const envelope = new MessageEnvelope({
          messageId,
          sessionId,
          channel,
          kind: "data",
          source: "property",
          sequence,
          payloadType: "json",
          payload,
          createdAt: "2026-01-01T00:00:00Z",
          idempotencyKey: `key-${messageId}`,
          requiresAck,
        });
        const decoded = MessageEnvelope.fromJSON(envelope.toJSONString());
        assert.deepEqual(decoded.toWire(), envelope.toWire());
        const retried = envelope.nextAttempt();
        assert.equal(retried.messageId, envelope.messageId);
        assert.equal(retried.idempotencyKey, envelope.idempotencyKey);
        assert.equal(retried.attempt, envelope.attempt + 1);
      },
    ),
    propertyOptions,
  );
});

test("session configuration property", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4096 }),
      fc.integer({ min: 1024, max: 16 * 1024 * 1024 }),
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 0, max: 1000 }),
      fc.integer({ min: 0, max: 1000 }),
      (capacity, maxMessageBytes, maxAttempts, baseDelayMs, delta) => {
        const config = new SessionConfig({
          sessionId: "property",
          channelCapacity: capacity,
          maxMessageBytes,
          retryPolicy: new RetryPolicy({ maxAttempts, baseDelayMs, maxDelayMs: baseDelayMs + delta }),
        });
        assert.deepEqual(SessionConfig.fromWire(config.toWire()).toWire(), config.toWire());
      },
    ),
    propertyOptions,
  );
});

test("error sanitization property", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[A-Za-z0-9]{1,80}$/), (secret) => {
      const sanitized = sanitizeErrorMessage(`failure Bearer ${secret} sk-${secret} gsk_${secret} pypi-${secret}\nnext`);
      for (const prefix of ["Bearer ", "sk-", "gsk_", "pypi-"]) assert.ok(!sanitized.includes(`${prefix}${secret}`));
      assert.ok(!sanitized.includes("\n"));
      assert.ok(new TextEncoder().encode(sanitized).byteLength <= 2048);
    }),
    propertyOptions,
  );
});

test("session command state-machine property", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("send", "receive", "ack", "nack", "cancel", "close"), { minLength: 1, maxLength: 40 }),
      async (commands) => {
        const session = new CspRuntime().createSession({ config: new SessionConfig({ sessionId: "state-machine", channelCapacity: 4 }) });
        const channel = session.channel("work", { capacity: 4 });
        const expected = [];
        const received = [];
        let sequence = 0;
        for (const command of commands) {
          if (command === "send" && !session.closed && !session.cancelled && channel.size < 4) {
            const envelope = makeEnvelope({ sessionId: session.sessionId, channel: "work", source: "property", sequence, payloadType: "json", payload: { sequence } });
            sequence += 1;
            await session.send("work", envelope);
            expected.push(envelope.messageId);
          } else if (command === "receive" && expected.length && !session.closed && !session.cancelled) {
            const envelope = await session.receive("work");
            assert.equal(envelope.messageId, expected.shift());
            received.push(envelope);
          } else if (command === "ack" && received.length) {
            const envelope = received.shift();
            assert.equal(session.ack(envelope).messageId, envelope.messageId);
          } else if (command === "nack" && received.length) {
            assert.equal(session.nack(received.shift(), { code: "permanent", message: "stop" }).retryable, false);
          } else if (command === "cancel") {
            session.cancel();
            session.cancel();
          } else if (command === "close") {
            await session.close();
            await session.close();
          }
          assert.ok(channel.size <= channel.config.capacity);
          assert.deepEqual(new Set(session.pendingEnvelopes.keys()), new Set(received.map((item) => item.messageId)));
        }
        await session.close();
        assert.ok([...session.processes.values()].every((handle) => handle.done));
      },
    ),
    propertyOptions,
  );
});

test("deduplication suppresses concurrent identity", async () => {
  const session = new CspRuntime().createSession({ config: new SessionConfig({ sessionId: "dedup", channelCapacity: 3 }) });
  const first = makeEnvelope({ sessionId: "dedup", channel: "work", source: "test", sequence: 1, payloadType: "json", payload: 1, idempotencyKey: "same" });
  const duplicate = MessageEnvelope.fromWire({ ...first.toWire(), message_id: "duplicate" });
  await session.send("work", first);
  await session.send("work", duplicate);
  assert.equal((await session.receive("work")).messageId, first.messageId);
  const result = await Promise.race([
    session.receive("work").then(() => "delivered"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 5)),
  ]);
  assert.equal(result, "timeout");
  session.cancel();
  await session.close();
});

test("ACK only resolves matching message", () => {
  const session = new CspRuntime().createSession({ sessionId: "ack-property" });
  const first = makeEnvelope({ sessionId: "ack-property", channel: "work", source: "test", sequence: 1, payloadType: "json", payload: {} });
  const second = MessageEnvelope.fromWire({ ...first.toWire(), message_id: "second" });
  session.pendingEnvelopes.set(first.messageId, first);
  session.pendingEnvelopes.set(second.messageId, second);
  session.ack(first);
  assert.equal(session.pendingEnvelopes.has(first.messageId), false);
  assert.equal(session.pendingEnvelopes.has(second.messageId), true);
});

test("session deadline inheritance never extends an earlier envelope deadline", async () => {
  const sessionDeadline = new Date(Date.now() + 60_000).toISOString();
  const envelopeDeadline = new Date(Date.now() + 10_000).toISOString();
  const session = new CspRuntime().createSession({
    config: new SessionConfig({ sessionId: "deadline-property", deadline: sessionDeadline }),
  });
  const inherited = MessageEnvelope.fromWire({
    ...makeEnvelope({
      sessionId: session.sessionId,
      channel: "work",
      source: "test",
      sequence: 1,
      payloadType: "json",
      payload: {},
    }).toWire(),
    deadline: envelopeDeadline,
  });
  await session.send("work", inherited);
  assert.equal((await session.receive("work")).deadline, envelopeDeadline);
  await session.close();
});
