export const STUDIO_SECURITY_EVENT_FORMAT = "handoffkit.studio.security-event";
export const STUDIO_SECURITY_EVENT_VERSION = 1;
export const STUDIO_SECURITY_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const STUDIO_SECURITY_MAX_EVENTS = 20_000;
export const STUDIO_SECURITY_MAX_LINE_BYTES = 64 * 1024;

export type StudioEventType =
  | "session.observed"
  | "session.reconnected"
  | "security.rejected"
  | "job.updated"
  | "artifact.verified"
  | "runtime.status";

export type StudioRuntime = "python" | "node" | "go" | "rust" | "cpp";
export type StudioEdgeProfile = "edge-small" | "edge-standard" | "server";
export type StudioSourceStatus =
  | "connected"
  | "unconfigured"
  | "invalid"
  | "disconnected";

export type SessionPayload = {
  session_id: string;
  peer_id: string;
  node_id: string;
  worker_id: string | null;
  identity_source: "certificate-san";
  trust_domain: string;
  credential_fingerprint: string;
  certificate_expires_at: string;
  certificate_state: "valid" | "expired";
  security_profile: "standard" | "hybrid-pq";
  tls_version: "TLSv1.3";
  negotiated_group: string | null;
  hybrid_pq_provider_state:
    | "unavailable"
    | "available-not-selected"
    | "negotiated";
  revocation_state: "not-configured" | "not-revoked" | "revoked";
  rotation: {
    status: "not-configured" | "current" | "transition";
    current_fingerprint: string | null;
    previous_fingerprint: string | null;
    previous_accepted: boolean;
    transition_until: string | null;
  };
  queue: { pending: number; capacity: number };
  reconnects: number;
};

export type RejectionPayload = {
  session_id: string | null;
  category:
    | "authentication"
    | "authorization"
    | "replay"
    | "revocation"
    | "transcript"
    | "artifact"
    | "worker";
  code: string;
  message: string;
};

export type JobPayload = {
  job_id: string;
  operation: "training" | "evaluation";
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  progress: number;
  worker_id: string | null;
  error_code: string | null;
};

export type ArtifactPayload = {
  artifact_id: string;
  job_id: string;
  media_type: string;
  verification: "verified" | "rejected";
  producer_identity: string | null;
  identity_source: "verified-signer" | "unverified";
  signer_fingerprint: string | null;
  error_code: string | null;
};

export type RuntimeStatusPayload = {
  connections: number;
  connection_limit: number;
  queue: { pending: number; capacity: number };
  replay_rejections: number;
  authorization_rejections: number;
  reconnects: number;
  hybrid_pq_provider_state:
    | "unavailable"
    | "available-not-selected"
    | "negotiated";
};

export type StudioSecurityEvent = {
  format: typeof STUDIO_SECURITY_EVENT_FORMAT;
  format_version: typeof STUDIO_SECURITY_EVENT_VERSION;
  event_id: string;
  event_type: StudioEventType;
  observed_at: string;
  runtime: StudioRuntime;
  edge_profile: StudioEdgeProfile;
  payload:
    | SessionPayload
    | RejectionPayload
    | JobPayload
    | ArtifactPayload
    | RuntimeStatusPayload;
};

export type StudioSessionView = SessionPayload & {
  runtime: StudioRuntime;
  edge_profile: StudioEdgeProfile;
  updated_at: string;
  replay_rejections: number;
  authorization_rejections: number;
};

export type StudioJobView = JobPayload & {
  runtime: StudioRuntime;
  edge_profile: StudioEdgeProfile;
  updated_at: string;
};

export type StudioArtifactView = ArtifactPayload & {
  runtime: StudioRuntime;
  edge_profile: StudioEdgeProfile;
  updated_at: string;
};

export type StudioRuntimeError = RejectionPayload & {
  runtime: StudioRuntime;
  edge_profile: StudioEdgeProfile;
  observed_at: string;
};

export type StudioSecuritySnapshot = {
  format: "handoffkit.studio.security-snapshot";
  format_version: 1;
  generated_at: string;
  source: {
    status: StudioSourceStatus;
    event_count: number;
    last_event_at: string | null;
    error_code: string | null;
  };
  metrics: RuntimeStatusPayload;
  sessions: StudioSessionView[];
  jobs: StudioJobView[];
  artifacts: StudioArtifactView[];
  errors: StudioRuntimeError[];
};

