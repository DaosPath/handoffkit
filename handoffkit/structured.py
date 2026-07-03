"""Structured output parsing, validation, and repair."""

from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass, field
from typing import Any


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if isinstance(value, type):
        return value.__name__
    return str(value)


def _schema_type(value: type[Any] | Any) -> str:
    """Map a Python type to a JSON schema type."""
    if value is str:
        return "string"
    if value is int:
        return "integer"
    if value is float:
        return "number"
    if value is bool:
        return "boolean"
    if value is list:
        return "array"
    if value is dict:
        return "object"
    if value is type(None) or value is None:
        return "null"
    return "string"


def _type_name(value: type[Any] | Any) -> str:
    """Return a readable type name."""
    if value is type(None) or value is None:
        return "None"
    if hasattr(value, "__name__"):
        return str(value.__name__)
    return str(value)


def _matches_type(value: Any, expected: type[Any] | Any) -> bool:
    """Return whether a value matches a supported schema type."""
    if expected is type(None) or expected is None:
        return value is None
    if expected is bool:
        return isinstance(value, bool)
    if expected is int:
        return isinstance(value, int) and not isinstance(value, bool)
    if expected is float:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected in {str, list, dict}:
        return isinstance(value, expected)
    return isinstance(value, expected) if isinstance(expected, type) else True


class OutputValidationError(ValueError):
    """Raised when structured output cannot be parsed or validated."""


