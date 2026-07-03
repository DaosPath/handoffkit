"""Replay summaries for saved HandoffKit run traces."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from handoffkit.tracing import RunTrace


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


@dataclass
class ReplaySummary:
    """Summary produced by replaying a trace without re-executing work."""

    success: bool
    step_count: int
    handoff_count: int
    tool_result_count: int
    final_output: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this replay summary."""
        return {
            "success": self.success,
            "step_count": self.step_count,
            "handoff_count": self.handoff_count,
            "tool_result_count": self.tool_result_count,
            "final_output": self.final_output,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this replay summary as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize this replay summary as Markdown."""
        return (
            "# Replay Summary\n\n"
            f"## Success\n\n{self.success}\n\n"
            f"## Steps\n\n{self.step_count}\n\n"
            f"## Handoffs\n\n{self.handoff_count}\n\n"
            f"## Tool Results\n\n{self.tool_result_count}\n\n"
            f"## Final Output\n\n{self.final_output}\n"
        )


class ReplayRunner:
    """Inspect a saved run trace without re-executing providers, tools, or shell."""

    def __init__(self, trace: RunTrace) -> None:
        self.trace = trace

    def summary(self) -> ReplaySummary:
        """Return a replay summary for the trace."""
        tool_result_count = sum(len(step.tool_results) for step in self.trace.steps)
        return ReplaySummary(
            success=self.trace.success,
            step_count=len(self.trace.steps),
            handoff_count=len(self.trace.handoffs),
            tool_result_count=tool_result_count,
            final_output=self.trace.final_output,
            metadata={
                "run_id": self.trace.run_id,
                "name": self.trace.name,
                "source": self.trace.metadata.get("source", ""),
                "replayed": False,
            },
        )