export class StudioSecurityEventError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StudioSecurityEventError";
    this.code = code;
  }
}

const ID = /^[A-Za-z0-9._:@-]{1,128}$/;
const IDENTITY = /^(?:[A-Za-z0-9._:@-]{1,128}|spiffe:\/\/[A-Za-z0-9._:@/-]{1,240})$/;
const FINGERPRINT = /^sha256:[0-9a-f]{12}\.\.\.[0-9a-f]{8}$/;
const RUNTIMES = new Set<StudioRuntime>(["python", "node", "go", "rust", "cpp"]);
const EDGE_PROFILES = new Set<StudioEdgeProfile>(["edge-small", "edge-standard", "server"]);
const EVENT_TYPES = new Set<StudioEventType>([
  "session.observed",
  "session.reconnected",
  "security.rejected",
  "job.updated",
  "artifact.verified",
  "runtime.status",
]);

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StudioSecurityEventError("studio_event_invalid", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new StudioSecurityEventError("studio_event_unknown_field", `${field} fields are invalid`);
  }
}

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new StudioSecurityEventError("studio_event_invalid", `${field} is invalid`);
  }
  return value;
}

function nullableId(value: unknown, field: string): string | null {
  return value === null ? null : id(value, field);
}

function nullableIdentity(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !IDENTITY.test(value)) {
    throw new StudioSecurityEventError("studio_event_invalid", `${field} is invalid`);
  }
  return value;
}

function fingerprint(value: unknown, field: string): string {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) {
    throw new StudioSecurityEventError("studio_event_fingerprint_unredacted", `${field} must be truncated`);
  }
  return value;
}

function nullableFingerprint(value: unknown, field: string): string | null {
  return value === null ? null : fingerprint(value, field);
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.includes("T") || Number.isNaN(Date.parse(value))) {
    throw new StudioSecurityEventError("studio_event_invalid", `${field} is not RFC 3339`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new StudioSecurityEventError("studio_event_invalid", `${field} is outside bounds`);
  }
  return value as number;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new StudioSecurityEventError("studio_event_invalid", `${field} is invalid`);
  }
  return value as T;
}

function safeMessage(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 240) {
    throw new StudioSecurityEventError("studio_event_invalid", "payload.message is invalid");
  }
  if (/-----BEGIN|Bearer\s|\b(?:sk-|pypi-|gsk_)[A-Za-z0-9_-]+|[A-Za-z]:\\|\/(?:home|Users|tmp|var)\//i.test(value)) {
    throw new StudioSecurityEventError("studio_event_secret_detected", "payload.message contains sensitive data");
  }
  return value;
}

function queue(value: unknown): { pending: number; capacity: number } {
  const data = record(value, "payload.queue");
  exactKeys(data, ["pending", "capacity"], "payload.queue");
  const pending = integer(data.pending, "payload.queue.pending");
  const capacity = integer(data.capacity, "payload.queue.capacity", 1);
  if (pending > capacity) {
    throw new StudioSecurityEventError("studio_event_invalid", "queue pending exceeds capacity");
  }
  return { pending, capacity };
}

function rotation(value: unknown): SessionPayload["rotation"] {
  const data = record(value, "payload.rotation");
  exactKeys(
    data,
    ["status", "current_fingerprint", "previous_fingerprint", "previous_accepted", "transition_until"],
    "payload.rotation",
  );
  if (typeof data.previous_accepted !== "boolean") {
    throw new StudioSecurityEventError("studio_event_invalid", "rotation previous_accepted is invalid");
  }
  return {
    status: enumeration(data.status, ["not-configured", "current", "transition"], "rotation.status"),
    current_fingerprint: nullableFingerprint(data.current_fingerprint, "rotation.current_fingerprint"),
    previous_fingerprint: nullableFingerprint(data.previous_fingerprint, "rotation.previous_fingerprint"),
    previous_accepted: data.previous_accepted,
    transition_until: data.transition_until === null
      ? null
      : timestamp(data.transition_until, "rotation.transition_until"),
  };
}

