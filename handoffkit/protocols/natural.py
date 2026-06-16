"""Natural-language handoff protocol."""

from __future__ import annotations

from handoffkit.handoff import HandoffState


def build_state(task: str, from_agent: str, to_agent: str, summary: str) -> HandoffState:
    """Build a natural-language handoff state."""
    natural_summary = (
        f"{from_agent} is handing off to {to_agent}. "
        f"The original task is: {task}. "
        f"Progress summary: {summary}"
    )
    return HandoffState(
        task=task,
        from_agent=from_agent,
        to_agent=to_agent,
        summary=natural_summary,
        next_steps=[f"{to_agent} should continue from the summary and preserve task intent."],
        metadata={"mode": "natural", "format": "human_readable"},
    )
