"""Structured output demo without external APIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from handoffkit import Agent, StructuredOutputSchema
from handoffkit.providers import BaseProvider

ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT / "reports"


class FakeProvider(BaseProvider):
    """Provider that returns valid structured JSON."""

    model = "fake-structured"

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Return deterministic JSON."""
        return json.dumps(
            {
                "title": "Calculator architecture",
                "summary": "Create a small CLI layer over pure calculator functions.",
                "next_steps": ["Define operations", "Add argparse CLI", "Write tests"],
                "success": True,
            }
        )


def main() -> None:
    """Run the structured output demo and write reports."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    schema = StructuredOutputSchema(
        name="TaskSummary",
        description="A structured task summary.",
        fields={
            "title": str,
            "summary": str,
            "next_steps": list,
            "success": bool,
        },
        required=["title", "summary", "success"],
    )
    agent = Agent(
        name="Reporter",
        role="Return structured task summaries.",
        provider=FakeProvider(),
    )
    result = agent.run_structured(
        "Create a concise architecture plan for a Python CLI calculator.",
        schema=schema,
    )

    markdown_path = REPORTS_DIR / "structured_output_demo.md"
    json_path = REPORTS_DIR / "structured_output_demo.json"
    markdown_path.write_text(result.to_markdown(), encoding="utf-8")
    json_path.write_text(result.to_json(), encoding="utf-8")

    print(f"Structured output success: {result.success}")
    print(f"Schema: {result.schema_name}")
    print(f"Repaired: {result.repaired}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