function sessionPayload(value: unknown): SessionPayload {
  const data = record(value, "payload");
  exactKeys(data, [
    "session_id", "peer_id", "node_id", "worker_id", "identity_source", "trust_domain",
    "credential_fingerprint", "certificate_expires_at", "certificate_state", "security_profile",
    "tls_version", "negotiated_group", "hybrid_pq_provider_state", "revocation_state", "rotation",
    "queue", "reconnects",
  ], "payload");
  if (data.identity_source !== "certificate-san" || data.tls_version !== "TLSv1.3") {
    throw new StudioSecurityEventError("studio_event_untrusted_identity", "session identity is not certificate authenticated");
  }
  const negotiatedGroup = data.negotiated_group;
  if (negotiatedGroup !== null && (typeof negotiatedGroup !== "string" || negotiatedGroup.length > 64)) {
    throw new StudioSecurityEventError("studio_event_invalid", "negotiated_group is invalid");
  }
  return {
    session_id: id(data.session_id, "session_id"),
    peer_id: id(data.peer_id, "peer_id"),
    node_id: id(data.node_id, "node_id"),
    worker_id: nullableId(data.worker_id, "worker_id"),
    identity_source: "certificate-san",
    trust_domain: id(data.trust_domain, "trust_domain"),
    credential_fingerprint: fingerprint(data.credential_fingerprint, "credential_fingerprint"),
    certificate_expires_at: timestamp(data.certificate_expires_at, "certificate_expires_at"),
    certificate_state: enumeration(data.certificate_state, ["valid", "expired"], "certificate_state"),
    security_profile: enumeration(data.security_profile, ["standard", "hybrid-pq"], "security_profile"),
    tls_version: "TLSv1.3",
    negotiated_group: negotiatedGroup,
    hybrid_pq_provider_state: enumeration(
      data.hybrid_pq_provider_state,
      ["unavailable", "available-not-selected", "negotiated"],
      "hybrid_pq_provider_state",
    ),
    revocation_state: enumeration(data.revocation_state, ["not-configured", "not-revoked", "revoked"], "revocation_state"),
    rotation: rotation(data.rotation),
    queue: queue(data.queue),
    reconnects: integer(data.reconnects, "reconnects"),
  };
}

function rejectionPayload(value: unknown): RejectionPayload {
  const data = record(value, "payload");
  exactKeys(data, ["session_id", "category", "code", "message"], "payload");
  return {
    session_id: nullableId(data.session_id, "session_id"),
    category: enumeration(
      data.category,
      ["authentication", "authorization", "replay", "revocation", "transcript", "artifact", "worker"],
      "category",
    ),
    code: id(data.code, "code"),
    message: safeMessage(data.message),
  };
}

function jobPayload(value: unknown): JobPayload {
  const data = record(value, "payload");
  exactKeys(data, ["job_id", "operation", "status", "progress", "worker_id", "error_code"], "payload");
  if (typeof data.progress !== "number" || !Number.isFinite(data.progress) || data.progress < 0 || data.progress > 1) {
    throw new StudioSecurityEventError("studio_event_invalid", "job progress is outside bounds");
  }
  return {
    job_id: id(data.job_id, "job_id"),
    operation: enumeration(data.operation, ["training", "evaluation"], "operation"),
    status: enumeration(
      data.status,
      ["queued", "running", "completed", "failed", "cancelled", "interrupted"],
      "status",
    ),
    progress: data.progress,
    worker_id: nullableId(data.worker_id, "worker_id"),
    error_code: nullableId(data.error_code, "error_code"),
  };
}

function artifactPayload(value: unknown): ArtifactPayload {
  const data = record(value, "payload");
  exactKeys(data, [
    "artifact_id", "job_id", "media_type", "verification", "producer_identity",
    "identity_source", "signer_fingerprint", "error_code",
  ], "payload");
  if (typeof data.media_type !== "string" || data.media_type.length < 1 || data.media_type.length > 128) {
    throw new StudioSecurityEventError("studio_event_invalid", "artifact media_type is invalid");
  }
  const verification = enumeration(data.verification, ["verified", "rejected"], "verification");
  const identitySource = enumeration(data.identity_source, ["verified-signer", "unverified"], "identity_source");
  const producer = nullableIdentity(data.producer_identity, "producer_identity");
  const signer = nullableFingerprint(data.signer_fingerprint, "signer_fingerprint");
  if (verification === "verified" && (identitySource !== "verified-signer" || !producer || !signer)) {
    throw new StudioSecurityEventError("studio_event_untrusted_identity", "verified artifact lacks signer evidence");
  }
  if (verification === "rejected" && identitySource !== "unverified") {
    throw new StudioSecurityEventError("studio_event_untrusted_identity", "rejected artifact cannot claim verified identity");
  }
  return {
    artifact_id: id(data.artifact_id, "artifact_id"),
    job_id: id(data.job_id, "job_id"),
    media_type: data.media_type,
    verification,
    producer_identity: producer,
    identity_source: identitySource,
    signer_fingerprint: signer,
    error_code: nullableId(data.error_code, "error_code"),
  };
}

