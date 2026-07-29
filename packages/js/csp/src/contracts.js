export const HK_CSP_VERSION = "1.0";
export const HANDOFFKIT_CSP_VERSION = "1.16.0";
export const DEFAULT_CHANNEL_CAPACITY = 64;
export const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_NESTING_DEPTH = 64;
export const MIN_MESSAGE_BYTES = 1024;
export const MAX_ERROR_MESSAGE_BYTES = 2048;
export const MAX_RETRY_ATTEMPTS = 100;

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

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function requireNonempty(name, value) {
  if (value == null || String(value).trim() === "") throw new TypeError(`${name} must not be empty`);
}

function optionalNonempty(name, value) {
  if (value != null && String(value).trim() === "") throw new TypeError(`${name} must not be empty when set`);
}

export function validateTimestamp(value, fieldName = "timestamp") {
  if (typeof value !== "string" || !RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${fieldName} must be an RFC 3339 timestamp`);
  }
  return Date.parse(value);
}

export function jsonDepth(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return 1;
  if (seen.has(value)) throw new TypeError("message payload must not contain cycles");
  seen.add(value);
  const values = Array.isArray(value) ? value : Object.values(value);
  const depth = 1 + values.reduce((maximum, item) => Math.max(maximum, jsonDepth(item, seen)), 0);
  seen.delete(value);
  return depth;
}

export function sanitizeErrorMessage(message) {
  let sanitized = String(message).replace(/[\r\n]/g, " ").replaceAll("\0", "");
  for (const prefix of ["Bearer ", "sk-", "gsk_", "pypi-"]) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    sanitized = sanitized.replace(new RegExp(`${escaped}[^\\s,;\\)\\]\\}]+`, "g"), `${prefix}[REDACTED]`);
  }
  const encoded = new TextEncoder().encode(sanitized);
  if (encoded.byteLength <= MAX_ERROR_MESSAGE_BYTES) return sanitized;
  return new TextDecoder().decode(encoded.slice(0, MAX_ERROR_MESSAGE_BYTES)).replace(/\uFFFD$/, "");
}

export function validationErrorCode(error) {
  const message = String(error?.message ?? error).toLowerCase();
  const mappings = [
    ["protocol version", "unsupported_version"],
    ["rfc 3339", "invalid_timestamp"],
    ["valid timestamp", "invalid_timestamp"],
    ["deadline must not", "invalid_deadline"],
    ["must not be empty", "empty_field"],
    ["is required", "empty_field"],
    ["at least", "below_minimum"],
    ["positive", "below_minimum"],
    ["must not exceed", "above_maximum"],
    ["nesting depth", "nesting_too_deep"],
    ["message exceeds", "message_too_large"],
    ["invalid_profile", "invalid_profile"],
    ["sha256", "invalid_sha256"],
    ["between 0 and 1", "invalid_progress"],
  ];
  return mappings.find(([needle]) => message.includes(needle))?.[1] ?? "invalid_contract";
}

export class RetryPolicy {
  constructor({ maxAttempts = 3, baseDelayMs = 100, maxDelayMs = 2000 } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be at least 1");
    if (maxAttempts > MAX_RETRY_ATTEMPTS) throw new TypeError(`maxAttempts must not exceed ${MAX_RETRY_ATTEMPTS}`);
    if (!Number.isInteger(baseDelayMs) || !Number.isInteger(maxDelayMs) || baseDelayMs < 0 || maxDelayMs < 0) throw new TypeError("retry delays must not be negative integers");
    if (baseDelayMs > maxDelayMs) throw new TypeError("baseDelayMs must not exceed maxDelayMs");
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
    requireNonempty("sessionId", sessionId);
    if (!Number.isInteger(channelCapacity) || channelCapacity < 1) throw new TypeError("channelCapacity must be at least 1");
    if (!Number.isInteger(maxMessageBytes) || maxMessageBytes < 1024) throw new TypeError("maxMessageBytes must be at least 1024");
    if (!Number.isInteger(ackTimeoutMs) || ackTimeoutMs < 1) throw new TypeError("ackTimeoutMs must be positive");
    if (!Number.isInteger(dedupCapacity) || dedupCapacity < 1) throw new TypeError("dedupCapacity must be positive");
    if (deadline) validateTimestamp(deadline, "deadline");
    if (!Object.values(RuntimeMode).includes(runtimeMode)) throw new TypeError("runtimeMode is invalid");
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
    requireNonempty("channel.name", name);
    if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError("capacity must be at least 1");
    if (!Object.values(OverflowPolicy).includes(overflowPolicy)) throw new TypeError("overflowPolicy is invalid");
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
      requireNonempty(name, value);
    }
    for (const [name, value] of Object.entries({ target, correlationId, causationId, idempotencyKey })) optionalNonempty(name, value);
    if (!Number.isInteger(Number(sequence)) || Number(sequence) < 0) throw new TypeError("sequence must be a non-negative integer");
    if (!Number.isInteger(Number(attempt)) || Number(attempt) < 1) throw new TypeError("attempt must be a positive integer");
    validateTimestamp(createdAt, "createdAt");
    if (deadline) validateTimestamp(deadline, "deadline");
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
    this.validateWithLimits();
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
  validateWithLimits({ maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES, maxNestingDepth = DEFAULT_MAX_NESTING_DEPTH } = {}) {
    if (this.encodedSize() > maxMessageBytes) throw new TypeError(`message exceeds limit of ${maxMessageBytes} bytes`);
    const metadataDepth = 1 + Object.values(this.metadata).reduce((maximum, item) => Math.max(maximum, jsonDepth(item)), 0);
    if (Math.max(jsonDepth(this.payload), metadataDepth) > maxNestingDepth) {
      throw new TypeError(`message nesting depth exceeds limit of ${maxNestingDepth}`);
    }
    return this;
  }
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
  constructor({ messageId, processedAt = now(), metadata = {} }) {
    requireNonempty("messageId", messageId);
    validateTimestamp(processedAt, "processedAt");
    this.messageId = String(messageId); this.processedAt = processedAt; this.metadata = object(metadata);
  }
  toWire() { return { message_id: this.messageId, processed_at: this.processedAt, metadata: { ...this.metadata } }; }
}

export class DeliveryNack {
  constructor({ messageId, code, message, retryable = false, processedAt = now(), metadata = {} }) {
    requireNonempty("messageId", messageId);
    requireNonempty("code", code);
    validateTimestamp(processedAt, "processedAt");
    Object.assign(this, { messageId, code, message, retryable: Boolean(retryable), processedAt, metadata: object(metadata) });
  }
  toWire() { return { message_id: this.messageId, code: this.code, message: this.message, retryable: this.retryable, processed_at: this.processedAt, metadata: { ...this.metadata } }; }
}

export class ProcessError {
  constructor({ code, message, processId, retryable = false, details = {}, timestamp = now() }) {
    requireNonempty("code", code);
    requireNonempty("processId", processId);
    validateTimestamp(timestamp, "timestamp");
    Object.assign(this, { code, message, processId, retryable: Boolean(retryable), details: object(details), timestamp });
  }
  toWire() { return { code: this.code, message: this.message, process_id: this.processId, retryable: this.retryable, details: { ...this.details }, timestamp: this.timestamp }; }
  sanitized() { return new ProcessError({ ...this.toWire(), processId: this.processId, message: sanitizeErrorMessage(this.message) }); }
}

class WireRecord {
  constructor(value = {}) { this.value = typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  toWire() { return { ...this.value }; }
  toJSON() { return this.toWire(); }
}

export class ArtifactRef extends WireRecord {
  constructor(value = {}) {
    super(value);
    for (const name of ["artifact_id", "uri", "media_type"]) requireNonempty(name, value[name]);
    if (!/^[0-9a-fA-F]{64}$/.test(String(value.sha256 ?? ""))) throw new TypeError("sha256 must contain exactly 64 hexadecimal characters");
    if (!Number.isInteger(value.size_bytes) || value.size_bytes < 0) throw new TypeError("size_bytes must be at least 0");
  }
}
export class WorkerCapabilities extends WireRecord {
  constructor(value = {}) {
    super(value);
    for (const name of ["worker_id", "runtime", "os", "architecture"]) requireNonempty(name, value[name]);
    if (!Number.isInteger(value.cpu_cores) || value.cpu_cores < 1) throw new TypeError("cpu_cores must be at least 1");
    if (!Number.isInteger(value.memory_bytes) || value.memory_bytes < 0) throw new TypeError("memory_bytes must be at least 0");
  }
}
export class TrainingJob extends WireRecord {
  constructor(value = {}) {
    super(value);
    for (const name of ["job_id", "output", "idempotency_key"]) requireNonempty(name, value[name]);
    new ArtifactRef(value.dataset);
    if (value.deadline) validateTimestamp(value.deadline, "deadline");
  }
}
export class EvaluationJob extends WireRecord {
  constructor(value = {}) {
    super(value);
    for (const name of ["job_id", "output", "idempotency_key"]) requireNonempty(name, value[name]);
    new ArtifactRef(value.model);
    new ArtifactRef(value.dataset);
    if (value.deadline) validateTimestamp(value.deadline, "deadline");
  }
}
export class JobProgress extends WireRecord {
  constructor(value = {}) {
    super(value);
    for (const name of ["job_id", "phase", "status"]) requireNonempty(name, value[name]);
    validateTimestamp(value.timestamp, "timestamp");
    if (!Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1) throw new TypeError("progress must be between 0 and 1");
    if (!Number.isInteger(value.step) || !Number.isInteger(value.total_steps) || value.step < 0 || value.step > value.total_steps) {
      throw new TypeError("step must not exceed total_steps");
    }
    for (const artifact of value.artifacts ?? []) new ArtifactRef(artifact);
  }
}

export class WorkerHeartbeat extends WireRecord {
  constructor(value = {}) {
    super(value);
    requireNonempty("worker_id", value.worker_id);
    if (!Number.isInteger(value.sequence) || value.sequence < 0) throw new TypeError("sequence must be at least 0");
    if (!Number.isInteger(value.active_jobs) || value.active_jobs < 0) throw new TypeError("active_jobs must be at least 0");
    if (!Number.isFinite(value.load) || value.load < 0 || value.load > 1) throw new TypeError("load must be between 0 and 1");
    validateTimestamp(value.timestamp, "timestamp");
  }
}

export class DistributedJob extends WireRecord {
  constructor(value = {}) {
    super(value);
    for (const name of ["job_id", "operation", "idempotency_key"]) requireNonempty(name, value[name]);
    if (!Array.isArray(value.requested_capabilities)) throw new TypeError("requested_capabilities must be an array");
    for (const capability of value.requested_capabilities) requireNonempty("requested_capabilities item", capability);
    if (value.deadline) validateTimestamp(value.deadline, "deadline");
  }
}

export class JobAssignment extends WireRecord {
  constructor(value = {}) {
    super(value);
    for (const name of ["assignment_id", "job_id", "worker_id"]) requireNonempty(name, value[name]);
    if (!Number.isInteger(value.attempt) || value.attempt < 1) throw new TypeError("attempt must be at least 1");
    validateTimestamp(value.assigned_at, "assigned_at");
    validateTimestamp(value.lease_deadline, "lease_deadline");
    if (Date.parse(value.lease_deadline) < Date.parse(value.assigned_at)) {
      throw new TypeError("lease_deadline must not be earlier than assigned_at");
    }
  }
}
