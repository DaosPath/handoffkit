from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from examples.mai_clinical_ensemble_benchmark import (  # noqa: E402
    EnsembleCandidate,
    build_retrieval_query,
    choose_vote_winner,
    labels_equivalent,
)
from handoffkit.benchmarks.mai import build_sequential_doctor_cases  # noqa: E402


def test_labels_equivalent_uses_clinical_aliases() -> None:
    assert labels_equivalent("primary hyperaldosteronism", "primary aldosteronism")


def test_choose_vote_winner_prefers_two_model_agreement() -> None:
    winner, metadata = choose_vote_winner(
        [
            EnsembleCandidate("mimo", "primary aldosteronism", "medium", [], []),
            EnsembleCandidate("deepseek", "primary hyperaldosteronism", "high", [], []),
            EnsembleCandidate("glm", "renal artery stenosis", "low", [], []),
        ]
    )

    assert winner == "primary aldosteronism"
    assert metadata["strategy"] == "majority_vote"
    assert metadata["vote_count"] == 2


def test_build_retrieval_query_avoids_title_and_gold_label() -> None:
    case = build_sequential_doctor_cases(1)[0]
    row = {"prediction": "inflammatory syndrome"}

    query = build_retrieval_query(case, row).lower()

    assert query
    assert case.case.title.lower() not in query
    assert case.case.final_diagnosis.lower() not in query
