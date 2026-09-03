export const STUDIO_BROWSER_EVENT_FORMAT = "handoffkit.studio.browser-event";
export const STUDIO_BROWSER_SNAPSHOT_FORMAT = "handoffkit.studio.browser-snapshot";
export const STUDIO_BROWSER_MAX_FILE_BYTES = 2_000_000;
export const STUDIO_BROWSER_MAX_EVENTS = 500;

const EVENT_TYPES = new Set([
  "browser.plan",
  "browser.progress",
  "browser.page",
  "browser.permission",
  "browser.error",
  "browser.claim",
  "browser.contradiction",
  "browser.control",
  "browser.profile",
  "browser.index",
  "browser.recovery",
]);

const SENSITIVE = /cookie|authorization|token|password|secret|api[_-]?key|set-cookie/i;

export type StudioBrowserEvent = {
  format: string;
  event_id: string;
  event_type: string;
  occurred_at: string;
  session_id: string;
  job_id: string;
  payload: Record<string, unknown>;
};

export type StudioBrowserSnapshot = {
  format: string;
  format_version: number;
  generated_at: string | null;
  source: { status: string; error_code: string };
  plan: Record<string, unknown> | null;
  stages: Array<{ stage: string; message: string; occurred_at: string }>;
  page: Record<string, unknown> | null;
  permissions: string[];
  timeline: Array<{ event_id: string; event_type: string; occurred_at: string; message: unknown }>;
  errors: Array<{ code: string; message: string }>;
  sources: unknown[];
  snapshots: unknown[];
  claims: Record<string, unknown>[];
  contradictions: Record<string, unknown>[];
  controls: Record<string, boolean>;
  profile: Record<string, unknown>;
  index: Record<string, unknown>;
  recovery: { delivery: string; checkpoint: unknown };
  control_sink: { status: string };
  runtime: { kind: string; connected: boolean };
  session: { session_id: string; status: string; version: number };
};

export class StudioBrowserEventError extends Error {
  code: string;
  constructor(message: string, code = "studio_browser_event_invalid") {
    super(message);
    this.name = "StudioBrowserEventError";
    this.code = code;
  }
}

export function emptyStudioBrowserSnapshot(status = "unconfigured", errorCode = ""): StudioBrowserSnapshot {
  return {
    format: STUDIO_BROWSER_SNAPSHOT_FORMAT,
    format_version: 1,
    generated_at: null,
    source: { status, error_code: errorCode || (status === "unconfigured" ? "studio_browser_unconfigured" : "") },
    plan: null,
    stages: [],
    page: null,
    permissions: [],
    timeline: [],
    errors: [],
    sources: [],
    snapshots: [],
    claims: [],
    contradictions: [],
    controls: { pause: false, resume: false, cancel: false, retry: false },
    profile: { kind: "unknown", persistent: false },
    index: { enabled: false, backend: "unavailable", disclaimer: "project_index is not a complete Internet index" },
    recovery: { delivery: "at_least_once", checkpoint: null },
    control_sink: { status: "unconfigured" },
    runtime: { kind: "unconfigured", connected: false },
    session: { session_id: "", status: "disconnected", version: 0 },
  };
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StudioBrowserEventError(`${field} must be an object`);
  }
}

function rejectSensitive(value: unknown, field = "payload") {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE.test(key)) {
      throw new StudioBrowserEventError(`${field} contains sensitive field ${key}`, "studio_browser_secret_detected");
    }
    if (item && typeof item === "object") rejectSensitive(item, `${field}.${key}`);
  }
}

