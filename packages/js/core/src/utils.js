/** Shared pure helpers + public JSON utilities */
export const DEFAULT_PROTOCOL_MODE = "hybrid_state";
export const DEFAULT_CONTRACT_FIXTURES = [
  "handoff_state.json",
  "run_trace.json",
  "validation_report.json",
  "quality_report.json",
  "tool_call.json",
  "tool_result.json",
  "provider_tool_schema.json",
];
export const DEFAULT_CONTRACT_SCHEMAS = [
  "handoff-state.schema.json",
  "run-trace.schema.json",
  "validation-report.schema.json",
  "quality-report.schema.json",
  "tool-call.schema.json",
  "tool-result.schema.json",
  "provider-tool-schema.schema.json",
];


export function listSection(title, values) {
  return [`## ${title}`, ...(values.length ? values.map((value) => `- ${value}`) : ["-"])].join("\n");
}

export function agentName(agent) {
  return typeof agent === "string" ? agent : agent?.name ?? "";
}

export function scoreMetric(name, score, weight = 1) {
  return { name, score: round(score), weight, notes: [] };
}

export function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function grade(score) {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

export function cryptoRandomId() {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


export const HANDOFFKIT_CORE_VERSION = "1.13.0";
export function toJSONValue(value) {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJSONValue(item));
  if (typeof value.toJSON === "function") return toJSONValue(value.toJSON());
  if (typeof value !== "object") return undefined;

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const serialized = toJSONValue(item);
    if (serialized !== undefined) {
      result[key] = serialized;
    }
  }
  return result;
}

export function toJSONString(value, space = 2) {
  return JSON.stringify(toJSONValue(value), null, space);
}

export function serializeReport(report, { format = "json", space = 2 } = {}) {
  if (format === "object" || format === "json_object") return toJSONValue(report);
  if (format === "markdown") {
    if (typeof report?.toMarkdown !== "function") {
      throw new TypeError("Report does not implement toMarkdown().");
    }
    return report.toMarkdown();
  }
  if (format === "json") return toJSONString(report, space);
  throw new TypeError(`Unsupported report format: ${format}`);
}

export function deserializeReport(value, ReportClass = ValidationReport) {
  const data = typeof value === "string" ? JSON.parse(value) : value;
  if (ReportClass && typeof ReportClass.fromJSON === "function") {
    return ReportClass.fromJSON(data);
  }
  return data;
}

