"""Refuse to publish incomplete or contaminated clinical reports."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from handoffkit.clinical.constants import OFFICIAL_CASE_COUNT, STATUS_PUBLIC
from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.scoring import require_official_complete


def audit_report(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("mode") in {"gold_replay", "mai_style_gold_replay"}:
        raise ClinicalError(
            "gold_replay reports are not publishable accuracy",
            code="run_incomplete",
            details={"mode": payload.get("mode")},
        )
    if payload.get("accuracy") in {1, "1.0", "100%"}:
        raise ClinicalError(
            "100% accuracy claims are not publishable from this lab",
            code="run_incomplete",
        )
    results = list(payload.get("results") or payload.get("rows") or [])
    if payload.get("official"):
        require_official_complete(results, expected=OFFICIAL_CASE_COUNT)
        tracks = {item.get("track") for item in results}
        if len(tracks) > 1:
            raise ClinicalError(
                "closed and retrieval tracks must not be mixed",
                code="run_incomplete",
            )
    leaks = [
        item
        for item in results
        if (item.get("error") or {}).get("code") == "gold_leak_detected"
    ]
    if leaks:
        raise ClinicalError(
            "contaminated traces cannot be published",
            code="gold_leak_detected",
            details={"count": len(leaks)},
        )
    return {
        "ok": True,
        "count": len(results),
        "status_public": STATUS_PUBLIC,
        "clinical_validity": None,
    }


def audit_path(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return audit_report(data)
