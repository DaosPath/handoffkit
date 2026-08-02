export const HK_CSP_VERSION = "1.0";
export const HANDOFFKIT_CSP_VERSION = "1.19.0";
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
export const EdgeProfile = Object.freeze({
  EDGE_SMALL: "edge-small",
  EDGE_STANDARD: "edge-standard",
  SERVER: "server",
});

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

export class EdgeRuntimeProfile {
  constructor({
    name,
    channelCapacity,
    maxFrameBytes,
    pendingAckLimit,
    dedupCapacity,
    durableReplayCapacity,
    connectionLimit,
    heartbeatSeconds,
    reconnect,
    connectTimeoutMs,
    ioTimeoutMs,
    ackTimeoutMs,
    artifactLimitBytes,
    memoryBudgetBytes,
    durableStateLimitBytes,
    loggingLevel,
    loggingIncludePayloads,
    loggingRedactPaths,
    securityProfile,
  }) {
    if (!Object.values(EdgeProfile).includes(name)) throw new TypeError("edge profile name is invalid");
    const positive = {
      channelCapacity,
      maxFrameBytes,
      pendingAckLimit,
      dedupCapacity,
      durableReplayCapacity,
      connectionLimit,
      heartbeatSeconds,
      connectTimeoutMs,
      ioTimeoutMs,
      ackTimeoutMs,
      artifactLimitBytes,
      memoryBudgetBytes,
      durableStateLimitBytes,
    };
    if (Object.values(positive).some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new TypeError("edge runtime limits must be positive safe integers");
    }
    if (maxFrameBytes < MIN_MESSAGE_BYTES || maxFrameBytes > DEFAULT_MAX_MESSAGE_BYTES) {
      throw new TypeError(`maxFrameBytes must be between ${MIN_MESSAGE_BYTES} and ${DEFAULT_MAX_MESSAGE_BYTES}`);
    }
    if (!["warning", "info"].includes(loggingLevel)) throw new TypeError("edge loggingLevel is invalid");
    if (loggingIncludePayloads !== false) throw new TypeError("edge profiles must not log message payloads");
    if (loggingRedactPaths !== true) throw new TypeError("edge profiles must redact paths");
    if (securityProfile !== "standard") throw new TypeError("edge profiles require the standard security profile");
    Object.assign(this, {
      name,
      ...positive,
      reconnect: reconnect instanceof RetryPolicy ? reconnect : RetryPolicy.fromWire(reconnect),
      loggingLevel,
      loggingIncludePayloads,
      loggingRedactPaths,
      securityProfile,
    });
  }

  static forProfile(profile = EdgeProfile.EDGE_STANDARD) {
    const presets = {
      [EdgeProfile.EDGE_SMALL]: {
        channelCapacity: 16, maxFrameBytes: 1048576, pendingAckLimit: 32,
        dedupCapacity: 512, durableReplayCapacity: 2048, connectionLimit: 8,
        heartbeatSeconds: 30, reconnect: new RetryPolicy({ maxAttempts: 5, baseDelayMs: 250, maxDelayMs: 5000 }),
        connectTimeoutMs: 5000, ioTimeoutMs: 15000, ackTimeoutMs: 10000,
        artifactLimitBytes: 16777216, memoryBudgetBytes: 268435456,
        durableStateLimitBytes: 8388608, loggingLevel: "warning",
      },
      [EdgeProfile.EDGE_STANDARD]: {
        channelCapacity: 64, maxFrameBytes: 4194304, pendingAckLimit: 128,
        dedupCapacity: 2048, durableReplayCapacity: 10000, connectionLimit: 32,
        heartbeatSeconds: 15, reconnect: new RetryPolicy({ maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 3000 }),
        connectTimeoutMs: 5000, ioTimeoutMs: 30000, ackTimeoutMs: 30000,
        artifactLimitBytes: 67108864, memoryBudgetBytes: 1073741824,
        durableStateLimitBytes: 33554432, loggingLevel: "info",
      },
      [EdgeProfile.SERVER]: {
        channelCapacity: 256, maxFrameBytes: 8388608, pendingAckLimit: 1024,
        dedupCapacity: 16384, durableReplayCapacity: 100000, connectionLimit: 256,
        heartbeatSeconds: 10, reconnect: new RetryPolicy({ maxAttempts: 8, baseDelayMs: 50, maxDelayMs: 2000 }),
        connectTimeoutMs: 5000, ioTimeoutMs: 60000, ackTimeoutMs: 60000,
        artifactLimitBytes: 536870912, memoryBudgetBytes: 4294967296,
        durableStateLimitBytes: 268435456, loggingLevel: "info",
      },
    };
    if (!Object.hasOwn(presets, profile)) throw new TypeError("edge profile name is invalid");
    return new EdgeRuntimeProfile({
      name: profile,
      loggingIncludePayloads: false,
      loggingRedactPaths: true,
      securityProfile: "standard",
      ...presets[profile],
    });
  }

