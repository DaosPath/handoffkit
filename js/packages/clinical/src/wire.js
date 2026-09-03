import { ERROR_CODES } from "./constants.js";

export class ClinicalError extends Error {
  constructor(message, init = {}) {
    super(message);
    this.name = "ClinicalError";
    this.code = ERROR_CODES.includes(init.code) ? init.code : "invalid_request";
    this.details = { ...(init.details ?? {}) };
  }

  toWire() {
    return { code: this.code, message: this.message, details: { ...this.details } };
  }

  toDict() {
    return this.toWire();
  }
}

export function asText(value, fallback = "") {
  return value == null ? fallback : String(value);
}

export function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

export function asList(value) {
  return Array.isArray(value) ? [...value] : [];
}

export function requireOneOf(value, allowed, field) {
  const text = asText(value);
  if (!allowed.includes(text)) {
    throw new ClinicalError(`unsupported ${field}`, { code: "invalid_request", details: { field, value: text } });
  }
  return text;
}
