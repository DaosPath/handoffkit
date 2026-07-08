"""Tests for JSON-schema-like contracts."""

from __future__ import annotations

from handoffkit import HandoffState, RunTrace, ValidationReport, tool


def assert_schema_shape(schema: dict) -> None:  # type: ignore[type-arg]
    """Assert common schema fields."""
    assert schema["type"] == "object"
    assert isinstance(schema["properties"], dict)
    assert isinstance(schema["required"], list)


def test_handoff_state_json_schema_shape() -> None:
    schema = HandoffState.json_schema()

    assert_schema_shape(schema)
    assert "task" in schema["required"]
    assert schema["properties"]["decisions"]["items"]["type"] == "string"


def test_validation_report_json_schema_shape() -> None:
    schema = ValidationReport.json_schema()

    assert_schema_shape(schema)
    assert "success" in schema["required"]
    assert schema["properties"]["issues"]["type"] == "array"


def test_run_trace_json_schema_shape() -> None:
    schema = RunTrace.json_schema()

    assert_schema_shape(schema)
    assert "run_id" in schema["required"]
    assert schema["properties"]["steps"]["type"] == "array"


def test_tool_schema_still_available() -> None:
    @tool
    def add(a: int, b: int) -> int:
        """Add two integers."""
        return a + b

    schema = add.to_schema()

    assert schema["parameters"]["type"] == "object"
    assert schema["parameters"]["properties"]["a"]["type"] == "integer"


def test_schema_titles_are_stable() -> None:
    assert HandoffState.json_schema()["title"] == "HandoffState"
    assert ValidationReport.json_schema()["title"] == "ValidationReport"
    assert RunTrace.json_schema()["title"] == "RunTrace"
