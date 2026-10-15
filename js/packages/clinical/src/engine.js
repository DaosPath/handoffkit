import { createHash, randomUUID } from "node:crypto";
import { MEDICAL_HOST_ALLOW, RESOURCE_UNITS_V1, STATUS_PUBLIC, VAGUE_MARKERS } from "./constants.js";
import { ClinicalAction, ClinicalErrorModel, ClinicalObservation, ClinicalRun } from "./models.js";
import { ClinicalError } from "./wire.js";
import { GoldVault, goldLeakFields, splitSealed } from "./gold.js";
import { rejectActPayload, rejectCreatePayload } from "./privacy.js";
import { executeRole } from "./roles.js";
import { requireOfficialComplete, scoreRun } from "./scoring.js";
import { PROFESSIONAL_CASES, PUBLIC_CASES } from "./fixtures.js";
import { RECORDED_RUN, RECORDED_FIXTURE_ID } from "./recorded.js";

export { aliasMatch, requireOfficialComplete, scoreRun } from "./scoring.js";
export { GoldVault } from "./gold.js";
export { rejectActPayload, rejectCreatePayload, looksPersonal } from "./privacy.js";
export { executeRole, ROLE_STATUS } from "./roles.js";

export const DEFAULT_VAULT = new GoldVault();
export const RETRIEVAL_TRACK_STATUS = Object.freeze({
  declared: true,
  adapter: "scaffold",
  integrated: false,
  live_tested: false,
  available: false,
  browser_real: "disconnected",
});

