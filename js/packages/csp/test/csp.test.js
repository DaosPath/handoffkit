import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  BackpressureError,
  ChannelConfig,
  CspChannel,
  CspRuntime,
  DeadlineExceededError,
  MessageEnvelope,
  OverflowPolicy,
  RetryPolicy,
  SessionConfig,
  makeEnvelope,
} from "../src/index.js";

const contractsRoot = join(import.meta.dirname, "..", "..", "..", "..", "shared", "contracts");

test("package entrypoint stays browser-safe", async () => {
  const files = ["contracts.js", "runtime.js", "index.js"];
  for (const file of files) {
    const source = await readFile(join(import.meta.dirname, "..", "src", file), "utf8");
    assert.doesNotMatch(source, /from ["']node:/);
    assert.doesNotMatch(source, /\brequire\s*\(/);
  }
});

test("canonical envelope fixture round-trips", async () => {
  const data = JSON.parse(await readFile(join(contractsRoot, "fixtures", "message_envelope.json"), "utf8"));
  assert.deepEqual(MessageEnvelope.fromWire(data).toWire(), data);
});

test("session configuration fixture round-trips", async () => {
  const data = JSON.parse(await readFile(join(contractsRoot, "fixtures", "session_config.json"), "utf8"));
  assert.deepEqual(SessionConfig.fromWire(data).toWire(), data);
});

test("rejecting bounded channel never silently drops", async () => {
  const channel = new CspChannel(new ChannelConfig({ name: "tasks", capacity: 1, overflowPolicy: OverflowPolicy.REJECT }), { maxMessageBytes: 4096 });
  await channel.send(makeEnvelope({ sessionId: "s", channel: "tasks", source: "test", sequence: 1, payloadType: "json", payload: {} }));
  await assert.rejects(
    channel.send(makeEnvelope({ sessionId: "s", channel: "tasks", source: "test", sequence: 2, payloadType: "json", payload: {} })),
    BackpressureError,
  );
});

test("retryable nack preserves ID and increments attempt", async () => {
  const session = new CspRuntime().createSession({
    config: new SessionConfig({ sessionId: "retry", ackTimeoutMs: 100, retryPolicy: new RetryPolicy({ maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 }) }),
  });
  const attempts = [];
  session.spawn("worker", async (context) => {
    const first = await context.receive("tasks");
    attempts.push(first);
    context.nack(first, { code: "busy", message: "retry", retryable: true });
    const second = await context.receive("tasks");
    attempts.push(second);
    context.ack(second);
  });
  const envelope = makeEnvelope({ sessionId: "retry", channel: "tasks", source: "test", sequence: 1, payloadType: "json", payload: {}, requiresAck: true, idempotencyKey: "operation" });
  const ack = await session.sendWithAck("tasks", envelope);
  await session.wait();
  assert.equal(ack.messageId, envelope.messageId);
  assert.deepEqual(attempts.map((item) => item.attempt), [1, 2]);
  assert.equal(attempts[0].messageId, attempts[1].messageId);
  await session.close();
});

test("deadline and cancellation are structured and cooperative", async () => {
  const channel = new CspChannel(new ChannelConfig({ name: "tasks" }));
  const expired = MessageEnvelope.fromWire({
    ...makeEnvelope({ sessionId: "deadline", channel: "tasks", source: "test", sequence: 1, payloadType: "json", payload: {} }).toWire(),
    deadline: "2000-01-01T00:00:00Z",
  });
  await assert.rejects(channel.send(expired), DeadlineExceededError);

  const session = new CspRuntime().createSession({ sessionId: "cancel" });
  let cancellationObserved = false;
  const handle = session.spawn("worker", async (context) => {
    await context.waitCancelled();
    cancellationObserved = context.cancelled;
  });
  session.cancel();
  await handle.wait();
  assert.equal(cancellationObserved, true);
  await session.close();
});

test("session deadline is inherited and enforced", async () => {
  const deadline = new Date(Date.now() + 60000).toISOString();
  const session = new CspRuntime().createSession({
    config: new SessionConfig({ sessionId: "session-deadline", deadline }),
  });
  await session.send("tasks", makeEnvelope({
    sessionId: session.sessionId,
    channel: "tasks",
    source: "test",
    sequence: 1,
    payloadType: "json",
    payload: {},
  }));
  assert.equal((await session.receive("tasks")).deadline, deadline);
  await session.close();

  const expired = new CspRuntime().createSession({
    config: new SessionConfig({ sessionId: "expired-session", deadline: "2000-01-01T00:00:00Z" }),
  });
  await assert.rejects(
    expired.send("tasks", makeEnvelope({ sessionId: "expired-session", channel: "tasks", source: "test", sequence: 1, payloadType: "json", payload: {} })),
    DeadlineExceededError,
  );
  await expired.close();
});