function runtimePayload(value: unknown): RuntimeStatusPayload {
  const data = record(value, "payload");
  exactKeys(data, [
    "connections", "connection_limit", "queue", "replay_rejections",
    "authorization_rejections", "reconnects", "hybrid_pq_provider_state",
  ], "payload");
  return {
    connections: integer(data.connections, "connections"),
    connection_limit: integer(data.connection_limit, "connection_limit", 1),
    queue: queue(data.queue),
    replay_rejections: integer(data.replay_rejections, "replay_rejections"),
    authorization_rejections: integer(data.authorization_rejections, "authorization_rejections"),
    reconnects: integer(data.reconnects, "reconnects"),
    hybrid_pq_provider_state: enumeration(
      data.hybrid_pq_provider_state,
      ["unavailable", "available-not-selected", "negotiated"],
      "hybrid_pq_provider_state",
    ),
  };
}

export function parseStudioSecurityEvent(value: unknown): StudioSecurityEvent {
  const data = record(value, "event");
  exactKeys(data, [
    "format", "format_version", "event_id", "event_type", "observed_at", "runtime",
    "edge_profile", "payload",
  ], "event");
  if (data.format !== STUDIO_SECURITY_EVENT_FORMAT || data.format_version !== STUDIO_SECURITY_EVENT_VERSION) {
    throw new StudioSecurityEventError("studio_event_version", "event format is unavailable");
  }
  const eventType = enumeration(data.event_type, [...EVENT_TYPES], "event_type");
  const runtime = enumeration(data.runtime, [...RUNTIMES], "runtime");
  const edgeProfile = enumeration(data.edge_profile, [...EDGE_PROFILES], "edge_profile");
  let payload: StudioSecurityEvent["payload"];
  if (eventType === "session.observed" || eventType === "session.reconnected") {
    payload = sessionPayload(data.payload);
  } else if (eventType === "security.rejected") {
    payload = rejectionPayload(data.payload);
  } else if (eventType === "job.updated") {
    payload = jobPayload(data.payload);
  } else if (eventType === "artifact.verified") {
    payload = artifactPayload(data.payload);
  } else {
    payload = runtimePayload(data.payload);
  }
  return {
    format: STUDIO_SECURITY_EVENT_FORMAT,
    format_version: STUDIO_SECURITY_EVENT_VERSION,
    event_id: id(data.event_id, "event_id"),
    event_type: eventType,
    observed_at: timestamp(data.observed_at, "observed_at"),
    runtime,
    edge_profile: edgeProfile,
    payload,
  };
}

export function parseStudioSecurityNdjson(text: string): StudioSecurityEvent[] {
  if (new TextEncoder().encode(text).byteLength > STUDIO_SECURITY_MAX_FILE_BYTES) {
    throw new StudioSecurityEventError("studio_event_source_too_large", "event source exceeds its limit");
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length > STUDIO_SECURITY_MAX_EVENTS) {
    throw new StudioSecurityEventError("studio_event_source_too_large", "event count exceeds its limit");
  }
  const events: StudioSecurityEvent[] = [];
  const ids = new Set<string>();
  let previousTimestamp = 0;
  for (const line of lines) {
    if (new TextEncoder().encode(line).byteLength > STUDIO_SECURITY_MAX_LINE_BYTES) {
      throw new StudioSecurityEventError("studio_event_line_too_large", "event line exceeds its limit");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      throw new StudioSecurityEventError("studio_event_json_invalid", "event source contains invalid JSON");
    }
    const event = parseStudioSecurityEvent(decoded);
    if (ids.has(event.event_id)) {
      throw new StudioSecurityEventError("studio_event_duplicate", "event source contains a duplicate event id");
    }
    const observedAt = Date.parse(event.observed_at);
    if (observedAt < previousTimestamp) {
      throw new StudioSecurityEventError("studio_event_order_invalid", "event source is not monotonic");
    }
    ids.add(event.event_id);
    previousTimestamp = observedAt;
    events.push(event);
  }
  return events;
}