  toWire() {
    return {
      name: this.name,
      channel_capacity: this.channelCapacity,
      max_frame_bytes: this.maxFrameBytes,
      pending_ack_limit: this.pendingAckLimit,
      dedup_capacity: this.dedupCapacity,
      durable_replay_capacity: this.durableReplayCapacity,
      connection_limit: this.connectionLimit,
      heartbeat_seconds: this.heartbeatSeconds,
      reconnect: this.reconnect.toWire(),
      timeout: {
        connect_ms: this.connectTimeoutMs,
        io_ms: this.ioTimeoutMs,
        ack_ms: this.ackTimeoutMs,
      },
      artifact_limit_bytes: this.artifactLimitBytes,
      memory_budget_bytes: this.memoryBudgetBytes,
      durable_state_limit_bytes: this.durableStateLimitBytes,
      logging: {
        level: this.loggingLevel,
        include_payloads: this.loggingIncludePayloads,
        redact_paths: this.loggingRedactPaths,
      },
      security_profile: this.securityProfile,
    };
  }

  static fromWire(value) {
    return new EdgeRuntimeProfile({
      name: value.name,
      channelCapacity: value.channelCapacity ?? value.channel_capacity,
      maxFrameBytes: value.maxFrameBytes ?? value.max_frame_bytes,
      pendingAckLimit: value.pendingAckLimit ?? value.pending_ack_limit,
      dedupCapacity: value.dedupCapacity ?? value.dedup_capacity,
      durableReplayCapacity: value.durableReplayCapacity ?? value.durable_replay_capacity,
      connectionLimit: value.connectionLimit ?? value.connection_limit,
      heartbeatSeconds: value.heartbeatSeconds ?? value.heartbeat_seconds,
      reconnect: value.reconnect,
      connectTimeoutMs: value.connectTimeoutMs ?? value.timeout?.connect_ms,
      ioTimeoutMs: value.ioTimeoutMs ?? value.timeout?.io_ms,
      ackTimeoutMs: value.ackTimeoutMs ?? value.timeout?.ack_ms,
      artifactLimitBytes: value.artifactLimitBytes ?? value.artifact_limit_bytes,
      memoryBudgetBytes: value.memoryBudgetBytes ?? value.memory_budget_bytes,
      durableStateLimitBytes: value.durableStateLimitBytes ?? value.durable_state_limit_bytes,
      loggingLevel: value.loggingLevel ?? value.logging?.level,
      loggingIncludePayloads: value.loggingIncludePayloads ?? value.logging?.include_payloads,
      loggingRedactPaths: value.loggingRedactPaths ?? value.logging?.redact_paths,
      securityProfile: value.securityProfile ?? value.security_profile,
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

  static forProfile(sessionId, profile = EdgeProfile.EDGE_STANDARD, overrides = {}) {
    const edge = profile instanceof EdgeRuntimeProfile ? profile : EdgeRuntimeProfile.forProfile(profile);
    const metadata = { ...(overrides.metadata ?? {}) };
    if (metadata.edge_profile != null && metadata.edge_profile !== edge.name) {
      throw new TypeError("metadata edge_profile does not match the applied profile");
    }
    metadata.edge_profile = edge.name;
    return new SessionConfig({
      sessionId,
      channelCapacity: edge.channelCapacity,
      maxMessageBytes: edge.maxFrameBytes,
      ackTimeoutMs: edge.ackTimeoutMs,
      dedupCapacity: edge.dedupCapacity,
      retryPolicy: edge.reconnect,
      ...overrides,
      metadata,
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
