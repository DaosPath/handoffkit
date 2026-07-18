"""Structured output with a recipe-style workflow."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from handoffkit import Agent, Recipe, RecipeRunner, RecipeStep, StructuredOutputSchema
from handoffkit.providers import BaseProvider

ROOT = Path(__file__).resolve().parents[2]
REPORTS_DIR = ROOT / "reports"


class StructuredStepProvider(BaseProvider):
    """Provider that returns structured planning JSON."""

    model = "fake-structured-recipe"

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Return deterministic JSON."""
        return json.dumps(
            {
                "title": "Recipe plan",
                "summary": "Plan the work, execute it, then review the result.",
                "success": True,
            }
        )


def main() -> None:
    """Run structured output before a recipe and write reports."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    schema = StructuredOutputSchema(
        name="RecipeStepSummary",
        fields={"title": str, "summary": str, "success": bool},
        required=["title", "summary", "success"],
    )
    planner = Agent(
        "StructuredPlanner",
        "Create structured plans.",
        provider=StructuredStepProvider(),
    )
    reviewer = Agent("RecipeReviewer", "Review structured workflow output.")
    recipe = Recipe(
        name="structured-plan-review",
        description="Produce structured output in one recipe step, then review it.",
        steps=[
            RecipeStep(
                name="structured-plan",
                agent=planner,
                task="Plan a small workflow with structured output.",
                structured_schema=schema,
            ),
            RecipeStep(
                name="review",
                agent=reviewer,
                task="Review the structured summary from the previous step.",
            )
        ],
    )
    recipe_result = RecipeRunner(recipe).run(initial_task="Review structured output.")
    structured = recipe_result.step_results[0]["structured_output"]
    report = {
        "structured_output": structured,
        "recipe_result": recipe_result.to_dict(),
    }

    markdown = (
        "# Structured Recipe Demo\n\n"
        "## Structured Output\n\n```json\n"
        f"{json.dumps(structured, ensure_ascii=False, indent=2)}\n"
        "```\n\n"
        f"## Recipe Result\n\n{recipe_result.to_markdown()}\n"
    )
    markdown_path = REPORTS_DIR / "structured_recipe_demo.md"
    json_path = REPORTS_DIR / "structured_recipe_demo.json"
    markdown_path.write_text(markdown, encoding="utf-8")
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Structured success: {structured['success']}")
    print(f"Recipe success: {recipe_result.success}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
