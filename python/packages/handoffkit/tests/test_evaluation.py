"""Workflow evaluation tests."""

from __future__ import annotations

from handoffkit import (
    Agent,
    EvaluationCheck,
    EvaluationResult,
    HandoffProtocol,
    HandoffState,
    RunTrace,
    Team,
    WorkflowEvaluationReport,
    WorkflowEvaluator,
)
from handoffkit.tool_execution import ToolExecutionReport, ToolResult


def _good_handoff() -> HandoffState:
    return HandoffState(
        task="Create a CLI calculator.",
        from_agent="Architect",
        to_agent="Coder",
        summary="Build an argparse calculator with pure operations and pytest coverage.",
        decisions=["Use argparse for the command-line interface."],
        important_files=["calculator.py"],
        next_steps=["Implement calculator.py", "Run pytest -q"],
        context_refs=["README.md#quickstart"],
        metadata={"errors_checked": True},
    )


def test_evaluation_report_serializes() -> None:
    report = WorkflowEvaluationReport(
        success=True,
        score=1.0,
        grade="A",
        results=[
            EvaluationResult(
                target="demo",
                success=True,
                score=1.0,
                checks=[EvaluationCheck("contract", True, "ok")],
            )
        ],
    )

    assert report.to_dict()["success"] is True
    assert "Workflow Evaluation Report" in report.to_markdown()


def test_evaluator_accepts_handoff_list() -> None:
    report = WorkflowEvaluator().evaluate([_good_handoff()])

    assert report.success is True
    assert report.score >= 0.75


def test_evaluator_detects_invalid_handoff() -> None:
    bad = HandoffState(task="", from_agent="", to_agent="", summary="")

    report = WorkflowEvaluator().evaluate([bad])

    assert report.success is False
    assert "handoff" in " ".join(report.recommendations).lower()


def test_evaluator_accepts_team_result_and_trace() -> None:
    team = Team(
        [Agent("Architect", "Plan."), Agent("Coder", "Implement.")],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    result = team.run("Create a CLI calculator.")
    trace = RunTrace.from_team_result(result)

    assert WorkflowEvaluator().evaluate(result).results[0].target == "TeamRunResult"
    assert WorkflowEvaluator().evaluate(trace).results[0].target == "RunTrace"


def test_evaluator_detects_failed_tool_result() -> None:
    report = ToolExecutionReport(
        task="Run tool.",
        agent_name="Agent",
        tool_results=[ToolResult("missing", False, error="failed")],
        success=False,
        steps=[{"mode": "tools"}],
    )

    evaluation = WorkflowEvaluator().evaluate(report)

    assert evaluation.success is False
    assert "tool" in " ".join(evaluation.recommendations).lower()
