"""Handoff protocol facade."""

from __future__ import annotations

from typing import Any

from handoffkit.agent import Agent
from handoffkit.errors import ProtocolError
from handoffkit.handoff import HandoffState
from handoffkit.protocols import compressed, hybrid_min, hybrid_state, natural
from handoffkit.schemas import ProtocolMode

SUPPORTED_MODES: set[str] = {"natural", "compressed", "hybrid_min", "hybrid_state"}


class HandoffProtocol:
    """Transfer state between agents using a named protocol mode."""

    def __init__(self, mode: ProtocolMode = "hybrid_state") -> None:
        if mode not in SUPPORTED_MODES:
            raise ProtocolError(f"Unsupported handoff protocol mode: {mode}")
        self.mode = mode

    def transfer(
        self,
        *,
        from_agent: Agent,
        to_agent: Agent,
        task: str,
        summary: str | None = None,
        decisions: list[str] | None = None,
        important_files: list[str] | None = None,
        errors: list[str] | None = None,
        next_steps: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> HandoffState:
        """Create handoff state from one agent to another."""
        source_summary = summary if summary is not None else from_agent.run(task)
        if self.mode == "natural":
            return natural.build_state(task, from_agent.name, to_agent.name, source_summary)
        if self.mode == "compressed":
            return compressed.build_state(task, from_agent.name, to_agent.name, source_summary)
        if self.mode == "hybrid_min":
            return hybrid_min.build_state(task, from_agent.name, to_agent.name, source_summary)
        if self.mode == "hybrid_state":
            return hybrid_state.build_state(
                task,
                from_agent.name,
                to_agent.name,
                source_summary,
                decisions=decisions,
                important_files=important_files,
                errors=errors,
                next_steps=next_steps,
                metadata=metadata,
            )
        raise ProtocolError(f"Unsupported handoff protocol mode: {self.mode}")

    def __repr__(self) -> str:
        return f"HandoffProtocol(mode={self.mode!r})"
