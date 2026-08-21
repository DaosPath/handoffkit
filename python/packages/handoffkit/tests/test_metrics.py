"""P2 workflow metrics helpers."""

from __future__ import annotations

from handoffkit import HandoffState
from handoffkit.benchmarks.metrics import (
    build_workflow_metrics,
    context_loss_stats,
    latency_stats,
)


def test_latency_stats_basic() -> None:
    stats = latency_stats([10, 20, 30, 40])
    assert stats.count == 4
    assert stats.mean_ms == 25.0
    assert stats.p50_ms == 25.0
    assert stats.max_ms == 40.0


def test_context_loss_and_report() -> None:
    good = HandoffState(
        "task",
        "a",
        "b",
        summary="done",
        decisions=["x"],
        next_steps=["y"],
        important_files=["f.py"],
    )
    thin = HandoffState("task", "a", "b")
    loss = context_loss_stats([good, thin])
    assert loss.handoffs == 2
    assert loss.missing_summary == 1
    assert loss.loss_rate > 0

    report = build_workflow_metrics(
        durations_ms=[100, 200],
        runs=[{"usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost_usd": 0.0}}],
        handoffs=[good, thin],
        attempts=2,
        recoveries=1,
        hard_failures=0,
    )
    assert report.latency.count == 2
    assert report.cost.total_tokens == 15
    assert "Workflow Metrics" in report.to_markdown()
    assert report.to_dict()["context_loss"]["handoffs"] == 2
