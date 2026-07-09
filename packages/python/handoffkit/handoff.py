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

    def to_markdown(self) -> str:
        """Return a markdown string representing the handoff state."""
        lines = [
            "# HandoffState",
            "",
            f"Task: {self.task}",
            f"From: {self.from_agent or '-'}",
            f"To: {self.to_agent or '-'}",
            "",
            "## Summary",
            self.summary or "-",
            "",
        ]

        def add_list_section(title: str, items: list[str]) -> None:
            lines.append(f"## {title}")
            if not items:
                lines.append("-")
            else:
                for item in items:
                    lines.append(f"- {item}")
            lines.append("")

        add_list_section("Decisions", self.decisions)
        add_list_section("Files", self.important_files)
        add_list_section("Errors", self.errors)
        add_list_section("Next Steps", self.next_steps)
        add_list_section("Context Refs", self.context_refs)

        return "\n".join(lines).strip()

    @classmethod
    def from_markdown(cls, text: str) -> HandoffState:
        """Parse a HandoffState from its markdown representation."""
        task = ""
        from_agent = ""
        to_agent = ""
        summary = ""
        decisions: list[str] = []
        important_files: list[str] = []
        errors: list[str] = []
        next_steps: list[str] = []
        context_refs: list[str] = []

        lines = text.splitlines()
        current_section = None
        summary_lines = []

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue

            if line_str.startswith("Task:"):
                task = line_str[len("Task:"):].strip()
                continue
            if line_str.startswith("From:"):
                from_agent = line_str[len("From:"):].strip()
                if from_agent == "-":
                    from_agent = ""
                continue
            if line_str.startswith("To:"):
                to_agent = line_str[len("To:"):].strip()
                if to_agent == "-":
                    to_agent = ""
                continue

            if line_str.startswith("## "):
                current_section = line_str[3:].strip().lower()
                continue

            if current_section == "summary":
                summary_lines.append(line_str)
            elif line_str.startswith("-"):
                val = line_str[1:].strip()
                if not val or val == "-":
                    continue
                if current_section == "decisions":
                    decisions.append(val)
                elif current_section in ("files", "important files", "important_files"):
                    important_files.append(val)
                elif current_section == "errors":
                    errors.append(val)
                elif current_section in ("next steps", "next_steps"):
                    next_steps.append(val)
                elif current_section in ("context refs", "context_refs"):
                    context_refs.append(val)

        summary = "\n".join(summary_lines).strip()
        if summary == "-":
            summary = ""

        return cls(
            task=task,
            from_agent=from_agent,
            to_agent=to_agent,
            summary=summary,
            decisions=decisions,
            important_files=important_files,
            errors=errors,
            next_steps=next_steps,
            context_refs=context_refs,
        )
