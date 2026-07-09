"""Tests for run tracing primitives."""

from __future__ import annotations

import json

from handoffkit import (
    Agent,
    FileTraceStore,
    HandoffProtocol,
    RecipeRunner,
    RunTrace,
    Team,
    TraceEvent,
    TraceStep,
    WorkflowTemplate,
    tool,
)
from handoffkit.tool_execution import ToolExecutionReport


def team_result() -> object:
    """Return a small deterministic team result."""
    team = Team(
        agents=[Agent("Planner", "Plan."), Agent("Reviewer", "Review.")],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    return team.run("Prepare a release checklist.")


def test_trace_event_serialization_roundtrip() -> None:
    event = TraceEvent("note", "Recorded.", metadata={"x": 1})

    loaded = TraceEvent.from_dict(event.to_dict())

    assert loaded.kind == "note"
    assert loaded.metadata == {"x": 1}


def test_trace_step_serialization_roundtrip() -> None:
    step = TraceStep(
        name="plan",
        agent="Planner",
        task="Plan.",
        mode="team",
        output="Done.",
        events=[TraceEvent("note", "ok")],
    )

    loaded = TraceStep.from_dict(step.to_dict())

    assert loaded.name == "plan"
    assert loaded.events[0].message == "ok"


def test_run_trace_from_team_result() -> None:
    trace = RunTrace.from_team_result(team_result(), name="team-demo")

    assert trace.name == "team-demo"
    assert trace.success is True
    assert len(trace.steps) == 2
    assert len(trace.handoffs) == 1
    assert trace.metadata["source"] == "TeamRunResult"


def test_run_trace_from_recipe_result() -> None:
    recipe = WorkflowTemplate.sequential(
        name="seq",
        agents=[Agent("Planner", "Plan."), Agent("Reviewer", "Review.")],
        task="Prepare release notes.",
    )
    result = RecipeRunner(recipe).run()

    trace = RunTrace.from_recipe_result(result)

    assert trace.name == "seq"
    assert trace.success is True
    assert len(trace.steps) == 2
    assert len(trace.handoffs) == 1


def test_run_trace_from_tool_execution_report() -> None:
    @tool
    def label(value: str) -> str:
        """Label a value."""
        return f"label:{value}"

    report = Agent("ToolAgent", "Use tools.", tools=[label]).run_with_tools(
        "No deterministic local tool call matched.",
        tools=[label],
        tool_call_mode="deterministic",
    )
    trace = RunTrace.from_tool_execution_report(report)

    assert trace.metadata["source"] == "ToolExecutionReport"
    assert len(trace.steps) == 1


def test_run_trace_from_minimal_tool_execution_report() -> None:
    report = ToolExecutionReport(task="Task", agent_name="Agent", final_output="Done")

    trace = RunTrace.from_tool_execution_report(report)

    assert trace.final_output == "Done"
    assert trace.steps[0].name == "tool-step-1"


def test_run_trace_json_roundtrip() -> None:
    trace = RunTrace.from_team_result(team_result())

    loaded = RunTrace.from_json(trace.to_json())

    assert loaded.run_id == trace.run_id
    assert loaded.steps[1].handoff is not None


def test_run_trace_markdown_contains_steps() -> None:
    trace = RunTrace.from_team_result(team_result())

    markdown = trace.to_markdown()

    assert "Run Trace" in markdown
    assert "Steps" in markdown


def test_file_trace_store_save_load_list(tmp_path) -> None:  # type: ignore[no-untyped-def]
    trace = RunTrace.from_team_result(team_result())
    store = FileTraceStore(tmp_path)

    path = store.save(trace)
    loaded = store.load(path)

    assert path.exists()
    assert loaded.run_id == trace.run_id
    assert store.list() == [path]


def test_file_trace_store_load_by_name_without_suffix(tmp_path) -> None:  # type: ignore[no-untyped-def]
    trace = RunTrace.from_team_result(team_result(), run_id="demo")
    store = FileTraceStore(tmp_path)
    store.save(trace)

    loaded = store.load("demo")

    assert loaded.run_id == "demo"


def test_run_trace_stable_id_is_deterministic() -> None:
    first = RunTrace.from_team_result(team_result())
    second = RunTrace.from_team_result(team_result())

    assert first.run_id == second.run_id


def test_run_trace_dict_is_json_serializable() -> None:
    trace = RunTrace.from_team_result(team_result())

    payload = json.loads(trace.to_json())

    assert payload["run_id"] == trace.run_id


def test_run_trace_to_timeline() -> None:
    trace = RunTrace.from_team_result(team_result(), name="my-timeline-test")
    timeline = trace.to_timeline()

    assert "Execution Timeline: my-timeline-test" in timeline
    assert "1. [Planner] -> Task:" in timeline