function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function newId(prefix) {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function isVague(query) {
  const text = String(query || "").toLowerCase();
  return VAGUE_MARKERS.some((marker) => text.includes(marker));
}

export function unitsFor(action, section = "") {
  if (isVague(`${action.name} ${action.query}`)) return 0;
  if (section && RESOURCE_UNITS_V1[section] != null) return RESOURCE_UNITS_V1[section];
  return RESOURCE_UNITS_V1[action.name] ?? 1;
}

function sectionFor(action) {
  const query = `${action.name} ${action.query}`.toLowerCase();
  if (action.name === "submit_diagnosis") return "diagnosis_submission";
  const mapping = [
    ["pathology", ["pathology", "biopsy", "histology", "specimen"]],
    ["imaging", ["imaging", "ct", "mri", "ultrasound", "radiograph", "oct"]],
    ["basic_labs", ["lab", "serum", "blood", "creatinine", "count"]],
    ["special_tests", ["genetic", "antibody", "pcr", "serologic", "special"]],
    ["physical_exam", ["exam", "physical"]],
    ["history", ["history", "timeline", "onset"]],
  ];
  for (const [section, needles] of mapping) {
    if (needles.some((needle) => query.includes(needle))) return section;
  }
  return "";
}

export function respond(run, action, observationId) {
  const sections = run.evidence?.sections && typeof run.evidence.sections === "object"
    ? run.evidence.sections
    : run.sealed.sections && typeof run.sealed.sections === "object"
      ? run.sealed.sections
      : {};
  if (action.name === "submit_diagnosis") {
    return new ClinicalObservation({
      observation_id: observationId,
      action_id: action.action_id,
      section: "diagnosis_submission",
      content: "Diagnosis submitted.",
      resource_units: 0,
    });
  }
  if (isVague(`${action.name} ${action.query}`)) {
    return new ClinicalObservation({
      observation_id: observationId,
      action_id: action.action_id,
      section: "not_available",
      content: "evidence_not_available",
      code: "evidence_not_available",
      resource_units: 0,
    });
  }
  const section = sectionFor(action);
  const content = String(sections[section] || "");
  if (!section || !content.trim() || section === "full_case") {
    return new ClinicalObservation({
      observation_id: observationId,
      action_id: action.action_id,
      section: "not_available",
      content: "evidence_not_available",
      code: "evidence_not_available",
      resource_units: 0,
    });
  }
  return new ClinicalObservation({
    observation_id: observationId,
    action_id: action.action_id,
    section,
    content,
    source_hash: sha256Hex(content),
    source_fragment: content.slice(0, 240),
    resource_units: unitsFor(action, section),
  });
}

function collectPreclose(run) {
  const chunks = [run.opening];
  for (const action of run.actions) {
    if (action.name === "submit_diagnosis") continue;
    chunks.push(action.query);
  }
  for (const obs of run.observations) {
    chunks.push(obs.content);
    chunks.push(obs.source_fragment);
  }
  return chunks.join("\n").toLowerCase();
}

export function auditLeaks(run, vault = DEFAULT_VAULT) {
  if (run.phase === "score" || run.phase === "closed") return;
  const hay = collectPreclose(run);
  const leaked = goldLeakFields(hay, vault.get(run.run_id));
  if (leaked.length) {
    throw new ClinicalError("gold metadata leaked before close", {
      code: "gold_leak_detected",
      details: { fields: leaked },
    });
  }
}

export function startRun(init) {
  const scoringEligible = init.experience === "public" ? false : Boolean(init.scoring_eligible);
  const { evidence, gold, operational } = splitSealed(init.sealed || {});
  const run = new ClinicalRun({
    run_id: init.run_id || newId("run"),
    experience: init.experience,
    track: init.track,
    phase: "deliberate",
    status: "running",
    blind_id: init.blind_id,
    opening: init.opening,
    budget_units: init.budget_units ?? 40,
    max_rounds: init.max_rounds ?? 12,
    replay: Boolean(init.replay),
    scoring_eligible: scoringEligible,
    status_public: STATUS_PUBLIC,
    locale: init.locale || "en",
    sealed: operational,
    evidence,
    differential: init.differential || [],
    source: init.replay ? "recorded_fixture" : (init.source || "live_sandbox"),
    fixture_id: init.fixture_id || "",
    revision: 0,
  });
  (init.vault || DEFAULT_VAULT).seal(run.run_id, gold);
  return run;
}

export function applyAction(run, raw, options = {}) {
  rejectActPayload(raw);
  if (run.phase === "closed") throw new ClinicalError("run is closed", { code: "invalid_transition" });
  if (raw.expected_revision != null && Number(raw.expected_revision) !== run.revision) {
    throw new ClinicalError("run revision conflict", { code: "revision_conflict" });
  }
  const action = new ClinicalAction(raw);
  if (action.role) executeRole(action.role, action.query);
  if (!action.action_id) {
    action.action_id = newId("act");
    if (!action.idempotency_key) action.idempotency_key = action.action_id;
  }
  const existing = run.actions.find((item) => item.idempotency_key === action.idempotency_key);
  if (existing) {
    if (existing.name !== action.name || existing.query !== action.query) {
      throw new ClinicalError("idempotency key reused with a different payload", {
        code: "idempotency_conflict",
      });
    }
    return run;
  }
  if (action.name === "submit_diagnosis" && run.diagnosis) {
    throw new ClinicalError("diagnosis already submitted", { code: "invalid_transition" });
  }
  if (run.rounds >= run.max_rounds && action.name !== "submit_diagnosis") {
    throw new ClinicalError("round limit reached", { code: "budget_exceeded" });
  }
  if (action.name === "ask_question" || action.name === "request_test") {
    if (run.phase !== "deliberate") {
      throw new ClinicalError(`expected deliberate, found ${run.phase}`, { code: "invalid_transition" });
    }
  } else if (action.name === "submit_diagnosis") {
    if (run.phase !== "deliberate" && run.phase !== "update_differential") {
      throw new ClinicalError("cannot submit now", { code: "invalid_transition" });
    }
  } else {
    throw new ClinicalError("unsupported action", { code: "invalid_transition" });
  }
  const observation = respond(run, action, newId("obs"));
  const spent = run.spent_units + Number(observation.resource_units);
  if (spent > run.budget_units) throw new ClinicalError("resource budget exceeded", { code: "budget_exceeded" });
  const vault = options.vault || DEFAULT_VAULT;
  let probe = collectPreclose(run);
  if (action.name !== "submit_diagnosis") probe = `${probe}\n${action.query}`;
  probe = `${probe}\n${observation.content}\n${observation.source_fragment}`;
  const leaked = goldLeakFields(probe, vault.get(run.run_id));
  if (leaked.length) {
    throw new ClinicalError("gold metadata leaked before close", {
      code: "gold_leak_detected",
      details: { fields: leaked },
    });
  }
  run.phase = action.name === "submit_diagnosis" ? "submit_diagnosis" : action.name;
  run.actions.push(action);
  run.phase = "cost";
  run.spent_units = spent;
  run.observations.push(observation);
  run.rounds += 1;
  run.revision += 1;
  if (action.name === "submit_diagnosis") {
    run.diagnosis = action.query;
    run.phase = "score";
    run.score = scoreRun(run, options.judges, { vault });
    run.phase = "closed";
    if (run.score?.complete) run.status = "complete";
    else {
      run.status = "incomplete";
      run.error = new ClinicalErrorModel({
        code: "judge_quorum_missing",
        message: "independent judges unavailable or incomplete",
      });
    }
  } else {
    run.phase = "deliberate";
  }
  run.sealed.usd_profile = null;
  return run;
}

function goldDoc(run, gold) {
  if (gold) return gold;
  return DEFAULT_VAULT.get(run.run_id);
}

export function assertRetrievalUrl(url, run, gold) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ClinicalError("retrieval_blocked", { code: "retrieval_blocked" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ClinicalError("retrieval_blocked", { code: "retrieval_blocked" });
  }
  const host = (parsed.hostname || "").toLowerCase();
  if (!host || ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) || host.endsWith(".local")) {
    throw new ClinicalError("localhost/private retrieval blocked", { code: "retrieval_blocked" });
  }
  if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172.")) {
    throw new ClinicalError("private network retrieval blocked", { code: "retrieval_blocked" });
  }
  if (!MEDICAL_HOST_ALLOW.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new ClinicalError("host not on medical allowlist", { code: "retrieval_blocked" });
  }
  const hay = `${url} ${host}`.toLowerCase();
  const doc = goldDoc(run, gold);
  for (const key of ["pmcid", "article_link", "title", "final_diagnosis"]) {
    const value = String(doc[key] || "").trim().toLowerCase();
    if (value && value.length >= 6 && hay.includes(value)) {
      throw new ClinicalError("source article blocked from retrieval", {
        code: "retrieval_blocked",
        details: { field: key },
      });
    }
  }
}

