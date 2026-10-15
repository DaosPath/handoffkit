"""I/O-free clinical v1beta wire models. Canonical JSON is snake_case."""

from __future__ import annotations

from typing import Any

from handoffkit.clinical.constants import (
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
)
from handoffkit.clinical.errors import ClinicalError


def _text(value: Any, fallback: str = "") -> str:
    return fallback if value is None else str(value)


def _obj(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


class ClinicalErrorModel:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.code = _text(data.get("code"))
        if self.code and self.code not in ERROR_CODES:
            raise ClinicalError("unknown clinical error code", code="invalid_request")
        self.message = _text(data.get("message"))
        self.details = _obj(data.get("details"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": dict(self.details),
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> ClinicalErrorModel:
        return cls(data)


class ClinicalAction:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.action_id = _text(data.get("action_id"))
        self.name = _text(data.get("name"))
        if self.name not in ACTIONS:
            raise ClinicalError(
                f"unsupported action {self.name}",
                code="invalid_transition",
            )
        self.query = _text(data.get("query"))
        self.idempotency_key = _text(data.get("idempotency_key") or self.action_id)
        self.role = _text(data.get("role"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "name": self.name,
            "query": self.query,
            "idempotency_key": self.idempotency_key,
            "role": self.role,
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> ClinicalAction:
        return cls(data)


class ClinicalObservation:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.observation_id = _text(data.get("observation_id"))
        self.action_id = _text(data.get("action_id"))
        self.section = _text(data.get("section"))
        self.content = _text(data.get("content"))
        self.code = _text(data.get("code"))
        self.source_hash = _text(data.get("source_hash"))
        self.source_fragment = _text(data.get("source_fragment"))
        self.resource_units = int(data.get("resource_units") or 0)

    def to_wire(self) -> dict[str, Any]:
        return {
            "observation_id": self.observation_id,
            "action_id": self.action_id,
            "section": self.section,
            "content": self.content,
            "code": self.code,
            "source_hash": self.source_hash,
            "source_fragment": self.source_fragment,
            "resource_units": self.resource_units,
        }

    to_dict = to_wire


class DifferentialItem:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.label = _text(data.get("label"))
        self.percent = int(data.get("percent") or 0)
        self.support = _text(data.get("support"))
        self.against = _text(data.get("against"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "percent": self.percent,
            "support": self.support,
            "against": self.against,
        }

    to_dict = to_wire


class ClinicalScore:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.correct = bool(data.get("correct"))
        self.judge_scores = [int(item) for item in _list(data.get("judge_scores"))]
        self.alias_match = bool(data.get("alias_match"))
        self.exact_match = bool(data.get("exact_match"))
        self.complete = bool(data.get("complete"))
        self.quorum = int(data.get("quorum") or 0)
        self.heuristic_only = bool(data.get("heuristic_only", True))
        mode = _text(data.get("scoring_mode"), "heuristic_regression")
        if mode not in SCORING_MODES:
            raise ClinicalError("unknown scoring mode", code="invalid_request")
        self.scoring_mode = mode

    def to_wire(self) -> dict[str, Any]:
        return {
            "correct": self.correct,
            "judge_scores": list(self.judge_scores),
            "alias_match": self.alias_match,
            "exact_match": self.exact_match,
            "complete": self.complete,
            "quorum": self.quorum,
            "clinical_validity": None,
            "heuristic_only": self.heuristic_only,
            "scoring_mode": self.scoring_mode,
        }

    to_dict = to_wire


class ClinicalRun:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.run_id = _text(data.get("run_id"))
        self.experience = _text(data.get("experience"), "professional")
        if self.experience not in EXPERIENCES:
            raise ClinicalError("unknown experience", code="invalid_request")
        self.track = _text(data.get("track"), "closed_sequential")
        if self.track not in TRACKS:
            raise ClinicalError("unknown track", code="invalid_request")
        self.phase = _text(data.get("phase"), "opening")
        if self.phase not in PHASES:
            raise ClinicalError("unknown phase", code="invalid_transition")
        self.status = _text(data.get("status"), "running")
        if self.status not in STATUSES:
            raise ClinicalError("unknown status", code="invalid_request")
        self.blind_id = _text(data.get("blind_id"))
        self.opening = _text(data.get("opening"))
        self.actions = [ClinicalAction(_obj(item)) for item in _list(data.get("actions"))]
        self.observations = [
            ClinicalObservation(_obj(item)) for item in _list(data.get("observations"))
        ]
        self.differential = [
            DifferentialItem(_obj(item)) for item in _list(data.get("differential"))
        ]
        self.budget_units = int(data.get("budget_units") or 40)
        self.spent_units = int(data.get("spent_units") or 0)
        self.max_rounds = int(data.get("max_rounds") or 12)
        self.rounds = int(data.get("rounds") or 0)
        self.diagnosis = _text(data.get("diagnosis"))
        self.score = ClinicalScore(_obj(data.get("score"))) if data.get("score") else None
        self.error = ClinicalErrorModel(_obj(data.get("error"))) if data.get("error") else None
        self.replay = bool(data.get("replay"))
        self.scoring_eligible = bool(data.get("scoring_eligible"))
        self.status_public = _text(data.get("status_public"), STATUS_PUBLIC)
        self.locale = _text(data.get("locale"), "en")
        self.evidence = _obj(data.get("evidence"))
        self.revision = int(data.get("revision") or 0)
        self.source = _text(data.get("source"), "live_sandbox")
        self.fixture_id = _text(data.get("fixture_id"))
        sealed = _obj(data.get("sealed"))
        for key in GOLD_FIELDS:
            sealed.pop(key, None)
        if "sections" in sealed and "sections" not in self.evidence:
            self.evidence["sections"] = _obj(sealed.pop("sections"))
        else:
            sealed.pop("sections", None)
        self.sealed = sealed

    def to_wire(self, *, include_sealed: bool = False) -> dict[str, Any]:
        payload = {
            "contract_version": self.contract_version,
            "run_id": self.run_id,
            "experience": self.experience,
            "track": self.track,
            "phase": self.phase,
            "status": self.status,
            "blind_id": self.blind_id,
            "opening": self.opening,
            "actions": [item.to_wire() for item in self.actions],
            "observations": [item.to_wire() for item in self.observations],
            "differential": [item.to_wire() for item in self.differential],
            "budget_units": self.budget_units,
            "spent_units": self.spent_units,
            "max_rounds": self.max_rounds,
            "rounds": self.rounds,
            "diagnosis": self.diagnosis,
            "score": self.score.to_wire() if self.score else None,
            "error": self.error.to_wire() if self.error else None,
            "replay": self.replay,
            "scoring_eligible": self.scoring_eligible,
            "status_public": self.status_public,
            "locale": self.locale,
            "evidence": dict(self.evidence),
            "revision": self.revision,
            "source": self.source,
            "fixture_id": self.fixture_id,
        }
        if include_sealed:
            payload["sealed"] = dict(self.sealed)
        return payload

    to_dict = to_wire
