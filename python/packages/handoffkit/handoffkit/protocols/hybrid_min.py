"""Minimal hybrid handoff protocol."""

from __future__ import annotations

from handoffkit.handoff import HandoffState


def build_state(task: str, from_agent: str, to_agent: str, summary: str) -> HandoffState:
    """Build a minimal structured handoff state."""
    return HandoffState(
        task=task,
        from_agent=from_agent,
        to_agent=to_agent,
        summary=summary,
        next_steps=[f"{to_agent} should use task and summary as the minimal state contract."],
        metadata={"mode": "hybrid_min", "fields": ["task", "summary", "next_steps"]},
    )
