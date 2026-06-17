"""Tests for structured outputs."""

from __future__ import annotations

import json
from typing import Any

import pytest

from handoffkit import (
    Agent,
    JsonOutputParser,
    OutputRepairer,
    OutputValidationError,
    StructuredOutputResult,
    StructuredOutputSchema,
)
from handoffkit.providers import BaseProvider


class FakeProvider(BaseProvider):
    """Fake provider for structured tests."""

    model = "fake"

    def __init__(self, output: str) -> None:
        self.output = output

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Return configured output."""
        return self.output


def schema() -> StructuredOutputSchema:
    """Return a reusable test schema."""
    return StructuredOutputSchema(
        name="TaskSummary",
        description="A structured task summary.",
        fields={"title": str, "summary": str, "next_steps": list, "success": bool},
        required=["title", "summary", "success"],
    )


def test_structured_output_schema_to_dict_and_json_schema() -> None:
    item = schema()

    assert item.to_dict()["fields"]["title"] == "str"
    assert item.to_json_schema()["properties"]["success"]["type"] == "boolean"


def test_structured_output_schema_validate_success() -> None:
    data = {"title": "Demo", "summary": "Done", "success": True}

    assert schema().validate(data) is data


def test_structured_output_schema_validate_missing_required() -> None:
    with pytest.raises(OutputValidationError, match="missing required field"):
        schema().validate({"title": "Demo", "success": True})


def test_structured_output_schema_validate_wrong_type() -> None:
    with pytest.raises(OutputValidationError, match="expected bool"):
        schema().validate({"title": "Demo", "summary": "Done", "success": "yes"})


def test_structured_output_result_serialization() -> None:
    result = StructuredOutputResult(
        success=True,
        data={"title": "Demo"},
        raw_output='{"title":"Demo"}',
        errors=[],
        schema_name="TaskSummary",
        repaired=False,
    )

    assert json.loads(result.to_json())["success"] is True
    assert "Structured Output: TaskSummary" in result.to_markdown()


def test_json_output_parser_clean_json() -> None:
    parsed = JsonOutputParser().parse('{"title": "Demo", "success": true}')

    assert parsed["title"] == "Demo"


def test_json_output_parser_markdown_fenced_json() -> None:
    parsed = JsonOutputParser().parse('```json\n{"title": "Demo", "success": true}\n```')

    assert parsed["success"] is True


def test_json_output_parser_json_embedded_in_text() -> None:
    parsed = JsonOutputParser().parse('Here is the result:\n{"title": "Demo", "success": true}')

    assert parsed["title"] == "Demo"


def test_output_repairer_simple_repairs() -> None:
    repaired = OutputRepairer().repair(
        "Result:\n{'title': 'Demo', 'summary': 'Done', 'success': True,}"
    )

    assert json.loads(repaired)["success"] is True


def test_agent_run_structured_success_with_fake_provider() -> None:
    agent = Agent(
        "Reporter",
        "Return JSON.",
        provider=FakeProvider('{"title":"Demo","summary":"Done","success":true}'),
    )

    result = agent.run_structured("Summarize.", schema())

    assert result.success is True
    assert result.data is not None
    assert result.data["title"] == "Demo"


def test_agent_run_structured_invalid_json() -> None:
    agent = Agent("Reporter", "Return JSON.", provider=FakeProvider("not json"))

    result = agent.run_structured("Summarize.", schema(), max_repair_attempts=0)

    assert result.success is False
    assert result.errors


def test_agent_run_structured_repair_success() -> None:
    agent = Agent(
        "Reporter",
        "Return JSON.",
        provider=FakeProvider("{'title':'Demo','summary':'Done','success':True}"),
    )

    result = agent.run_structured("Summarize.", schema())

    assert result.success is True
    assert result.repaired is True
