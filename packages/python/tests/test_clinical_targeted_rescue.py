from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from examples.demos.mai_clinical_mimo_benchmark import _is_match  # noqa: E402
from examples.demos.mai_clinical_targeted_rescue import (  # noqa: E402
    build_evidence_packet,
    build_retrieval_queries,
    build_targeted_query,
    classify_specialist_domains,
)
from handoffkit.benchmarks.mai import build_sequential_doctor_cases  # noqa: E402


def test_classify_specialist_domains_detects_pathology() -> None:
    case = build_sequential_doctor_cases(1)[0]
    row = {
        "prediction": "renal cell carcinoma",
        "final_prediction": "renal cell carcinoma",
    }

    domains = classify_specialist_domains(case, row, max_domains=2)

    assert domains
    assert "tumor_pathology" in domains


def test_build_targeted_query_avoids_title_and_gold_label() -> None:
    case = build_sequential_doctor_cases(1)[0]
    row = {"prediction": "inflammatory syndrome", "final_prediction": "inflammatory syndrome"}

    query = build_targeted_query(case, row, "tumor_pathology").lower()

    assert query
    assert case.case.title.lower() not in query
    assert case.case.final_diagnosis.lower() not in query


def test_build_retrieval_queries_returns_multiple_queries_without_gold() -> None:
    case = build_sequential_doctor_cases(1)[0]
    row = {"prediction": "renal cell carcinoma", "final_prediction": "renal cell carcinoma"}

    queries = build_retrieval_queries(case, row, "tumor_pathology", max_queries=5)

    assert 3 <= len(queries) <= 5
    assert all(case.case.final_diagnosis.lower() not in query.lower() for query in queries)


def test_pathology_first_router_moves_pathology_domain_first() -> None:
    case = build_sequential_doctor_cases(1)[0]
    row = {"prediction": "fever with carcinoma biopsy", "final_prediction": "infection"}

    domains = classify_specialist_domains(case, row, max_domains=2, pathology_first=True)

    assert domains[0] == "tumor_pathology"


def test_build_evidence_packet_is_compact_and_structured() -> None:
    case = build_sequential_doctor_cases(1)[0]
    row = {"prediction": "renal cell carcinoma", "final_prediction": "renal cell carcinoma"}
    retrieval = {
        "queries": ["renal carcinoma pathology case report", "biopsy staining case report"],
        "sources": {
            "pubmed": [
                {
                    "query": "renal carcinoma pathology case report",
                    "results": [
                        {
                            "title": "Rare tumor pathology",
                            "journal": "Journal",
                            "abstract": "A compact abstract.",
                            "url": "https://example.test/article",
                        }
                    ],
                }
            ]
        },
    }

    packet = build_evidence_packet(case, row, "tumor_pathology", retrieval)

    assert packet["domain"] == "tumor_pathology"
    assert packet["retrieval_sources"][0]["source"] == "pubmed"
    assert packet["queries"][0] == "renal carcinoma pathology case report"
    assert "histology" in packet["hypothesis_to_test"]


def test_curated_clinical_alias_matches_iga_dominant_mpgn() -> None:
    assert _is_match(
        "Membranoproliferative glomerulonephritis type I",
        "IgA-dominant MPGN",
        [],
    )
