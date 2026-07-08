"""Shared schema helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

ProtocolMode = Literal["natural", "compressed", "hybrid_min", "hybrid_state"]


@dataclass
class AgentOutput:
    """Output produced by a named agent."""

    agent: str
    output: str

    def to_dict(self) -> dict[str, str]:
        """Return a dictionary representation."""
        return {"agent": self.agent, "output": self.output}


@dataclass
class TeamRunResult:
    """Result returned by Team.run."""

    task: str
    final_output: str
    agent_outputs: list[AgentOutput]
    handoffs: list[Any]

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-friendly result."""
        return {
            "task": self.task,
            "final_output": self.final_output,
            "agent_outputs": [output.to_dict() for output in self.agent_outputs],
            "handoffs": [
                handoff.to_dict() if hasattr(handoff, "to_dict") else handoff
                for handoff in self.handoffs
            ],
        }

    def __str__(self) -> str:
        return self.final_output