const EMPTY_METRICS: RuntimeStatusPayload = {
  connections: 0,
  connection_limit: 1,
  queue: { pending: 0, capacity: 1 },
  replay_rejections: 0,
  authorization_rejections: 0,
  reconnects: 0,
  hybrid_pq_provider_state: "unavailable",
};

export function reduceStudioSecurityEvents(
  events: StudioSecurityEvent[],
  options: {
    status?: StudioSourceStatus;
    errorCode?: string | null;
    generatedAt?: string;
  } = {},
): StudioSecuritySnapshot {
  const sessions = new Map<string, StudioSessionView>();
  const jobs = new Map<string, StudioJobView>();
  const artifacts = new Map<string, StudioArtifactView>();
  const errors: StudioRuntimeError[] = [];
  let metrics = structuredClone(EMPTY_METRICS);

  for (const event of events) {
    if (event.event_type === "session.observed" || event.event_type === "session.reconnected") {
      const payload = event.payload as SessionPayload;
      const previous = sessions.get(payload.session_id);
      sessions.set(payload.session_id, {
        ...payload,
        runtime: event.runtime,
        edge_profile: event.edge_profile,
        updated_at: event.observed_at,
        replay_rejections: previous?.replay_rejections ?? 0,
        authorization_rejections: previous?.authorization_rejections ?? 0,
      });
    } else if (event.event_type === "security.rejected") {
      const payload = event.payload as RejectionPayload;
      errors.unshift({
        ...payload,
        runtime: event.runtime,
        edge_profile: event.edge_profile,
        observed_at: event.observed_at,
      });
      if (payload.category === "replay") metrics.replay_rejections += 1;
      if (payload.category === "authorization") metrics.authorization_rejections += 1;
      if (payload.session_id) {
        const session = sessions.get(payload.session_id);
        if (session) {
          if (payload.category === "replay") session.replay_rejections += 1;
          if (payload.category === "authorization") session.authorization_rejections += 1;
          if (payload.code === "credential_expired") session.certificate_state = "expired";
          if (payload.category === "revocation") session.revocation_state = "revoked";
          session.updated_at = event.observed_at;
        }
      }
    } else if (event.event_type === "job.updated") {
      const payload = event.payload as JobPayload;
      jobs.set(payload.job_id, {
        ...payload,
        runtime: event.runtime,
        edge_profile: event.edge_profile,
        updated_at: event.observed_at,
      });
    } else if (event.event_type === "artifact.verified") {
      const payload = event.payload as ArtifactPayload;
      artifacts.set(payload.artifact_id, {
        ...payload,
        runtime: event.runtime,
        edge_profile: event.edge_profile,
        updated_at: event.observed_at,
      });
    } else {
      metrics = structuredClone(event.payload as RuntimeStatusPayload);
    }
  }

  const newestFirst = <T extends { updated_at: string }>(values: T[]) =>
    values.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  return {
    format: "handoffkit.studio.security-snapshot",
    format_version: 1,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    source: {
      status: options.status ?? "connected",
      event_count: events.length,
      last_event_at: events.at(-1)?.observed_at ?? null,
      error_code: options.errorCode ?? null,
    },
    metrics,
    sessions: newestFirst([...sessions.values()]),
    jobs: newestFirst([...jobs.values()]),
    artifacts: newestFirst([...artifacts.values()]),
    errors: errors.slice(0, 50),
  };
}

export function emptyStudioSecuritySnapshot(
  status: StudioSourceStatus,
  errorCode: string | null = null,
): StudioSecuritySnapshot {
  return reduceStudioSecurityEvents([], { status, errorCode });
}

export function markStudioSecurityDisconnected(
  snapshot: StudioSecuritySnapshot,
): StudioSecuritySnapshot {
  return {
    ...snapshot,
    generated_at: new Date().toISOString(),
    source: {
      ...snapshot.source,
      status: "disconnected",
      error_code: "studio_stream_disconnected",
    },
  };
}
