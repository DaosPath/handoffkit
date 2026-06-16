"""Full structured state handoff protocol."""

from __future__ import annotations

from typing import Any

from handoffkit.handoff import HandoffState


def build_state(
    task: str,
    from_agent: str,
    to_agent: str,
    summary: str,
    *,
    decisions: list[str] | None = None,
    important_files: list[str] | None = None,
    errors: list[str] | None = None,
    next_steps: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> HandoffState:
    """Build a full structured handoff state."""
    merged_metadata = {
        "mode": "hybrid_state",
        "handoff_version": "1.0",
        "state_contract": [
            "task",
            "from_agent",
            "to_agent",
            "summary",
            "decisions",
            "important_files",
            "errors",
            "next_steps",
            "metadata",
        ],
    }
    merged_metadata.update(metadata or {})
    return HandoffState(
        task=task,
        from_agent=from_agent,
        to_agent=to_agent,
        summary=summary,
        decisions=decisions or [f"{from_agent} completed its current role output."],
        important_files=important_files or [],
        errors=errors or [],
        next_steps=next_steps or [
            f"{to_agent} should inspect the structured handoff.",
            "Continue the task while preserving decisions and constraints.",
        ],
        metadata=merged_metadata,
    )
