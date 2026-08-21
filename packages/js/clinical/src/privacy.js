import {
  ALLOWED_ACT_KEYS,
  ALLOWED_CREATE_KEYS,
  MAX_USER_TEXT,
} from "./constants.js";
import { ClinicalError } from "./wire.js";

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?\d{1,3}[\s.\-]*)?(?:\(?\d{3}\)?[\s.\-]*)\d{3}[\s.\-]*\d{4}/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const MRN_RE = /\b(mrn|niss|curp|dni|ssn)[:#\s]+\w+/i;
const ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z0-9.'\-]+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|calle|avenida)\b/i;
const NAME_RE =
  /\b(my name is|i am named|mi nombre es|i am)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?\b/i;
const SYMPTOM_RE =
  /\b(i have\b.{0,60}\b(pain|fever|cough|symptoms?|chest|headache|nausea|chills)|i['’]m having\b.{0,40}\b(pain|fever|cough|symptoms?)|i am experiencing\b|me duele\b|tengo (dolor|fiebre|tos|sintomas|síntomas)\b|my (chest|head|stomach|throat|back) hurts\b|my symptoms\b|personal (symptom|history|information)\b)/i;
const BLOCKED_FIELDS = new Set([
  "symptoms",
  "personal_input",
  "phi",
  "patient_name",
  "full_name",
  "email",
  "phone",
  "address",
  "ssn",
  "dob",
  "mrn",
  "passport",
  "date_of_birth",
]);

function reject() {
  throw new ClinicalError("personal or free-text clinical input is not accepted", {
    code: "personal_input_rejected",
  });
}

export function looksPersonal(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  if (value.length > MAX_USER_TEXT) return true;
  return Boolean(
    EMAIL_RE.test(value)
      || PHONE_RE.test(value)
      || SSN_RE.test(value)
      || MRN_RE.test(value)
      || ADDRESS_RE.test(value)
      || NAME_RE.test(value)
      || SYMPTOM_RE.test(value),
  );
}

function walk(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (BLOCKED_FIELDS.has(String(key).toLowerCase()) && item) reject();
      walk(item);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }
  if (typeof value === "string" && looksPersonal(value)) reject();
}

export function rejectPersonalPayload(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) reject();
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) {
    if (extra.some((key) => BLOCKED_FIELDS.has(key.toLowerCase()))) reject();
    throw new ClinicalError("unsupported request field", { code: "invalid_request" });
  }
  for (const [key, value] of Object.entries(body)) {
    if (BLOCKED_FIELDS.has(String(key).toLowerCase()) && value) reject();
    if (typeof value === "string" && value.length > MAX_USER_TEXT) reject();
    walk(value);
  }
  return body;
}

export function rejectCreatePayload(body) {
  return rejectPersonalPayload(body, ALLOWED_CREATE_KEYS);
}

export function rejectActPayload(body) {
  return rejectPersonalPayload(body, ALLOWED_ACT_KEYS);
}
