import { ERROR_CODES, PROVIDER_ALIASES } from "./constants.js";

export class BrowserCoreError extends Error {
  constructor(message, { code = "invalid_request", details = {} } = {}) {
    super(message);
    this.name = "BrowserCoreError";
    this.code = code;
    this.details = { ...details };
  }
}

export function asText(value, fallback = "") {
  return value == null ? fallback : String(value);
}

export function asBool(value, fallback = false) {
  return value == null ? fallback : Boolean(value);
}

export function asInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function asStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export function requireErrorCode(code) {
  const value = asText(code);
  if (!ERROR_CODES.includes(value)) {
    throw new BrowserCoreError(`Unknown browser error code: ${value}`, {
      code: "invalid_request",
      details: { field: "code", value },
    });
  }
  return value;
}

export function requireOneOf(value, allowed, field) {
  const text = asText(value);
  if (!allowed.includes(text)) {
    throw new BrowserCoreError(`Invalid ${field}: ${text}`, {
      code: "invalid_request",
      details: { field, value: text },
    });
  }
  return text;
}

export function normalizeProviderName(raw) {
  const value = asText(raw).trim().toLowerCase();
  if (!value) return "";
  return PROVIDER_ALIASES[value] ?? value;
}

export function isSha256Hex(value) {
  return /^[a-f0-9]{64}$/.test(asText(value));
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function requireRfc3339(value, field) {
  const text = asText(value);
  if (!text) return "";
  if (!RFC3339.test(text) || Number.isNaN(Date.parse(text))) {
    throw new BrowserCoreError(`${field} must be RFC 3339`, {
      code: "invalid_request",
      details: { field, value: text },
    });
  }
  return text;
}

function redactString(value) {
  const text = String(value);
  if (/^bearer\s+/i.test(text) || /^set-cookie:/i.test(text)) return "[redacted]";
  if (/^https?:\/\/[^/]*:[^/@]*@/i.test(text)) {
    return text.replace(/\/\/([^/@]+):([^/@]*)@/, "//[redacted]:[redacted]@");
  }
  if (/[?&](?:token|password|secret|api[_-]?key|access_token)=/i.test(text)) {
    return text.replace(/([?&](?:token|password|secret|api[_-]?key|access_token)=)([^&]*)/gi, "$1[redacted]");
  }
  if (text.length > 8192) return `${text.slice(0, 256)}…[truncated]`;
  return text;
}

export function redactSensitive(value, depth = 0) {
  if (depth > 8 || value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = /(?:cookie|authorization|token|password|secret|api[_-]?key|set-cookie|userinfo)/i.test(key)
      ? "[redacted]"
      : redactSensitive(item, depth + 1);
  }
  return out;
}
