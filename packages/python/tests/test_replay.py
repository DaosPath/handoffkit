"""Tests for replay summaries."""

from __future__ import annotations

import json

from handoffkit import Agent, ReplayRunner, ReplaySummary, RunTrace, Team


def make_trace() -> RunTrace:
    """Create a replayable trace."""
    return RunTrace.from_team_result(
        Team([Agent("Planner", "Plan."), Agent("Reviewer", "Review.")]).run("Plan release."),
        name="replay-test",
    )


def test_replay_summary_counts_trace() -> None:
    summary = ReplayRunner(make_trace()).summary()

    assert summary.success is True
    assert summary.step_count == 2
    assert summary.handoff_count == 1
    assert summary.tool_result_count == 0


def test_replay_summary_serialization() -> None:
    summary = ReplayRunner(make_trace()).summary()

    assert json.loads(summary.to_json())["step_count"] == 2
    assert "Replay Summary" in summary.to_markdown()


def test_replay_summary_does_not_execute_again() -> None:
    trace = make_trace()
    before = trace.to_json()

    ReplayRunner(trace).summary()

    assert trace.to_json() == before


def test_replay_summary_metadata_records_source() -> None:
    summary = ReplayRunner(make_trace()).summary()

    assert summary.metadata["source"] == "TeamRunResult"
    assert summary.metadata["replayed"] is False


def test_replay_summary_to_dict() -> None:
    summary = ReplaySummary(True, 1, 0, 0, "Done", {"x": 1})

    assert summary.to_dict()["metadata"] == {"x": 1}