export function parseStudioBrowserEvent(raw: Record<string, unknown>): StudioBrowserEvent {
  assertObject(raw, "event");
  if (raw.format !== STUDIO_BROWSER_EVENT_FORMAT) {
    throw new StudioBrowserEventError("event format is unavailable", "studio_browser_event_version");
  }
  if (raw.mock === true || raw.synthetic === true || raw.fixture_as_live === true) {
    throw new StudioBrowserEventError("mock telemetry cannot be presented as runtime data", "studio_browser_mock_rejected");
  }
  if (!EVENT_TYPES.has(String(raw.event_type))) {
    throw new StudioBrowserEventError(`unknown event_type ${raw.event_type}`);
  }
  if (typeof raw.event_id !== "string" || !raw.event_id) {
    throw new StudioBrowserEventError("event_id is invalid");
  }
  if (typeof raw.occurred_at !== "string" || Number.isNaN(Date.parse(raw.occurred_at))) {
    throw new StudioBrowserEventError("occurred_at is not RFC 3339");
  }
  assertObject(raw.payload, "payload");
  rejectSensitive(raw.payload);
  return {
    format: STUDIO_BROWSER_EVENT_FORMAT,
    event_id: raw.event_id,
    event_type: String(raw.event_type),
    occurred_at: raw.occurred_at,
    session_id: typeof raw.session_id === "string" ? raw.session_id : "",
    job_id: typeof raw.job_id === "string" ? raw.job_id : "",
    payload: { ...raw.payload },
  };
}

export function parseStudioBrowserNdjson(text: string) {
  const events: StudioBrowserEvent[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new StudioBrowserEventError("corrupt JSON line", "studio_browser_event_invalid");
    }
    events.push(parseStudioBrowserEvent(parsed as Record<string, unknown>));
    if (events.length > STUDIO_BROWSER_MAX_EVENTS) {
      throw new StudioBrowserEventError("event count exceeds its limit", "studio_browser_source_too_large");
    }
  }
  return events;
}

export function reduceStudioBrowserEvents(events: StudioBrowserEvent[], extras: Record<string, unknown> = {}) {
  const snapshot = emptyStudioBrowserSnapshot("connected");
  snapshot.generated_at = String(extras.generatedAt || extras.generated_at || new Date().toISOString());
  for (const event of events) {
    snapshot.timeline.push({
      event_id: event.event_id,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      message: event.payload.message || event.payload.stage || event.event_type,
    });
    if (event.event_type === "browser.plan") snapshot.plan = { ...event.payload };
    if (event.event_type === "browser.progress") {
      snapshot.stages.push({
        stage: String(event.payload.stage || ""),
        message: String(event.payload.message || ""),
        occurred_at: event.occurred_at,
      });
    }
    if (event.event_type === "browser.page") snapshot.page = { ...event.payload };
    if (event.event_type === "browser.permission") {
      snapshot.permissions = Array.isArray(event.payload.permissions)
        ? event.payload.permissions.map((item) => String(item))
        : [];
    }
    if (event.event_type === "browser.error") {
      snapshot.errors.push({
        code: String(event.payload.code || "error"),
        message: String(event.payload.message || ""),
      });
    }
    if (event.event_type === "browser.claim") snapshot.claims.push({ ...event.payload });
    if (event.event_type === "browser.contradiction") snapshot.contradictions.push({ ...event.payload });
    if (event.event_type === "browser.control") snapshot.controls = { ...snapshot.controls, ...event.payload as Record<string, boolean> };
    if (event.event_type === "browser.profile") snapshot.profile = { ...snapshot.profile, ...event.payload };
    if (event.event_type === "browser.index") snapshot.index = { ...snapshot.index, ...event.payload };
    if (event.event_type === "browser.recovery") {
      snapshot.recovery = { delivery: "at_least_once", checkpoint: null, ...event.payload };
    }
    if (event.session_id) snapshot.session = { ...snapshot.session, session_id: event.session_id };
    if (event.payload.status) snapshot.session = { ...snapshot.session, status: String(event.payload.status) };
    if (Array.isArray(event.payload.sources)) snapshot.sources = event.payload.sources;
    if (Array.isArray(event.payload.snapshots)) snapshot.snapshots = event.payload.snapshots;
  }
  return snapshot;
}

export function markStudioBrowserDisconnected(snapshot: StudioBrowserSnapshot) {
  return {
    ...snapshot,
    source: { status: "disconnected", error_code: "studio_browser_disconnected" },
  };
}
