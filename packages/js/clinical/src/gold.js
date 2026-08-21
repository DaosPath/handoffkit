import { GOLD_FIELDS } from "./constants.js";
import { ClinicalError } from "./wire.js";

export function splitSealed(sealed) {
  const source = { ...(sealed || {}) };
  const gold = {};
  for (const key of GOLD_FIELDS) {
    if (key in source) {
      gold[key] = source[key];
      delete source[key];
    }
  }
  const evidence = { sections: { ...(source.sections || {}) } };
  delete source.sections;
  return { evidence, gold, operational: source };
}

export function goldLeakFields(hay, gold) {
  const found = [];
  const text = String(hay || "").toLowerCase();
  for (const key of GOLD_FIELDS) {
    const value = gold?.[key];
    if (Array.isArray(value)) {
      for (const alias of value) {
        const token = String(alias || "").trim().toLowerCase();
        if (token.length >= 3 && new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
          found.push("aliases");
        }
      }
      continue;
    }
    const token = String(value || "").trim().toLowerCase();
    if (token.length >= 8 && text.includes(token)) found.push(key);
  }
  const pmc = String(gold?.pmcid || "");
  if (pmc) {
    const compact = pmc.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hayCompact = text.replace(/[^a-z0-9]/g, "");
    if (compact.length >= 8 && hayCompact.includes(compact)) found.push("pmcid");
  }
  return [...new Set(found)].sort();
}

export class GoldVault {
  constructor() {
    this._items = new Map();
  }

  seal(runId, gold) {
    const payload = {};
    for (const key of GOLD_FIELDS) {
      if (gold && key in gold) payload[key] = gold[key];
    }
    this._items.set(runId, payload);
  }

  get(runId) {
    return { ...(this._items.get(runId) || {}) };
  }

  drop(runId) {
    this._items.delete(runId);
  }
}

export function assertNoGoldKeys(payload, where) {
  if (payload && typeof payload === "object") {
    for (const key of GOLD_FIELDS) {
      if (key in payload) {
        throw new ClinicalError("gold metadata leaked into participant view", {
          code: "gold_leak_detected",
          details: { fields: [key], where },
        });
      }
    }
  }
}
