"""Extension API demo."""

from __future__ import annotations

from pathlib import Path

from handoffkit import Agent, Extension, ExtensionRegistry, Recipe, RecipeRunner, RecipeStep, tool

ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT / "reports"


@tool
def uppercase_text(text: str) -> str:
    """Uppercase text."""
    return text.upper()


def main() -> None:
    """Create an extension, register it, and run one recipe."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    planner = Agent("ExtensionPlanner", "Plan extension-backed workflows.")
    reviewer = Agent("ExtensionReviewer", "Review extension-backed workflow output.")
    recipe = Recipe(
        name="extension-plan-review",
        description="A recipe bundled by an extension.",
        steps=[
            RecipeStep(name="plan", agent=planner, task="Plan a tiny extension workflow."),
            RecipeStep(name="review", agent=reviewer, task="Review the extension workflow."),
        ],
    )
    extension = Extension(
        name="local-demo",
        description="A local extension with one recipe and one tool.",
        version="0.1.0",
        recipes=[recipe],
        tools=[uppercase_text],
    )
    registry = ExtensionRegistry()
    registry.register(extension)

    result = RecipeRunner(registry.recipes()[0]).run(initial_task="Demonstrate extensions.")

    markdown_path = REPORTS_DIR / "extension_demo.md"
    json_path = REPORTS_DIR / "extension_demo.json"
    markdown_path.write_text(result.to_markdown(), encoding="utf-8")
    json_path.write_text(extension.to_json(), encoding="utf-8")

    print(f"Extensions: {[item.name for item in registry.list()]}")
    print(f"Recipes: {[item.name for item in registry.recipes()]}")
    print(f"Tools: {[item.name for item in registry.tools()]}")
    print(f"Run success: {result.success}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
