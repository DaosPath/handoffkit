"""Structured handoff state between agents."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any

from handoffkit.errors import HandoffValidationError

REQUIRED_TEXT_FIELDS = ("task", "from_agent", "to_agent")
LIST_FIELDS = ("decisions", "important_files", "errors", "next_steps")


@dataclass
class HandoffState:
    """State transferred from one agent to another."""

    task: str
    from_agent: str
    to_agent: str
    summary: str = ""
    decisions: list[str] = field(default_factory=list)
    important_files: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable dictionary."""
        return asdict(self)

    def to_json(self, *, indent: int | None = 2) -> str:
        """Return a JSON string."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def validate(self) -> "HandoffState":
        """Validate the handoff state contract and return self."""
        problems: list[str] = []
        for field_name in REQUIRED_TEXT_FIELDS:
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                problems.append(f"{field_name} must be a non-empty string")
        if not isinstance(self.summary, str):
            problems.append("summary must be a string")
        for field_name in LIST_FIELDS:
            value = getattr(self, field_name)
            if not isinstance(value, list):
                problems.append(f"{field_name} must be a list")
                continue
            if not all(isinstance(item, str) for item in value):
                problems.append(f"{field_name} must contain only strings")
        if not isinstance(self.metadata, dict):
            problems.append("metadata must be a dictionary")
        if problems:
            raise HandoffValidationError("; ".join(problems))
        return self

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "HandoffState":
        """Create a handoff state from a dictionary."""
        return cls(
            task=str(data.get("task", "")),
            from_agent=str(data.get("from_agent", "")),
            to_agent=str(data.get("to_agent", "")),
            summary=str(data.get("summary", "")),
            decisions=list(data.get("decisions") or []),
            important_files=list(data.get("important_files") or []),
            errors=list(data.get("errors") or []),
            next_steps=list(data.get("next_steps") or []),
            metadata=dict(data.get("metadata") or {}),
        )

    @classmethod
    def from_json(cls, value: str) -> "HandoffState":
        """Create a handoff state from JSON."""
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("HandoffState JSON must decode to an object.")
        return cls.from_dict(data)
