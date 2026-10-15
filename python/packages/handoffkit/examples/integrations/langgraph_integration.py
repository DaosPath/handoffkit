"""Dependency-optional LangGraph integration example.

Run it with only HandoffKit installed. If LangGraph is installed, the same node
functions can be dropped into a graph; the fallback runner keeps this example
offline and dependency-free for normal tests.
"""

from __future__ import annotations

from typing import Any

from handoffkit import HandoffState, HandoffStateValidator


def handoff_to_markdown(handoff: HandoffState) -> str:
    """Render the important handoff fields for the terminal demo."""
    return (
        f"## {handoff.from_agent} -> {handoff.to_agent}\n\n"
        f"Task: {handoff.task}\n\n"
        f"Summary: {handoff.summary}\n\n"
        "Decisions:\n"
        + "\n".join(f"- {item}" for item in handoff.decisions)
        + "\n\nFiles:\n"
        + "\n".join(f"- `{item}`" for item in handoff.important_files)
        + "\n\nErrors:\n"
        + "\n".join(f"- {item}" for item in handoff.errors)
        + "\n\nNext steps:\n"
        + "\n".join(f"- {item}" for item in handoff.next_steps)
    )


def architect_node(state: dict[str, Any]) -> dict[str, Any]:
    """LangGraph-style node: create the contract for the coder."""
    handoff = HandoffState(
        task=str(state["task"]),
        from_agent="Architect",
        to_agent="Coder",
        summary="Build a calculator CLI with pure arithmetic helpers and argparse.",
        decisions=[
            "Keep arithmetic operations separate from CLI parsing.",
            "Treat division by zero as an explicit error path.",
        ],
        important_files=["calculator.py", "tests/test_calculator.py"],
        errors=[],
        next_steps=["Implement calculator.py", "Add pytest coverage", "Run pytest -q"],
        metadata={"integration": "langgraph", "errors_checked": True},
    )
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return {"handoff": handoff.to_dict()}


def coder_node(state: dict[str, Any]) -> dict[str, Any]:
    """LangGraph-style node: consume and extend the contract."""
    previous = HandoffState.from_dict(state["handoff"]).validate()
    handoff = HandoffState(
        task=previous.task,
        from_agent="Coder",
        to_agent="Reviewer",
        summary="Implemented CLI structure and tests; reviewer should inspect error messages.",
        decisions=[*previous.decisions, "Expose calculate(operation, a, b) for tests."],
        important_files=[*previous.important_files],
        errors=["Invalid-operation message may need clearer supported operations."],
        next_steps=["Review CLI errors", "Run pytest -q"],
        metadata={"integration": "langgraph", "received_from": previous.from_agent},
    )
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return {"handoff": handoff.to_dict()}


def reviewer_node(state: dict[str, Any]) -> dict[str, Any]:
    """LangGraph-style node: produce a final audit-ready handoff."""
    previous = HandoffState.from_dict(state["handoff"]).validate()
    handoff = HandoffState(
        task=previous.task,
        from_agent="Reviewer",
        to_agent="Tester",
        summary="Review passed after tightening invalid-operation messaging.",
        decisions=[*previous.decisions, "Name supported operations in invalid-operation errors."],
        important_files=[*previous.important_files, "README.md"],
        errors=[*previous.errors, "Regression test added for unsupported operation."],
        next_steps=["Run pytest -q", "Run python calculator.py add 2 3"],
        metadata={"integration": "langgraph", "review_complete": True},
    )
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return {"handoff": handoff.to_dict()}


def run_fallback_graph(task: str) -> HandoffState:
    """Run the same node sequence without importing LangGraph."""
    state: dict[str, Any] = {"task": task}
    for node in [architect_node, coder_node, reviewer_node]:
        state.update(node(state))
    return HandoffState.from_dict(state["handoff"]).validate()


def main() -> None:
    final = run_fallback_graph("Ship a Python CLI calculator with tests.")
    print("# LangGraph Integration Example")
    print()
    print("Runs offline with LangGraph-style node functions and a HandoffState payload.")
    print()
    print(handoff_to_markdown(final))


if __name__ == "__main__":
    main()
