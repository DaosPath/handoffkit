"""Public clinical lab engine. Canonical sequential diagnosis runtime."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any
from uuid import uuid4

from handoffkit.clinical.audit import audit_report
from handoffkit.clinical.constants import (
    CONTRACT_VERSION,
    OFFICIAL_CASE_COUNT,
    OFFICIAL_CORPUS_STATUS,
    STATUS_PUBLIC,
)
from handoffkit.clinical.corpus import load_fixture_cases, load_professional_cases
from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.gold import GoldVault, assert_no_gold_keys
from handoffkit.clinical.machine import apply_action, start_run
from handoffkit.clinical.models import ClinicalRun
from handoffkit.clinical.privacy import reject_act_payload, reject_create_payload
from handoffkit.clinical.retrieval import RETRIEVAL_TRACK_STATUS
from handoffkit.clinical.store import MemoryStore, RunStore, safe_run_id

_DATA = Path(__file__).resolve().parent / "data"
RECORDED_FIXTURE_ID = "clinical-recorded-run-v1"


def _catalog() -> dict[str, dict[str, Any]]:
    public = load_fixture_cases()
    professional = load_professional_cases()
    cases = {}
    for item in public.get("cases") or public:
        if isinstance(item, dict) and item.get("blind_id"):
            cases[item["blind_id"]] = {**item, "experience": "public"}
    for item in professional.get("cases") or professional:
        if isinstance(item, dict) and item.get("blind_id"):
            cases[item["blind_id"]] = {**item, "experience": "professional"}
    return cases


def load_recorded_fixture(fixture_id: str = RECORDED_FIXTURE_ID) -> ClinicalRun:
    if fixture_id != RECORDED_FIXTURE_ID:
        raise ClinicalError("unknown recorded fixture", code="invalid_request")
    path = _DATA / "recorded_run_v1.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["replay"] = True
    payload["source"] = "recorded_fixture"
    payload["fixture_id"] = RECORDED_FIXTURE_ID
    run = ClinicalRun(payload)
    assert_no_gold_keys(run.to_wire(), where="recorded_fixture")
    return run


class ClinicalLab:
    def __init__(self, store: MemoryStore | RunStore | None = None) -> None:
        self.store = store or MemoryStore()
        self.cases = _catalog()
        self.benchmarks: dict[str, dict[str, Any]] = {}
        self.vault = GoldVault()
        self._lock = threading.Lock()

    def manifests(self) -> list[dict[str, Any]]:
        public = [item for item in self.cases.values() if item["experience"] == "public"]
        professional = [
            item for item in self.cases.values() if item["experience"] == "professional"
        ]
        return [
            {
                "id": "public-simulated",
                "experience": "public",
                "count": len(public),
                "scoring_eligible": False,
                "personal_input": False,
                "status": "experimental",
            },
            {
                "id": "professional-sandbox",
                "experience": "professional",
                "count": len(professional),
                "scoring_eligible": True,
                "deidentified": True,
                "status": "experimental",
            },
            {
                "id": "medcase-reasoning-test",
                "experience": "research",
                "count": OFFICIAL_CASE_COUNT,
                "scoring_eligible": True,
                "available": False,
                "status": OFFICIAL_CORPUS_STATUS,
                "note": (
                    "Official 897-case corpus is unavailable until an immutable "
                    "commit pin and full-content checksum exist. It is not bundled."
                ),
            },
        ]

    def create_run(self, body: dict[str, Any]) -> ClinicalRun:
        reject_create_payload(body)
        if body.get("replay"):
            run = load_recorded_fixture(str(body.get("fixture_id") or RECORDED_FIXTURE_ID))
            self.store.save(run)
            return run
        experience = str(body.get("experience") or "professional")
        track = str(body.get("track") or "closed_sequential")
        if experience == "research":
            raise ClinicalError(
                "official 897-case corpus is unavailable",
                code="run_incomplete",
                details={"experience": "research", "status": "unavailable"},
            )
        if track == "retrieval_assisted":
            raise ClinicalError(
                "retrieval-assisted track is unavailable until Browser Real is connected",
                code="retrieval_blocked",
                details={"track_status": RETRIEVAL_TRACK_STATUS},
            )
        blind_id = str(body.get("blind_id") or "")
        case = self.cases.get(blind_id)
        if experience == "public":
            if not case or case.get("experience") != "public":
                raise ClinicalError(
                    "public explorer only accepts selectable simulated cases",
                    code="personal_input_rejected",
                )
        if not case:
            raise ClinicalError("unknown case", code="invalid_request")
        run = start_run(
            experience=experience,
            track=track,
            opening=str(case.get("opening") or ""),
            blind_id=blind_id,
            sealed=dict(case.get("sealed") or {}),
            locale=str(body.get("locale") or "en"),
            replay=False,
            scoring_eligible=experience == "professional",
            differential=list(case.get("differential") or []),
            vault=self.vault,
            source="live_sandbox",
        )
        wire = run.to_wire()
        assert_no_gold_keys(wire, where="create_run")
        self.store.save(run)
        return run

    def get_run(self, run_id: str) -> ClinicalRun:
        return self.store.load(safe_run_id(run_id))

    def act(self, run_id: str, body: dict[str, Any]) -> ClinicalRun:
        reject_act_payload(body)
        with self._lock:
            run = self.store.load(safe_run_id(run_id))
            expected = run.revision
            if "expected_revision" in body and int(body["expected_revision"]) != expected:
                raise ClinicalError("run revision conflict", code="revision_conflict")
            if run.track == "retrieval_assisted":
                raise ClinicalError(
                    "retrieval-assisted track is unavailable until Browser Real is connected",
                    code="retrieval_blocked",
                    details={"track_status": RETRIEVAL_TRACK_STATUS},
                )
            updated = apply_action(run, body, vault=self.vault)
            self.store.save(updated, expected_revision=expected)
            return updated

    def start_benchmark(self, body: dict[str, Any]) -> dict[str, Any]:
        official = bool(body.get("official"))
        if official:
            raise ClinicalError(
                "official 897/897 run is unavailable until the pinned corpus is built",
                code="run_incomplete",
                details={"expected": OFFICIAL_CASE_COUNT, "status": "unavailable"},
            )
        bench_id = f"bench-{uuid4().hex[:12]}"
        payload = {
            "id": bench_id,
            "official": False,
            "status": "incomplete",
            "contract_version": CONTRACT_VERSION,
            "status_public": STATUS_PUBLIC,
            "results": [],
        }
        self.benchmarks[bench_id] = payload
        return payload

    def get_benchmark(self, bench_id: str) -> dict[str, Any]:
        if bench_id not in self.benchmarks:
            raise ClinicalError("benchmark not found", code="invalid_request")
        return self.benchmarks[bench_id]

    def report(self, bench_id: str) -> dict[str, Any]:
        return audit_report(self.get_benchmark(bench_id))


_DEFAULT: ClinicalLab | None = None


def default_lab() -> ClinicalLab:
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = ClinicalLab()
    return _DEFAULT
