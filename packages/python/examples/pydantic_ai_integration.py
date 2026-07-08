"""Dependency-optional Pydantic AI handoff adapter example.

This example does not import Pydantic AI. It shows the copy/paste boundary:
a typed model result becomes a validated HandoffState before the next agent
or workflow step consumes it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from handoffkit import HandoffState, HandoffStateValidator


@dataclass
class ReleaseDecision:
    """Small stand-in for a Pydantic AI typed result."""

    approved: bool
    notes: list[str] = field(default_factory=list)
    important_files: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)


def pydantic_ai_result_to_handoff(decision: ReleaseDecision) -> HandoffState:
    """Convert a typed result into the workflow-level handoff contract."""
    handoff = HandoffState(
        task="Prepare a Python package release.",
        from_agent="TypedReviewer",
        to_agent="Publisher",
        summary=(
            "Release approved with packaging checks."
            if decision.approved
            else "Release blocked."
        ),
        decisions=decision.notes,
        important_files=decision.important_files,
        errors=decision.risks,
        next_steps=decision.next_steps,
        context_refs=["pyproject.toml", "CHANGELOG.md", "CI run"],
        metadata={"integration": "pydantic-ai", "errors_checked": True},
    )
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return handoff


def handoff_to_markdown(handoff: HandoffState) -> str:
    """Render the adapter output for the terminal demo."""
    return (
        f"## {handoff.from_agent} -> {handoff.to_agent}\n\n"
        f"Task: {handoff.task}\n\n"
        f"Summary: {handoff.summary}\n\n"
        "Decisions:\n"
        + "\n".join(f"- {item}" for item in handoff.decisions)
        + "\n\nFiles:\n"
        + "\n".join(f"- `{item}`" for item in handoff.important_files)
        + "\n\nRisks:\n"
        + "\n".join(f"- {item}" for item in handoff.errors)
        + "\n\nNext steps:\n"
        + "\n".join(f"- {item}" for item in handoff.next_steps)
    )


def main() -> None:
    typed_result = ReleaseDecision(
        approved=True,
        notes=[
            "Use Trusted Publishing for PyPI release.",
            "Verify wheel metadata with twine check before upload.",
        ],
        important_files=["pyproject.toml", "CHANGELOG.md", "dist/*.whl"],
        risks=["Do not publish until CI is green."],
        next_steps=[
            "Run python -m build",
            "Run python -m twine check dist/*",
            "Publish from trusted workflow",
        ],
    )
    handoff = pydantic_ai_result_to_handoff(typed_result)
    print("# Pydantic AI Integration Example")
    print()
    print("Runs offline and demonstrates typed output becoming HandoffState.")
    print()
    print(handoff_to_markdown(handoff))


if __name__ == "__main__":
    main()
