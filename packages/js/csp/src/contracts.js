export const HK_CSP_VERSION = "1.0";
export const HANDOFFKIT_CSP_VERSION = "1.16.0";
export const DEFAULT_CHANNEL_CAPACITY = 64;
export const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export const RuntimeMode = Object.freeze({
  CLASSIC: "classic",
  SESSION: "session",
  DISTRIBUTED: "distributed",
});

export const OverflowPolicy = Object.freeze({ BLOCK: "block", REJECT: "reject" });

export class CspError extends Error {}
export class ChannelClosedError extends CspError {}
export class BackpressureError extends CspError {}
export class DeadlineExceededError extends CspError {}
export class MessageTooLargeError extends CspError {}
export class DistributedRuntimeUnavailableError extends CspError {}
export class ProtocolVersionError extends CspError {}

function now() {
  return new Date().toISOString();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

export class RetryPolicy {
  constructor({ maxAttempts = 3, baseDelayMs = 100, maxDelayMs = 2000 } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be at least 1");
    if (baseDelayMs < 0 || maxDelayMs < 0) throw new TypeError("retry delays must not be negative");
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }
  toWire() {
    return { max_attempts: this.maxAttempts, base_delay_ms: this.baseDelayMs, max_delay_ms: this.maxDelayMs };
  }
  static fromWire(value = {}) {
    return new RetryPolicy({
      maxAttempts: value.maxAttempts ?? value.max_attempts,
      baseDelayMs: value.baseDelayMs ?? value.base_delay_ms,
      maxDelayMs: value.maxDelayMs ?? value.max_delay_ms,
    });
  }
}

export class SessionConfig {
  constructor({
    sessionId,
    runtimeMode = RuntimeMode.SESSION,
    channelCapacity = DEFAULT_CHANNEL_CAPACITY,
    maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
    ackTimeoutMs = 30000,
    dedupCapacity = 4096,
    retryPolicy = new RetryPolicy(),
    deadline = null,
    metadata = {},
  } = {}) {
    if (!sessionId) throw new TypeError("sessionId is required");
    if (!Number.isInteger(channelCapacity) || channelCapacity < 1) throw new TypeError("channelCapacity must be at least 1");
    if (!Number.isInteger(maxMessageBytes) || maxMessageBytes < 1024) throw new TypeError("maxMessageBytes must be at least 1024");
    if (!Number.isInteger(ackTimeoutMs) || ackTimeoutMs < 1) throw new TypeError("ackTimeoutMs must be positive");
    if (!Number.isInteger(dedupCapacity) || dedupCapacity < 1) throw new TypeError("dedupCapacity must be positive");
    if (deadline && Number.isNaN(Date.parse(deadline))) throw new TypeError("deadline must be a valid timestamp");
    this.sessionId = String(sessionId);
    this.runtimeMode = runtimeMode;
    this.channelCapacity = channelCapacity;
    this.maxMessageBytes = maxMessageBytes;
    this.ackTimeoutMs = ackTimeoutMs;
    this.dedupCapacity = dedupCapacity;
    this.retryPolicy = retryPolicy instanceof RetryPolicy ? retryPolicy : RetryPolicy.fromWire(retryPolicy);
    this.deadline = deadline;
    this.metadata = object(metadata);
  }
  toWire() {
    return {
      session_id: this.sessionId,
      runtime_mode: this.runtimeMode,
      channel_capacity: this.channelCapacity,
      max_message_bytes: this.maxMessageBytes,
      ack_timeout_ms: this.ackTimeoutMs,
      dedup_capacity: this.dedupCapacity,
      retry_policy: this.retryPolicy.toWire(),
      deadline: this.deadline,
      metadata: { ...this.metadata },
    };
  }
  static fromWire(value) {
    return new SessionConfig({
      sessionId: value.sessionId ?? value.session_id,
      runtimeMode: value.runtimeMode ?? value.runtime_mode,
      channelCapacity: value.channelCapacity ?? value.channel_capacity,
      maxMessageBytes: value.maxMessageBytes ?? value.max_message_bytes,
      ackTimeoutMs: value.ackTimeoutMs ?? value.ack_timeout_ms,
      dedupCapacity: value.dedupCapacity ?? value.dedup_capacity,
      retryPolicy: value.retryPolicy ?? value.retry_policy,
      deadline: value.deadline,
      metadata: value.metadata,
    });
  }
}

export class ChannelConfig {
  constructor({ name, capacity = DEFAULT_CHANNEL_CAPACITY, overflowPolicy = OverflowPolicy.BLOCK, requiresAck = false, metadata = {} } = {}) {
    if (!name) throw new TypeError("channel name is required");
    if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError("capacity must be at least 1");
    this.name = String(name);
    this.capacity = capacity;
    this.overflowPolicy = overflowPolicy;
    this.requiresAck = Boolean(requiresAck);
    this.metadata = object(metadata);
  }
  toWire() {
    return { name: this.name, capacity: this.capacity, overflow_policy: this.overflowPolicy, requires_ack: this.requiresAck, metadata: { ...this.metadata } };
  }
  static fromWire(value) {
    return new ChannelConfig({
      name: value.name,
      capacity: value.capacity,
      overflowPolicy: value.overflowPolicy ?? value.overflow_policy,
      requiresAck: value.requiresAck ?? value.requires_ack,
      metadata: value.metadata,
    });
  }
}

export class MessageEnvelope {
  constructor({
    messageId,
    sessionId,
    channel,
    kind,
    source,
    sequence,
    payloadType,
    payload,
    protocolVersion = HK_CSP_VERSION,
    target = null,
    createdAt = now(),
    deadline = null,
    correlationId = null,
    causationId = null,
    idempotencyKey = null,
    attempt = 1,
    requiresAck = false,
    metadata = {},
  }) {
    if (String(protocolVersion).split(".")[0] !== HK_CSP_VERSION.split(".")[0]) {
      throw new ProtocolVersionError(`Unsupported HK-CSP protocol version ${protocolVersion}.`);
    }
    for (const [name, value] of Object.entries({ messageId, sessionId, channel, kind, source, payloadType })) {
      if (!value) throw new TypeError(`${name} is required`);
    }
    if (!Number.isInteger(Number(sequence)) || Number(sequence) < 0) throw new TypeError("sequence must be a non-negative integer");
    if (!Number.isInteger(Number(attempt)) || Number(attempt) < 1) throw new TypeError("attempt must be a positive integer");
    if (Number.isNaN(Date.parse(createdAt))) throw new TypeError("createdAt must be a valid timestamp");
    if (deadline && Number.isNaN(Date.parse(deadline))) throw new TypeError("deadline must be a valid timestamp");
    this.protocolVersion = String(protocolVersion);
    this.messageId = String(messageId);
    this.sessionId = String(sessionId);
    this.channel = String(channel);
    this.kind = String(kind);
    this.source = String(source);
    this.target = target == null ? null : String(target);
    this.sequence = Number(sequence);
    this.createdAt = String(createdAt);
    this.deadline = deadline;
    this.correlationId = correlationId;
    this.causationId = causationId;
    this.idempotencyKey = idempotencyKey;
    this.attempt = Number(attempt);
    this.requiresAck = Boolean(requiresAck);
    this.payloadType = String(payloadType);
    this.payload = payload;
    this.metadata = object(metadata);
  }
  toWire() {
    return {
      protocol_version: this.protocolVersion,
      message_id: this.messageId,
      session_id: this.sessionId,
      channel: this.channel,
      kind: this.kind,
      source: this.source,
      target: this.target,
      sequence: this.sequence,
      created_at: this.createdAt,
      deadline: this.deadline,
      correlation_id: this.correlationId,
      causation_id: this.causationId,
      idempotency_key: this.idempotencyKey,
      attempt: this.attempt,
      requires_ack: this.requiresAck,
      payload_type: this.payloadType,
      payload: this.payload,
      metadata: { ...this.metadata },
    };
  }
  toJSON() { return this.toWire(); }
  toJSONString(space = 0) { return JSON.stringify(this.toWire(), null, space); }
  encodedSize() { return new TextEncoder().encode(this.toJSONString()).byteLength; }
  nextAttempt() { return MessageEnvelope.fromWire({ ...this.toWire(), attempt: this.attempt + 1 }); }
  static fromWire(value) {
    return new MessageEnvelope({
      protocolVersion: value.protocolVersion ?? value.protocol_version,
      messageId: value.messageId ?? value.message_id,
      sessionId: value.sessionId ?? value.session_id,
      channel: value.channel,
      kind: value.kind,
      source: value.source,
      target: value.target,
      sequence: value.sequence,
      createdAt: value.createdAt ?? value.created_at,
      deadline: value.deadline,
      correlationId: value.correlationId ?? value.correlation_id,
      causationId: value.causationId ?? value.causation_id,
      idempotencyKey: value.idempotencyKey ?? value.idempotency_key,
      attempt: value.attempt,
      requiresAck: value.requiresAck ?? value.requires_ack,
      payloadType: value.payloadType ?? value.payload_type,
      payload: value.payload,
      metadata: value.metadata,
    });
  }
  static fromJSON(value) { return MessageEnvelope.fromWire(typeof value === "string" ? JSON.parse(value) : value); }
}

export class DeliveryAck {
  constructor({ messageId, processedAt = now(), metadata = {} }) { this.messageId = messageId; this.processedAt = processedAt; this.metadata = object(metadata); }
  toWire() { return { message_id: this.messageId, processed_at: this.processedAt, metadata: { ...this.metadata } }; }
}

export class DeliveryNack {
  constructor({ messageId, code, message, retryable = false, processedAt = now(), metadata = {} }) {
    Object.assign(this, { messageId, code, message, retryable: Boolean(retryable), processedAt, metadata: object(metadata) });
  }
  toWire() { return { message_id: this.messageId, code: this.code, message: this.message, retryable: this.retryable, processed_at: this.processedAt, metadata: { ...this.metadata } }; }
}

export class ProcessError {
  constructor({ code, message, processId, retryable = false, details = {}, timestamp = now() }) {
    Object.assign(this, { code, message, processId, retryable: Boolean(retryable), details: object(details), timestamp });
  }
  toWire() { return { code: this.code, message: this.message, process_id: this.processId, retryable: this.retryable, details: { ...this.details }, timestamp: this.timestamp }; }
}

class WireRecord {
  constructor(value = {}) { this.value = typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  toWire() { return { ...this.value }; }
  toJSON() { return this.toWire(); }
}

export class ArtifactRef extends WireRecord {}
export class WorkerCapabilities extends WireRecord {}
export class TrainingJob extends WireRecord {}
export class EvaluationJob extends WireRecord {}
export class JobProgress extends WireRecord {}
