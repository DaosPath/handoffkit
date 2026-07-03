"""Structured handoff state between agents."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any

from handoffkit.errors import HandoffValidationError

REQUIRED_TEXT_FIELDS = ("task", "from_agent", "to_agent")
LIST_FIELDS = ("decisions", "important_files", "errors", "next_steps", "context_refs")


def _value_or_default(data: dict[str, Any], key: str, default: Any) -> Any:
    """Read a key without coercing invalid caller data into a valid shape."""
    value = data.get(key, default)
    return default if value is None else value


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
    context_refs: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable dictionary."""
        return asdict(self)

    def to_json(self, *, indent: int | None = 2) -> str:
        """Return a JSON string."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def validate(self) -> HandoffState:
        """Validate the handoff state contract and return self."""
        report = self.validate_report()
        if not report.success:
            raise HandoffValidationError("; ".join(issue.message for issue in report.errors))
        return self

    def validate_report(self) -> Any:
        """Validate the handoff state and return a structured report."""
        from handoffkit.validation import HandoffStateValidator

        return HandoffStateValidator().validate(self)

    @staticmethod
    def json_schema() -> dict[str, Any]:
        """Return a JSON-schema-like contract for HandoffState."""
        string_array = {"type": "array", "items": {"type": "string"}}
        return {
            "title": "HandoffState",
            "type": "object",
            "properties": {
                "task": {"type": "string"},
                "from_agent": {"type": "string"},
                "to_agent": {"type": "string"},
                "summary": {"type": "string"},
                "decisions": string_array,
                "important_files": string_array,
                "errors": string_array,
                "next_steps": string_array,
                "context_refs": string_array,
                "metadata": {"type": "object"},
            },
            "required": ["task", "from_agent", "to_agent"],
            "additionalProperties": True,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HandoffState:
        """Create a handoff state from a dictionary."""
        return cls(
            task=_value_or_default(data, "task", ""),
            from_agent=_value_or_default(data, "from_agent", ""),
            to_agent=_value_or_default(data, "to_agent", ""),
            summary=_value_or_default(data, "summary", ""),
            decisions=_value_or_default(data, "decisions", []),
            important_files=_value_or_default(data, "important_files", []),
            errors=_value_or_default(data, "errors", []),
            next_steps=_value_or_default(data, "next_steps", []),
            context_refs=_value_or_default(data, "context_refs", []),
            metadata=_value_or_default(data, "metadata", {}),
        )

    @classmethod
    def from_json(cls, value: str) -> HandoffState:
        """Create a handoff state from JSON."""
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("HandoffState JSON must decode to an object.")
        return cls.from_dict(data)
