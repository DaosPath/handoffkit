"""Official MedCaseReasoning corpus builder. Never silently drops cases."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from handoffkit.clinical.constants import (
    DATASET_NAME,
    DATASET_REVISION_PIN,
    DATASET_URL,
    MOJIBAKE_MARKERS,
    OFFICIAL_CASE_COUNT,
    OFFICIAL_CORPUS_STATUS,
    QUALITY_FLAGS,
)
from handoffkit.clinical.errors import ClinicalError

_HERE = Path(__file__).resolve().parent
_DATA = _HERE / "data"


def repair_utf8(text: str) -> str:
    raw = str(text or "")
    try:
        repaired = raw.encode("latin-1").decode("utf-8")
        if any(marker in repaired for marker in MOJIBAKE_MARKERS):
            return raw
        return repaired
    except (UnicodeDecodeError, UnicodeEncodeError):
        return raw


def reject_mojibake(text: str, *, field: str) -> str:
    value = repair_utf8(text)
    leftover = [marker for marker in MOJIBAKE_MARKERS if marker in value]
    if leftover:
        raise ClinicalError(
            f"mojibake remains in {field}",
            code="invalid_request",
            details={"markers": leftover},
        )
    return value


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


IMMUTABLE_REVISION_RE = re.compile(r"^[0-9a-f]{40}$")


def is_immutable_revision(revision: str) -> bool:
    return bool(IMMUTABLE_REVISION_RE.fullmatch(str(revision or "").lower()))


def canonical_cases_checksum(cases: list[dict[str, Any]]) -> str:
    payload = json.dumps(cases, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return sha256_text(payload)


def quality_flags(row: dict[str, Any], *, seen_diagnoses: dict[str, int]) -> list[str]:
    flags: list[str] = []
    opening = str(row.get("pmcr_question") or row.get("opening") or "")
    reasoning = str(row.get("diagnostic_reasoning") or "")
    diagnosis = str(row.get("final_diagnosis") or "")
    if len(opening.strip()) < 40:
        flags.append("insufficient_evidence")
    if re.search(r"\b(figure|image|radiograph|oct|fundoscopy)\b", opening, re.I):
        flags.append("image_required")
    if " versus " in diagnosis.lower() or " vs " in diagnosis.lower():
        flags.append("ambiguity")
    key = " ".join(diagnosis.lower().split())
    if key:
        seen_diagnoses[key] = seen_diagnoses.get(key, 0) + 1
        if seen_diagnoses[key] > 1:
            flags.append("duplicate")
    if "pmc" in reasoning.lower() and diagnosis.lower() in opening.lower():
        flags.append("possible_contamination")
    return [flag for flag in flags if flag in QUALITY_FLAGS]


def row_to_case(row: dict[str, Any], index: int, seen: dict[str, int]) -> dict[str, Any]:
    pmcid = reject_mojibake(str(row.get("pmcid") or ""), field="pmcid")
    title = reject_mojibake(str(row.get("title") or ""), field="title")
    opening = reject_mojibake(
        str(row.get("pmcr_question") or row.get("opening") or ""),
        field="opening",
    )
    diagnosis = reject_mojibake(
        str(row.get("final_diagnosis") or ""),
        field="final_diagnosis",
    )
    reasoning = reject_mojibake(
        str(row.get("diagnostic_reasoning") or ""),
        field="diagnostic_reasoning",
    )
    article = str(row.get("article_link") or "")
    blind_id = f"mcr-{index:04d}-{sha256_text(pmcid or title or opening)[:10]}"
    sections = {
        "history": opening,
        "physical_exam": str(row.get("physical_exam") or ""),
        "basic_labs": str(row.get("basic_labs") or ""),
        "imaging": str(row.get("imaging") or ""),
        "pathology": str(row.get("pathology") or ""),
        "special_tests": str(row.get("special_tests") or ""),
    }
    return {
        "blind_id": blind_id,
        "index": index,
        "opening": opening,
        "quality_flags": quality_flags(row, seen_diagnoses=seen),
        "enrichment_status": "automatically sourced, not clinically validated",
        "sealed": {
            "title": title,
            "pmcid": pmcid,
            "article_link": article,
            "final_diagnosis": diagnosis,
            "diagnostic_reasoning": reasoning,
            "sections": sections,
        },
        "hashes": {
            "opening": sha256_text(opening),
            "diagnosis": sha256_text(diagnosis),
        },
    }


def build_manifest(
    rows: list[dict[str, Any]],
    *,
    revision: str = DATASET_REVISION_PIN,
    license_name: str = "dataset-license",
) -> dict[str, Any]:
    if not is_immutable_revision(revision):
        raise ClinicalError(
            "official corpus revision must be an immutable 40-character commit SHA",
            code="run_incomplete",
            details={"revision": revision or None, "status": OFFICIAL_CORPUS_STATUS},
        )
    if len(rows) != OFFICIAL_CASE_COUNT:
        raise ClinicalError(
            f"official corpus must contain exactly {OFFICIAL_CASE_COUNT} cases",
            code="run_incomplete",
            details={"count": len(rows)},
        )
    seen: dict[str, int] = {}
    cases = [row_to_case(row, index, seen) for index, row in enumerate(rows, start=1)]
    ids = [case["blind_id"] for case in cases]
    if len(set(ids)) != len(ids):
        raise ClinicalError("duplicate case ids", code="invalid_request")
    pmcids = [str((case.get("sealed") or {}).get("pmcid") or "") for case in cases]
    nonempty_pmc = [item for item in pmcids if item]
    if len(nonempty_pmc) != len(set(nonempty_pmc)):
        raise ClinicalError("duplicate pmcid values", code="invalid_request")
    return {
        "contract_version": "1.20.0-v1beta",
        "schema_version": "clinical-corpus-v1",
        "name": DATASET_NAME,
        "url": DATASET_URL,
        "revision": revision,
        "license": license_name,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "count": len(cases),
        "sha256": canonical_cases_checksum(cases),
        "cases": cases,
        "bundled": False,
        "status": "experimental",
        "status_public": "experimental / research and education only / not clinically validated",
    }


def official_corpus_status() -> dict[str, Any]:
    return {
        "available": False,
        "status": OFFICIAL_CORPUS_STATUS,
        "revision": DATASET_REVISION_PIN or None,
        "sha256": None,
        "count": OFFICIAL_CASE_COUNT,
        "note": "No confirmed immutable revision; hash is not invented.",
    }


def load_fixture_cases() -> dict[str, Any]:
    path = _DATA / "simulated_public_cases.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_professional_cases() -> dict[str, Any]:
    path = _DATA / "professional_sandbox_cases.json"
    return json.loads(path.read_text(encoding="utf-8"))


def download_official(*, revision: str = DATASET_REVISION_PIN) -> dict[str, Any]:
    if not is_immutable_revision(revision):
        raise ClinicalError(
            "official corpus is unavailable; revision pin is not an immutable commit SHA",
            code="run_incomplete",
            details={"status": OFFICIAL_CORPUS_STATUS},
        )
    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise ClinicalError(
            "huggingface datasets is required to build the official 897-case corpus",
            code="run_incomplete",
        ) from exc
    dataset = load_dataset(DATASET_NAME, split="test", revision=revision)
    rows = [dict(row) for row in dataset]
    return build_manifest(rows, revision=revision)
