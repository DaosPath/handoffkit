import {
  ACTIONS,
  CONTRACT_VERSION,
  ERROR_CODES,
  EXPERIENCES,
  GOLD_FIELDS,
  PHASES,
  SCORING_MODES,
  STATUS_PUBLIC,
  STATUSES,
  TRACKS,
} from "./constants.js";
import { ClinicalError, asList, asObject, asText, requireOneOf } from "./wire.js";

export class ClinicalErrorModel {
  constructor(data) {
    const payload = asObject(data);
    this.code = asText(payload.code);
    if (this.code && !ERROR_CODES.includes(this.code)) {
      throw new ClinicalError("unknown clinical error code", { code: "invalid_request" });
    }
    this.message = asText(payload.message);
    this.details = asObject(payload.details);
  }

  toWire() {
    return { code: this.code, message: this.message, details: { ...this.details } };
  }
}

export class ClinicalAction {
  constructor(data) {
    const payload = asObject(data);
    this.action_id = asText(payload.action_id);
    this.name = asText(payload.name);
    if (!ACTIONS.includes(this.name)) {
      throw new ClinicalError(`unsupported action ${this.name}`, { code: "invalid_transition" });
    }
    this.query = asText(payload.query);
    this.idempotency_key = asText(payload.idempotency_key || this.action_id);
    this.role = asText(payload.role);
  }

  toWire() {
    return {
      action_id: this.action_id,
      name: this.name,
      query: this.query,
      idempotency_key: this.idempotency_key,
      role: this.role,
    };
  }
}

export class ClinicalObservation {
  constructor(data) {
    const payload = asObject(data);
    this.observation_id = asText(payload.observation_id);
    this.action_id = asText(payload.action_id);
    this.section = asText(payload.section);
    this.content = asText(payload.content);
    this.code = asText(payload.code);
    this.source_hash = asText(payload.source_hash);
    this.source_fragment = asText(payload.source_fragment);
    this.resource_units = Number(payload.resource_units || 0);
  }

  toWire() {
    return {
      observation_id: this.observation_id,
      action_id: this.action_id,
      section: this.section,
      content: this.content,
      code: this.code,
      source_hash: this.source_hash,
      source_fragment: this.source_fragment,
      resource_units: this.resource_units,
    };
  }
}

export class DifferentialItem {
  constructor(data) {
    const payload = asObject(data);
    this.label = asText(payload.label);
    this.percent = Number(payload.percent || 0);
    this.support = asText(payload.support);
    this.against = asText(payload.against);
  }

  toWire() {
    return {
      label: this.label,
      percent: this.percent,
      support: this.support,
      against: this.against,
    };
  }
}

export class ClinicalScore {
  constructor(data) {
    const payload = asObject(data);
    this.correct = Boolean(payload.correct);
    this.judge_scores = asList(payload.judge_scores).map((item) => Number(item));
    this.alias_match = Boolean(payload.alias_match);
    this.exact_match = Boolean(payload.exact_match);
    this.complete = Boolean(payload.complete);
    this.quorum = Number(payload.quorum || 0);
    this.heuristic_only = payload.heuristic_only !== false;
    this.scoring_mode = asText(payload.scoring_mode, "heuristic_regression");
    if (!SCORING_MODES.includes(this.scoring_mode)) {
      throw new ClinicalError("unknown scoring mode", { code: "invalid_request" });
    }
  }

  toWire() {
    return {
      correct: this.correct,
      judge_scores: [...this.judge_scores],
      alias_match: this.alias_match,
      exact_match: this.exact_match,
      complete: this.complete,
      quorum: this.quorum,
      clinical_validity: null,
      heuristic_only: this.heuristic_only,
      scoring_mode: this.scoring_mode,
    };
  }
}

export class ClinicalRun {
  constructor(data) {
    const payload = asObject(data);
    this.contract_version = asText(payload.contract_version, CONTRACT_VERSION);
    this.run_id = asText(payload.run_id);
    this.experience = requireOneOf(payload.experience || "professional", EXPERIENCES, "experience");
    this.track = requireOneOf(payload.track || "closed_sequential", TRACKS, "track");
    this.phase = requireOneOf(payload.phase || "opening", PHASES, "phase");
    this.status = asText(payload.status, "running");
    if (!STATUSES.includes(this.status)) {
      throw new ClinicalError("unknown status", { code: "invalid_request" });
    }
    this.blind_id = asText(payload.blind_id);
    this.opening = asText(payload.opening);
    this.actions = asList(payload.actions).map((item) => new ClinicalAction(item));
    this.observations = asList(payload.observations).map((item) => new ClinicalObservation(item));
    this.differential = asList(payload.differential).map((item) => new DifferentialItem(item));
    this.budget_units = Number(payload.budget_units || 40);
    this.spent_units = Number(payload.spent_units || 0);
    this.max_rounds = Number(payload.max_rounds || 12);
    this.rounds = Number(payload.rounds || 0);
    this.diagnosis = asText(payload.diagnosis);
    this.score = payload.score ? new ClinicalScore(payload.score) : null;
    this.error = payload.error ? new ClinicalErrorModel(payload.error) : null;
    this.replay = Boolean(payload.replay);
    this.scoring_eligible = Boolean(payload.scoring_eligible);
    this.status_public = asText(payload.status_public, STATUS_PUBLIC);
    this.locale = asText(payload.locale, "en");
    this.evidence = asObject(payload.evidence);
    this.revision = Number(payload.revision || 0);
    this.source = asText(payload.source, "live_sandbox");
    this.fixture_id = asText(payload.fixture_id);
    const sealed = asObject(payload.sealed);
    for (const key of GOLD_FIELDS) delete sealed[key];
    if (sealed.sections && !this.evidence.sections) {
      this.evidence.sections = asObject(sealed.sections);
    }
    delete sealed.sections;
    this.sealed = sealed;
  }

  toWire(options = {}) {
    const payload = {
      contract_version: this.contract_version,
      run_id: this.run_id,
      experience: this.experience,
      track: this.track,
      phase: this.phase,
      status: this.status,
      blind_id: this.blind_id,
      opening: this.opening,
      actions: this.actions.map((item) => item.toWire()),
      observations: this.observations.map((item) => item.toWire()),
      differential: this.differential.map((item) => item.toWire()),
      budget_units: this.budget_units,
      spent_units: this.spent_units,
      max_rounds: this.max_rounds,
      rounds: this.rounds,
      diagnosis: this.diagnosis,
      score: this.score ? this.score.toWire() : null,
      error: this.error ? this.error.toWire() : null,
      replay: this.replay,
      scoring_eligible: this.scoring_eligible,
      status_public: this.status_public,
      locale: this.locale,
      evidence: { ...this.evidence },
      revision: this.revision,
      source: this.source,
      fixture_id: this.fixture_id,
    };
    if (options.includeSealed) payload.sealed = { ...this.sealed };
    return payload;
  }
}
