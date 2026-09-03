from __future__ import annotations

import json
from pathlib import Path

from handoffkit.browser.grounding_scorer import (
    live_grounding_oracle,
    run_fixture_grounding,
    score_live_grounding_run,
)

CORPUS = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "conformance"
    / "browser-grounding-fixture-v1.json"
)


def test_fixture_grounding_scorer() -> None:
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    metrics = run_fixture_grounding(corpus)
    assert metrics["scoreable"] == 30
    assert metrics["invented_citations"] == 0
    assert metrics["passed"] is True


def test_live_grounding_scorer_requires_page_evidence() -> None:
    corpus = {
        "source_policy": {
            "require_https": True,
            "allow_hosts": ["example.org"],
            "reject_fixture_hosts": ["fixture.handoffkit.test"],
        },
        "gates": {
            "min_scoreable": 2,
            "factual_accuracy": 1,
            "completeness": 1,
            "citation_entailment": 1,
            "direct_claims_with_evidence": 1,
            "invented_citations": 0,
        },
        "questions": [
            {
                "id": "q1",
                "page_id": "q1",
                "source_url": "https://example.org/a",
                "required_facts": ["Alpha"],
                "evidence_terms": ["Alpha", "is"],
                "expect": "supported",
            },
            {
                "id": "q2",
                "page_id": "q2",
                "source_url": "https://example.org/b",
                "required_facts": [],
                "negative_evidence": ["fictional"],
                "expect": "not_found",
            },
        ],
    }
    pages = [
        {
            "page_id": "q1",
            "success": True,
            "url": "https://example.org/a",
            "final_url": "https://example.org/a",
            "markdown": "Alpha is a live fact.",
            "sha256": "a" * 64,
            "hash_verified": True,
        },
        {
            "page_id": "q2",
            "success": True,
            "url": "https://example.org/b",
            "final_url": "https://example.org/b",
            "markdown": "The material is fictional.",
            "sha256": "b" * 64,
            "hash_verified": True,
        },
    ]
    answers = live_grounding_oracle(corpus, pages)
    metrics = score_live_grounding_run(corpus, answers, pages)
    assert metrics["passed"] is True
    assert metrics["model_accuracy_measured"] is False
    assert (
        score_live_grounding_run(
            corpus,
            answers,
            [{**page, "hash_verified": False} for page in pages],
        )["passed"]
        is False
    )
    missing_claims = {
        **answers,
        "q1": {**answers["q1"], "answer": "Alpha", "claims": [], "citations": []},
    }
    assert score_live_grounding_run(corpus, missing_claims, pages)["passed"] is False
    tampered = {
        **answers,
        "q1": {**answers["q1"], "claims": [{**answers["q1"]["claims"][0], "quote": "invented"}]},
    }
    assert score_live_grounding_run(corpus, tampered, pages)["passed"] is False
