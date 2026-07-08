"""Reusable contract validation reports."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from handoffkit.tool import Tool


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, type):
        return value.__name__
    return str(value)


@dataclass
class ValidationIssue:
    """One validation issue for a contract, schema, or tool."""

    code: str
    message: str
    field: str = ""
    severity: str = "error"

    def to_dict(self) -> dict[str, Any]:
        """Serialize this issue."""
        return {
            "code": self.code,
            "message": self.message,
            "field": self.field,
            "severity": self.severity,
        }


@dataclass
class ValidationReport:
    """Reusable validation result with JSON and Markdown output."""

    success: bool
    issues: list[ValidationIssue] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def errors(self) -> list[ValidationIssue]:
        """Return error-severity issues."""
        return [issue for issue in self.issues if issue.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return warning-severity issues."""
        return [issue for issue in self.issues if issue.severity == "warning"]

    def to_dict(self) -> dict[str, Any]:
        """Serialize this report."""
        return {
            "success": self.success,
            "issues": [issue.to_dict() for issue in self.issues],
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this report as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize this report as Markdown."""
        issues = "\n".join(
            (
                f"- `{issue.severity}` `{issue.code}`"
                f"{f' `{issue.field}`' if issue.field else ''}: {issue.message}"
            )
            for issue in self.issues
        ) or "- none"
        return (
            "# Validation Report\n\n"
            f"## Success\n\n{self.success}\n\n"
            f"## Issues\n\n{issues}\n"
        )

    def raise_if_failed(self) -> ValidationReport:
        """Raise ValueError when the report has validation errors."""
        if not self.success:
            messages = "; ".join(issue.message for issue in self.errors) or "validation failed"
            raise ValueError(messages)
        return self

    @staticmethod
    def json_schema() -> dict[str, Any]:
        """Return a JSON-schema-like contract for ValidationReport."""
        return {
            "title": "ValidationReport",
            "type": "object",
            "properties": {
                "success": {"type": "boolean"},
                "issues": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "code": {"type": "string"},
                            "message": {"type": "string"},
                            "field": {"type": "string"},
                            "severity": {"type": "string"},
                        },
                        "required": ["code", "message", "field", "severity"],
                    },
                },
                "metadata": {"type": "object"},
            },
            "required": ["success", "issues", "metadata"],
            "additionalProperties": True,
        }


class HandoffStateValidator:
    """Validate HandoffState contracts without mutating them."""

    required_text_fields = ("task", "from_agent", "to_agent")
    list_fields = ("decisions", "important_files", "errors", "next_steps", "context_refs")

    def validate(self, state: Any) -> ValidationReport:
        """Validate a handoff-like object and return a report."""
        issues: list[ValidationIssue] = []
        for field_name in self.required_text_fields:
            value = getattr(state, field_name, None)
            if not isinstance(value, str) or not value.strip():
                issues.append(
                    ValidationIssue(
                        code="required_text",
                        message=f"{field_name} must be a non-empty string",
                        field=field_name,
                    )
                )
        summary = getattr(state, "summary", None)
        if not isinstance(summary, str):
            issues.append(
                ValidationIssue(
                    code="invalid_type",
                    message="summary must be a string",
                    field="summary",
                )
            )
        elif not summary.strip():
            issues.append(
                ValidationIssue(
                    code="empty_summary",
                    message="summary is empty",
                    field="summary",
                    severity="warning",
                )
            )
        for field_name in self.list_fields:
            value = getattr(state, field_name, None)
            if not isinstance(value, list):
                issues.append(
                    ValidationIssue(
                        code="invalid_type",
                        message=f"{field_name} must be a list",
                        field=field_name,
                    )
                )
                continue
            if not all(isinstance(item, str) for item in value):
                issues.append(
                    ValidationIssue(
                        code="invalid_item_type",
                        message=f"{field_name} must contain only strings",
                        field=field_name,
                    )
                )
        metadata = getattr(state, "metadata", None)
        if not isinstance(metadata, dict):
            issues.append(
                ValidationIssue(
                    code="invalid_type",
                    message="metadata must be a dictionary",
                    field="metadata",
                )
            )
        success = not any(issue.severity == "error" for issue in issues)
        return ValidationReport(
            success=success,
            issues=issues,
            metadata={"validator": self.__class__.__name__},
        )


class StructuredOutputValidator:
    """Validate data against a StructuredOutputSchema and return a report."""

    def validate(self, schema: Any, data: dict[str, Any]) -> ValidationReport:
        """Validate structured output data."""
        issues: list[ValidationIssue] = []
        if not isinstance(data, dict):
            issues.append(
                ValidationIssue(
                    code="not_object",
                    message="structured output must be a JSON object",
                )
            )
            return ValidationReport(False, issues, {"schema_name": getattr(schema, "name", "")})
        for field_name in getattr(schema, "required", []):
            if field_name not in data:
                issues.append(
                    ValidationIssue(
                        code="missing_required",
                        message=f"missing required field: {field_name}",
                        field=field_name,
                    )
                )
        for field_name, expected in getattr(schema, "fields", {}).items():
            if field_name not in data:
                continue
            value = data[field_name]
            if value is None and field_name not in getattr(schema, "required", []):
                continue
            if not self._matches_type(value, expected):
                issues.append(
                    ValidationIssue(
                        code="wrong_type",
                        message=(
                            f"field {field_name!r} expected {self._type_name(expected)}, "
                            f"got {type(value).__name__}"
                        ),
                        field=field_name,
                    )
                )
        success = not any(issue.severity == "error" for issue in issues)
        return ValidationReport(
            success=success,
            issues=issues,
            metadata={"validator": self.__class__.__name__, "schema_name": schema.name},
        )

    def _matches_type(self, value: Any, expected: type[Any] | Any) -> bool:
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

    def _type_name(self, value: type[Any] | Any) -> str:
        if value is type(None) or value is None:
            return "None"
        if hasattr(value, "__name__"):
            return str(value.__name__)
        return str(value)


class ToolSchemaValidator:
    """Validate HandoffKit tool schemas."""

    valid_types = {"string", "integer", "number", "boolean", "array", "object", "null"}

    def validate(self, tool_or_schema: Tool | dict[str, Any]) -> ValidationReport:
        """Validate a Tool or a serialized tool schema."""
        schema = tool_or_schema.to_schema() if isinstance(tool_or_schema, Tool) else tool_or_schema
        issues: list[ValidationIssue] = []
        if not isinstance(schema, dict):
            return ValidationReport(
                success=False,
                issues=[
                    ValidationIssue(
                        code="not_object",
                        message="tool schema must be a dictionary",
                    )
                ],
                metadata={"validator": self.__class__.__name__},
            )
        if not isinstance(schema.get("name"), str) or not schema.get("name", "").strip():
            issues.append(
                ValidationIssue(
                    code="missing_name",
                    message="tool schema name must be a non-empty string",
                    field="name",
                )
            )
        parameters = schema.get("parameters")
        if not isinstance(parameters, dict):
            issues.append(
                ValidationIssue(
                    code="invalid_parameters",
                    message="tool schema parameters must be an object",
                    field="parameters",
                )
            )
        else:
            if parameters.get("type") != "object":
                issues.append(
                    ValidationIssue(
                        code="invalid_parameters_type",
                        message="tool schema parameters.type must be object",
                        field="parameters.type",
                    )
                )
            properties = parameters.get("properties")
            if not isinstance(properties, dict):
                issues.append(
                    ValidationIssue(
                        code="invalid_properties",
                        message="tool schema parameters.properties must be an object",
                        field="parameters.properties",
                    )
                )
            else:
                for name, property_schema in properties.items():
                    field = f"parameters.properties.{name}"
                    if not isinstance(property_schema, dict):
                        issues.append(
                            ValidationIssue(
                                code="invalid_property_schema",
                                message=f"{field} must be an object",
                                field=field,
                            )
                        )
                        continue
                    if property_schema.get("type") not in self.valid_types:
                        issues.append(
                            ValidationIssue(
                                code="invalid_property_type",
                                message=f"{field}.type must be a supported JSON schema type",
                                field=f"{field}.type",
                            )
                        )
            if not isinstance(parameters.get("required", []), list):
                issues.append(
                    ValidationIssue(
                        code="invalid_required",
                        message="tool schema parameters.required must be a list",
                        field="parameters.required",
                    )
                )
        success = not any(issue.severity == "error" for issue in issues)
        return ValidationReport(
            success=success,
            issues=issues,
            metadata={"validator": self.__class__.__name__, "tool": schema.get("name", "")},
        )
