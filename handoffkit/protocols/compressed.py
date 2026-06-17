"""Compressed handoff protocol."""

from __future__ import annotations

from handoffkit.handoff import HandoffState


def compact(text: str, max_chars: int = 360) -> str:
    """Compact whitespace and cap text length."""
    clean = " ".join(text.strip().split())
    if len(clean) <= max_chars:
        return clean
    return clean[: max_chars - 3].rstrip() + "..."


def build_state(task: str, from_agent: str, to_agent: str, summary: str) -> HandoffState:
    """Build a compact handoff state."""
    return HandoffState(
        task=compact(task, 220),
        from_agent=from_agent,
        to_agent=to_agent,
        summary=compact(summary, 360),
        next_steps=[
            compact(f"{to_agent}: continue task; preserve constraints; report blockers.", 180)
        ],
        metadata={
            "mode": "compressed",
            "format": "compact",
            "compression": "whitespace-normalized-char-cap",
        },
    )
