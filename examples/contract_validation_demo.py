"""Contract validation demo without external APIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from handoffkit import (
    HandoffState,
    HandoffStateValidator,
    StructuredOutputSchema,
    StructuredOutputValidator,
    ToolSchemaValidator,
    tool,
)

ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT / "reports"


@tool
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def build_state() -> HandoffState:
    """Build a deterministic valid handoff state."""
    return HandoffState(
        task="Create a Python CLI calculator.",
        from_agent="Architect",
        to_agent="Coder",
        summary="Architecture plan is ready for implementation.",
        decisions=["Use argparse.", "Return non-zero on invalid input."],
        important_files=["calculator.py"],
        next_steps=["Implement calculator.py", "Run pytest -q"],
        context_refs=["docs/calculator-contract.md"],
        metadata={"errors_checked": True},
    )


def _json_default(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


def main() -> None:
    """Validate handoff, structured output, and tool contracts."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    schema = StructuredOutputSchema(
        name="CalculatorPlan",
        fields={"title": str, "steps": list, "ready": bool},
        required=["title", "steps", "ready"],
    )
    reports = {
        "handoff": HandoffStateValidator().validate(build_state()),
        "structured_output": StructuredOutputValidator().validate(
            schema,
            {"title": "CLI calculator", "steps": ["implement", "test"], "ready": True},
        ),
        "tool_schema": ToolSchemaValidator().validate(add),
    }

    markdown = "# Contract Validation Demo\n\n" + "\n\n".join(
        f"## {name}\n\n{report.to_markdown()}" for name, report in reports.items()
    )
    payload = {name: report.to_dict() for name, report in reports.items()}

    markdown_path = REPORTS_DIR / "contract_validation_demo.md"
    json_path = REPORTS_DIR / "contract_validation_demo.json"
    markdown_path.write_text(markdown, encoding="utf-8")
    json_text = json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default)
    json_path.write_text(json_text, encoding="utf-8")

    print(f"Handoff validation: {reports['handoff'].success}")
    print(f"Structured output validation: {reports['structured_output'].success}")
    print(f"Tool schema validation: {reports['tool_schema'].success}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
