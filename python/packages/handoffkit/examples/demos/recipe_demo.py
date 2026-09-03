"""Reusable recipe demo."""

from __future__ import annotations

from pathlib import Path

from handoffkit import Agent, Recipe, RecipeRunner, RecipeStep

ROOT = Path(__file__).resolve().parents[2]
REPORTS_DIR = ROOT / "reports"


def main() -> None:
    """Run a three-step recipe and write reports."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    planner = Agent(name="Planner", role="Plan the task.")
    executor = Agent(name="Executor", role="Execute the plan.")
    reviewer = Agent(name="Reviewer", role="Review the result.")

    recipe = Recipe(
        name="plan-execute-review",
        description="A reusable three-step workflow.",
        steps=[
            RecipeStep(name="plan", agent=planner, task="Create a release checklist."),
            RecipeStep(name="execute", agent=executor, task="Execute the checklist locally."),
            RecipeStep(name="review", agent=reviewer, task="Review the result."),
        ],
    )
    result = RecipeRunner(recipe).run(initial_task="Prepare a local package release.")

    markdown_path = REPORTS_DIR / "recipe_demo.md"
    json_path = REPORTS_DIR / "recipe_demo.json"
    markdown_path.write_text(result.to_markdown(), encoding="utf-8")
    json_path.write_text(result.to_json(), encoding="utf-8")

    print(f"Recipe: {result.recipe_name}")
    print(f"Success: {result.success}")
    print(f"Steps: {len(result.step_results)}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
