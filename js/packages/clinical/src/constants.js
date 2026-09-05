export const HANDOFFKIT_CLINICAL_VERSION = "1.20.0-alpha.2";
export const CONTRACT_VERSION = HANDOFFKIT_CLINICAL_VERSION;
export const CONTRACT_FORMAT = "handoffkit.clinical.v1beta";
export const OFFICIAL_CASE_COUNT = 897;
export const STATUS_PUBLIC =
  "experimental / research and education only / not clinically validated";
export const DATASET_NAME = "zou-lab/MedCaseReasoning";
export const DATASET_URL = "https://huggingface.co/datasets/zou-lab/MedCaseReasoning";
export const DATASET_PAPER = "https://arxiv.org/abs/2505.11733";
export const DATASET_REVISION_PIN = "";
export const OFFICIAL_CORPUS_STATUS = "unavailable";
export const EXPERIENCES = Object.freeze(["research", "professional", "public"]);
export const TRACKS = Object.freeze(["closed_sequential", "retrieval_assisted"]);
export const ACTIONS = Object.freeze(["ask_question", "request_test", "submit_diagnosis"]);
export const STATUSES = Object.freeze(["running", "complete", "incomplete", "failed"]);
export const SCORING_MODES = Object.freeze([
  "heuristic_regression",
  "independent_judges",
  "ineligible",
  "gold_replay",
]);
export const PHASES = Object.freeze([
  "opening",
  "deliberate",
  "ask_question",
  "request_test",
  "gatekeeper",
  "cost",
  "update_differential",
  "submit_diagnosis",
  "score",
  "closed",
]);
export const ROLES = Object.freeze([
  "hypothesis",
  "test_selector",
  "challenger",
  "evidence_steward",
  "finalizer",
]);
export const ERROR_CODES = Object.freeze([
  "evidence_not_available",
  "invalid_transition",
  "budget_exceeded",
  "gold_leak_detected",
  "provider_unavailable",
  "judge_quorum_missing",
  "retrieval_blocked",
  "run_incomplete",
  "invalid_request",
  "personal_input_rejected",
  "idempotency_conflict",
  "revision_conflict",
  "store_corrupt",
  "checkpoint_missing",
]);
export const MAX_USER_TEXT = 2000;
export const MAX_BODY_BYTES = 65536;
export const MAX_RUN_ID_LEN = 80;
export const ALLOWED_CREATE_KEYS = Object.freeze([
  "experience",
  "track",
  "blind_id",
  "locale",
  "replay",
  "fixture_id",
  "expected_revision",
]);
export const ALLOWED_ACT_KEYS = Object.freeze([
  "name",
  "query",
  "url",
  "action_id",
  "idempotency_key",
  "role",
  "expected_revision",
]);
export const GOLD_FIELDS = Object.freeze([
  "final_diagnosis",
  "aliases",
  "diagnostic_reasoning",
  "title",
  "pmcid",
  "article_link",
]);
export const CAPABILITIES = Object.freeze({
  deterministic_sandbox: "experimental",
  clinical_validity: "unavailable",
  official_897_run: "unavailable",
  live_providers: "unavailable",
  retrieval_live: "unavailable",
  postgresql: "planned",
  durable_recovery: "experimental",
  independent_judges: "unavailable",
  official_corpus: "unavailable",
});
export const PROVIDER_STATUS = Object.freeze({
  ollama: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
  nvidia: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
  groq: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
  opencode: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
});
export const RESOURCE_UNITS_V1 = Object.freeze({
  ask_question: 1,
  request_test: 3,
  submit_diagnosis: 0,
  history: 1,
  physical_exam: 1,
  basic_labs: 3,
  imaging: 8,
  pathology: 12,
  special_tests: 10,
});
export const VAGUE_MARKERS = Object.freeze([
  "everything",
  "full case",
  "whole case",
  "tell me all",
  "complete case",
  "entire case",
  "dump the case",
]);
export const MOJIBAKE_MARKERS = Object.freeze(["â€", "Ã±", "Ã©", "Ã³", "Â", "â€™", "â€œ"]);
export const MEDICAL_HOST_ALLOW = Object.freeze([
  "nih.gov",
  "nlm.nih.gov",
  "cdc.gov",
  "who.int",
  "nejm.org",
  "jamanetwork.com",
  "thelancet.com",
  "bmj.com",
  "nature.com",
  "sciencedirect.com",
  "pubmed.ncbi.nlm.nih.gov",
]);
