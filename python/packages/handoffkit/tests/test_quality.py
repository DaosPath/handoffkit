"""Tests for deterministic handoff quality reports."""

from __future__ import annotations

import json

from handoffkit import HandoffQualityEvaluator, HandoffQualityMetric, HandoffState


def strong_state() -> HandoffState:
    """Return a high-quality handoff state."""
    return HandoffState(
        task="Build calculator",
        from_agent="Architect",
        to_agent="Coder",
        summary="Build a dependency-free calculator CLI with tests and clear error handling.",
        decisions=["Use argparse for CLI parsing.", "Keep operations pure."],
        important_files=["calculator.py", "test_calculator.py"],
        next_steps=["Implement calculator.py", "Write pytest coverage", "Run pytest -q"],
        context_refs=["README.md#real-task-demo"],
        metadata={"errors_checked": True},
    )


def test_quality_metric_serialization() -> None:
    metric = HandoffQualityMetric("clarity", 0.875, 1.0, ["ok"])

    assert metric.to_dict()["score"] == 0.875


def test_quality_evaluator_score_grade_and_recommendations() -> None:
    report = HandoffQualityEvaluator().evaluate(strong_state())

    assert report.success is True
    assert report.score >= 0.75
    assert report.grade in {"A", "B"}
    assert json.loads(report.to_json())["metrics"]
    assert "Handoff Quality Report" in report.to_markdown()


def test_quality_evaluator_recommends_improvements_for_weak_state() -> None:
    state = HandoffState(task="Build", from_agent="Architect", to_agent="Coder", summary="ok")
    report = HandoffQualityEvaluator().evaluate(state)

    assert report.success is False
    assert report.grade in {"D", "F"}
    assert report.recommendations


def test_quality_evaluate_many_aggregates_reports() -> None:
    report = HandoffQualityEvaluator().evaluate_many([strong_state(), strong_state()])

    assert report.success is True
    assert report.metadata["handoffs"] == 2
    assert len(report.metrics) == 5


def test_quality_evaluate_many_empty_list() -> None:
    report = HandoffQualityEvaluator().evaluate_many([])

    assert report.success is False
    assert report.score == 0.0
    assert report.grade == "F"