export function blockQuery(query, run, gold) {
  const hay = String(query || "").toLowerCase();
  const doc = goldDoc(run, gold);
  for (const key of ["pmcid", "title", "final_diagnosis", "article_link"]) {
    const value = String(doc[key] || "").trim().toLowerCase();
    if (value && value.length >= 8 && hay.includes(value)) {
      throw new ClinicalError("gold metadata in retrieval query", {
        code: "gold_leak_detected",
        details: { field: key },
      });
    }
  }
}

export function loadRecordedFixture(fixtureId = RECORDED_FIXTURE_ID) {
  if (fixtureId !== RECORDED_FIXTURE_ID) {
    throw new ClinicalError("unknown recorded fixture", { code: "invalid_request" });
  }
  return new ClinicalRun({
    ...RECORDED_RUN,
    replay: true,
    source: "recorded_fixture",
    fixture_id: RECORDED_FIXTURE_ID,
  });
}

function catalog() {
  const cases = {};
  for (const item of PUBLIC_CASES) cases[item.blind_id] = item;
  for (const item of PROFESSIONAL_CASES) cases[item.blind_id] = item;
  return cases;
}

export class ClinicalLab {
  constructor() {
    this.cases = catalog();
    this.vault = new GoldVault();
    this.runs = new Map();
    this.benchmarks = new Map();
  }

  createRun(body) {
    rejectCreatePayload(body);
    if (body.replay) {
      const run = loadRecordedFixture(String(body.fixture_id || RECORDED_FIXTURE_ID));
      this.runs.set(run.run_id, run);
      return run;
    }
    const experience = String(body.experience || "professional");
    const track = String(body.track || "closed_sequential");
    if (experience === "research") {
      throw new ClinicalError("official 897-case corpus is unavailable", {
        code: "run_incomplete",
        details: { experience: "research", status: "unavailable" },
      });
    }
    if (track === "retrieval_assisted") {
      throw new ClinicalError("retrieval-assisted track is unavailable until Browser Real is connected", {
        code: "retrieval_blocked",
        details: { track_status: RETRIEVAL_TRACK_STATUS },
      });
    }
    const found = this.cases[String(body.blind_id || "")];
    if (experience === "public" && (!found || found.experience !== "public")) {
      throw new ClinicalError("public explorer only accepts selectable simulated cases", {
        code: "personal_input_rejected",
      });
    }
    if (!found) throw new ClinicalError("unknown case", { code: "invalid_request" });
    const run = startRun({
      experience,
      track,
      opening: found.opening,
      blind_id: found.blind_id,
      sealed: found.sealed || {},
      locale: String(body.locale || "en"),
      replay: false,
      scoring_eligible: experience === "professional",
      differential: found.differential || [],
      vault: this.vault,
      source: "live_sandbox",
    });
    this.runs.set(run.run_id, run);
    return run;
  }

  act(runId, body) {
    rejectActPayload(body);
    const run = this.runs.get(runId);
    if (!run) throw new ClinicalError("run not found", { code: "invalid_request" });
    if (run.track === "retrieval_assisted") {
      throw new ClinicalError("retrieval-assisted track is unavailable until Browser Real is connected", {
        code: "retrieval_blocked",
        details: { track_status: RETRIEVAL_TRACK_STATUS },
      });
    }
    return applyAction(run, body, { vault: this.vault });
  }
}
