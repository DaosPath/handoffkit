"""Clinical Sequential Reasoning Lab (experimental, not clinically validated)."""

from __future__ import annotations

CONTRACT_VERSION = "1.20.0-v1beta"
CONTRACT_FORMAT = "handoffkit.clinical.v1beta"
HANDOFFKIT_CLINICAL_VERSION = CONTRACT_VERSION
OFFICIAL_CASE_COUNT = 897
STATUS_PUBLIC = (
    "experimental / research and education only / not clinically validated"
)
DATASET_NAME = "zou-lab/MedCaseReasoning"
DATASET_URL = "https://huggingface.co/datasets/zou-lab/MedCaseReasoning"
DATASET_PAPER = "https://arxiv.org/abs/2505.11733"
# Empty on purpose: "main" is not an immutable pin. Official corpus stays unavailable
# until a real commit SHA is confirmed. Do not invent a hash.
DATASET_REVISION_PIN = ""
OFFICIAL_CORPUS_STATUS = "unavailable"
EXPERIENCES = ("research", "professional", "public")
TRACKS = ("closed_sequential", "retrieval_assisted")
ACTIONS = ("ask_question", "request_test", "submit_diagnosis")
STATUSES = ("running", "complete", "incomplete", "failed")
SCORING_MODES = (
    "heuristic_regression",
    "independent_judges",
    "ineligible",
    "gold_replay",
)
PHASES = (
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
)
ROLES = (
    "hypothesis",
    "test_selector",
    "challenger",
    "evidence_steward",
    "finalizer",
)
ERROR_CODES = (
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
)
MAX_USER_TEXT = 2000
MAX_BODY_BYTES = 65536
MAX_RUN_ID_LEN = 80
ALLOWED_CREATE_KEYS = frozenset(
    {
        "experience",
        "track",
        "blind_id",
        "locale",
        "replay",
        "fixture_id",
        "expected_revision",
    }
)
ALLOWED_ACT_KEYS = frozenset(
    {
        "name",
        "query",
        "url",
        "action_id",
        "idempotency_key",
        "role",
        "expected_revision",
    }
)
GOLD_FIELDS = (
    "final_diagnosis",
    "aliases",
    "diagnostic_reasoning",
    "title",
    "pmcid",
    "article_link",
)
CAPABILITIES = {
    "deterministic_sandbox": "experimental",
    "clinical_validity": "unavailable",
    "official_897_run": "unavailable",
    "live_providers": "unavailable",
    "retrieval_live": "unavailable",
    "postgresql": "planned",
    "durable_recovery": "experimental",
    "independent_judges": "unavailable",
    "official_corpus": "unavailable",
}
PROVIDER_STATUS = {
    "ollama": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
    "nvidia": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
    "groq": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
    "opencode": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
}
QUALITY_FLAGS = (
    "insufficient_evidence",
    "image_required",
    "ambiguity",
    "duplicate",
    "possible_contamination",
)
RESOURCE_UNITS_V1 = {
    "ask_question": 1,
    "request_test": 3,
    "submit_diagnosis": 0,
    "history": 1,
    "physical_exam": 1,
    "basic_labs": 3,
    "imaging": 8,
    "pathology": 12,
    "special_tests": 10,
}
VAGUE_MARKERS = (
    "everything",
    "full case",
    "whole case",
    "tell me all",
    "complete case",
    "entire case",
    "dump the case",
)
MOJIBAKE_MARKERS = ("â€", "Ã±", "Ã©", "Ã³", "Â", "â€™", "â€œ")
