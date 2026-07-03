"""Tests for reusable validation reports."""

from __future__ import annotations

import json

import pytest

from handoffkit import (
    HandoffState,
    HandoffStateValidator,
    StructuredOutputSchema,
    StructuredOutputValidator,
    ToolSchemaValidator,
    ValidationIssue,
    ValidationReport,
    tool,
)


def valid_state() -> HandoffState:
    """Return a valid handoff state."""
    return HandoffState(
        task="Build package",
        from_agent="Architect",
        to_agent="Coder",
        summary="Plan complete and ready for implementation.",
        decisions=["Use dataclasses."],
        important_files=["pyproject.toml"],
        next_steps=["Run pytest -q"],
        metadata={"errors_checked": True},
    )


def test_validation_issue_and_report_serialization() -> None:
    issue = ValidationIssue("missing", "missing field", field="task")
    report = ValidationReport(False, [issue], metadata={"kind": "demo"})

    assert issue.to_dict()["field"] == "task"
    assert json.loads(report.to_json())["issues"][0]["code"] == "missing"
    assert "missing field" in report.to_markdown()
    with pytest.raises(ValueError, match="missing field"):
        report.raise_if_failed()


def test_handoff_state_validator_success() -> None:
    report = HandoffStateValidator().validate(valid_state())

    assert report.success is True
    assert report.errors == []


def test_handoff_state_validator_error_and_warning() -> None:
    state = HandoffState(task="", from_agent="Architect", to_agent="Coder")
    report = HandoffStateValidator().validate(state)

    assert report.success is False
    assert any(issue.code == "required_text" for issue in report.errors)
    assert any(issue.code == "empty_summary" for issue in report.warnings)


def test_handoff_state_validate_report_keeps_validate_compatibility() -> None:
    state = valid_state()

    assert state.validate_report().success is True
    assert state.validate() is state


def test_structured_output_validator_success_and_failure() -> None:
    schema = StructuredOutputSchema(
        name="Plan",
        fields={"title": str, "ready": bool},
        required=["title", "ready"],
    )

    success = StructuredOutputValidator().validate(schema, {"title": "Demo", "ready": True})
    failure = schema.validate_report({"title": "Demo", "ready": "yes"})

    assert success.success is True
    assert failure.success is False
    assert failure.errors[0].field == "ready"


def test_tool_schema_validator_success_and_failure() -> None:
    @tool
    def add(a: int, b: int) -> int:
        """Add two integers."""
        return a + b

    success = ToolSchemaValidator().validate(add)
    failure = ToolSchemaValidator().validate(
        {"name": "bad", "parameters": {"type": "object", "properties": {"x": {}}}}
    )

    assert success.success is True
    assert failure.success is False
    assert failure.errors[0].code == "invalid_property_type"