@dataclass
class StructuredOutputSchema:
    """Small schema object for provider-agnostic structured outputs."""

    name: str
    fields: dict[str, type[Any] | Any]
    description: str = ""
    required: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("schema name must be a non-empty string")
        if not isinstance(self.fields, dict) or not self.fields:
            raise ValueError("schema fields must be a non-empty dictionary")
        unknown_required = [name for name in self.required if name not in self.fields]
        if unknown_required:
            raise ValueError(f"required fields are not defined: {', '.join(unknown_required)}")

    def to_dict(self) -> dict[str, Any]:
        """Serialize this schema."""
        return {
            "name": self.name,
            "description": self.description,
            "fields": {name: _type_name(kind) for name, kind in self.fields.items()},
            "required": list(self.required),
            "metadata": self.metadata,
        }

    def to_json_schema(self) -> dict[str, Any]:
        """Return a JSON-schema-like representation."""
        return {
            "title": self.name,
            "description": self.description,
            "type": "object",
            "properties": {
                name: {"type": _schema_type(kind)}
                for name, kind in self.fields.items()
            },
            "required": list(self.required),
            "additionalProperties": True,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this schema as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def validate(self, data: dict[str, Any]) -> dict[str, Any]:
        """Validate a dictionary against this schema and return it."""
        if not isinstance(data, dict):
            raise OutputValidationError("structured output must be a JSON object")
        errors: list[str] = []
        for name in self.required:
            if name not in data:
                errors.append(f"missing required field: {name}")
        for name, expected in self.fields.items():
            if name not in data:
                continue
            value = data[name]
            if value is None and name not in self.required:
                continue
            if not _matches_type(value, expected):
                errors.append(
                    f"field {name!r} expected {_type_name(expected)}, "
                    f"got {type(value).__name__}"
                )
        if errors:
            raise OutputValidationError("; ".join(errors))
        return data

    def validate_report(self, data: dict[str, Any]) -> Any:
        """Validate data and return a structured report."""
        from handoffkit.validation import StructuredOutputValidator

        return StructuredOutputValidator().validate(self, data)


@dataclass
class StructuredOutputResult:
    """Result returned by Agent.run_structured()."""

    success: bool
    data: dict[str, Any] | None
    raw_output: str
    errors: list[str]
    schema_name: str
    repaired: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this result."""
        return {
            "success": self.success,
            "data": self.data,
            "raw_output": self.raw_output,
            "errors": self.errors,
            "schema_name": self.schema_name,
            "repaired": self.repaired,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this result as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize this result as Markdown."""
        errors = "\n".join(f"- {error}" for error in self.errors) or "- none"
        data = json.dumps(self.data or {}, ensure_ascii=False, indent=2, default=_json_default)
        return (
            f"# Structured Output: {self.schema_name}\n\n"
            f"## Success\n\n{self.success}\n\n"
            f"## Repaired\n\n{self.repaired}\n\n"
            f"## Data\n\n```json\n{data}\n```\n\n"
            f"## Errors\n\n{errors}\n"
        )


class OutputRepairer:
    """Repair common JSON mistakes without guessing provider intent."""

    _fence_pattern = re.compile(r"```(?:json|txt)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)

    def repair(self, text: str) -> str:
        """Return a repaired JSON string or raise OutputValidationError."""
        candidates = self._candidates(text)
        errors: list[str] = []
        for candidate in candidates:
            for fixed in self._repair_candidate(candidate):
                try:
                    parsed = json.loads(fixed)
                    return json.dumps(parsed, ensure_ascii=False)
                except json.JSONDecodeError as exc:
                    errors.append(str(exc))
        try:
            parsed = ast.literal_eval(candidates[0])
            if isinstance(parsed, (dict, list)):
                return json.dumps(parsed, ensure_ascii=False)
        except (SyntaxError, ValueError):
            pass
        raise OutputValidationError(
            "could not repair structured output"
            + (f": {errors[-1]}" if errors else "")
        )

    def _candidates(self, text: str) -> list[str]:
        stripped = text.strip()
        candidates = [stripped]
        for match in self._fence_pattern.finditer(stripped):
            candidates.append(match.group(1).strip())
        extracted = _extract_first_json_object(stripped)
        if extracted:
            candidates.append(extracted)
        return list(dict.fromkeys(candidate for candidate in candidates if candidate))

    def _repair_candidate(self, candidate: str) -> list[str]:
        fixed = candidate.strip()
        python_literals = re.sub(
            r"\bTrue\b",
            "true",
            re.sub(r"\bFalse\b", "false", re.sub(r"\bNone\b", "null", fixed)),
        )
        return [
            fixed,
            re.sub(r",(\s*[}\]])", r"\1", fixed),
            python_literals,
            re.sub(
                r",(\s*[}\]])",
                r"\1",
                python_literals,
            ),
            self._literal_eval_to_json(fixed),
        ]

    def _literal_eval_to_json(self, candidate: str) -> str:
        try:
            parsed = ast.literal_eval(candidate)
        except (SyntaxError, ValueError):
            return candidate
        if isinstance(parsed, (dict, list)):
            return json.dumps(parsed, ensure_ascii=False)
        return candidate


class JsonOutputParser:
    """Parse model JSON from clean, fenced, or embedded text."""

    _fence_pattern = re.compile(r"```(?:json|txt)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)

    def parse(self, text: str) -> dict[str, Any]:
        """Parse a JSON object from text."""
        errors: list[str] = []
        for candidate in self._candidates(text):
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError as exc:
                errors.append(str(exc))
                continue
            if not isinstance(parsed, dict):
                raise OutputValidationError("structured output must be a JSON object")
            return parsed
        raise OutputValidationError(
            "could not parse JSON object"
            + (f": {errors[-1]}" if errors else "")
        )

    def _candidates(self, text: str) -> list[str]:
        stripped = text.strip()
        candidates = [stripped]
        for match in self._fence_pattern.finditer(stripped):
            candidates.append(match.group(1).strip())
        extracted = _extract_first_json_object(stripped)
        if extracted:
            candidates.append(extracted)
        return list(dict.fromkeys(candidate for candidate in candidates if candidate))


def _extract_first_json_object(text: str) -> str | None:
    """Extract the first balanced JSON object from mixed text."""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if escaped:
            escaped = False
            continue
        if char == "\\" and in_string:
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None
