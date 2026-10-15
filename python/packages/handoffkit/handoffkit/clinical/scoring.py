"""Regression scoring only. Coverage/calibration never vote on correctness.

Independent semantic judges are required for `correct=true`. They are not
shipped in 1.20; missing judges fail closed. `clinical_validity` stays null.
exact_match and alias_match are regression metrics, not clinical accuracy.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.gold import GoldVault
from handoffkit.clinical.models import ClinicalRun, ClinicalScore

JudgeFn = Callable[[ClinicalRun], int]


def _normalize(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def alias_match(predicted: str, gold: str, aliases: list[str] | None = None) -> bool:
    pred = _normalize(predicted)
    gold_n = _normalize(gold)
    if not pred or not gold_n:
        return False
    if pred == gold_n:
        return True
    return any(_normalize(alias) and _normalize(alias) == pred for alias in aliases or [])


def _regression_flags(predicted: str, gold_doc: dict[str, Any]) -> tuple[bool, bool]:
    gold = str(gold_doc.get("final_diagnosis") or "")
    aliases = gold_doc.get("aliases")
    alias_list = list(aliases) if isinstance(aliases, list) else []
    exact = _normalize(predicted) == _normalize(gold) and bool(predicted.strip())
    aliased = alias_match(predicted, gold, alias_list)
    return exact, aliased


def score_run(
    run: ClinicalRun,
    judges: list[JudgeFn] | None = None,
    *,
    gold: dict[str, Any] | None = None,
    vault: GoldVault | None = None,
) -> ClinicalScore:
    gold_doc = dict(gold or {})
    if vault is not None:
        gold_doc = vault.get(run.run_id) or gold_doc
    exact, aliased = _regression_flags(run.diagnosis, gold_doc)

    if run.replay:
        return ClinicalScore(
            {
                "correct": False,
                "judge_scores": [],
                "alias_match": aliased,
                "exact_match": exact,
                "complete": True,
                "quorum": 0,
                "heuristic_only": True,
                "scoring_mode": "gold_replay",
            }
        )
    if not run.scoring_eligible:
        return ClinicalScore(
            {
                "correct": False,
                "judge_scores": [],
                "alias_match": aliased,
                "exact_match": exact,
                "complete": True,
                "quorum": 0,
                "heuristic_only": True,
                "scoring_mode": "ineligible",
            }
        )
    if judges is None:
        return ClinicalScore(
            {
                "correct": False,
                "judge_scores": [],
                "alias_match": aliased,
                "exact_match": exact,
                "complete": True,
                "quorum": 0,
                "heuristic_only": True,
                "scoring_mode": "heuristic_regression",
            }
        )

    scores: list[int] = []
    for judge in judges:
        try:
            scores.append(int(judge(run)))
        except Exception:
            return ClinicalScore(
                {
                    "correct": False,
                    "judge_scores": scores,
                    "alias_match": aliased,
                    "exact_match": exact,
                    "complete": False,
                    "quorum": len(scores),
                    "heuristic_only": False,
                    "scoring_mode": "independent_judges",
                }
            )
    if len(scores) < 3:
        return ClinicalScore(
            {
                "correct": False,
                "judge_scores": scores,
                "alias_match": aliased,
                "exact_match": exact,
                "complete": False,
                "quorum": len(scores),
                "heuristic_only": False,
                "scoring_mode": "independent_judges",
            }
        )
    voted = sum(1 for item in scores if item >= 4) >= 2
    return ClinicalScore(
        {
            "correct": bool(voted),
            "judge_scores": scores[:3],
            "alias_match": aliased,
            "exact_match": exact,
            "complete": True,
            "quorum": 3,
            "heuristic_only": False,
            "scoring_mode": "independent_judges",
        }
    )


def require_official_complete(results: list[dict[str, Any]], expected: int = 897) -> None:
    if len(results) != expected:
        raise ClinicalError(
            f"official run requires exactly {expected} results",
            code="run_incomplete",
            details={"count": len(results), "expected": expected},
        )
    incomplete = [item for item in results if item.get("status") != "complete"]
    if incomplete:
        raise ClinicalError(
            "official run contains incomplete cases",
            code="run_incomplete",
            details={"incomplete": len(incomplete)},
        )
    missing_quorum = []
    for item in results:
        score = item.get("score") or {}
        if int(score.get("quorum") or 0) < 3:
            missing_quorum.append(item)
        if score.get("heuristic_only"):
            missing_quorum.append(item)
        if score.get("scoring_mode") != "independent_judges":
            missing_quorum.append(item)
        if score.get("clinical_validity") is not None:
            raise ClinicalError(
                "clinical validity claims cannot be published",
                code="run_incomplete",
            )
    if missing_quorum:
        raise ClinicalError(
            "official run missing three independent judges",
            code="judge_quorum_missing",
            details={"count": len(missing_quorum)},
        )
