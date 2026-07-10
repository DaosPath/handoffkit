from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from handoffkit import (
    Agent,
    ContextDocument,
    ContextPack,
    Extension,
    ExtensionRegistry,
    MemoryStore,
    Recipe,
    RecipeRunner,
    RecipeRunResult,
    RecipeStep,
    StructuredOutputSchema,
    WorkflowTemplate,
    tool,
)
from handoffkit.providers import BaseProvider
from handoffkit.recipes.builtins import (
    coding_review_recipe,
    plan_execute_review_recipe,
    research_summary_recipe,
)

ROOT = Path(__file__).resolve().parents[1]


class StructuredRecipeProvider(BaseProvider):
    """Fake structured provider for recipe tests."""

    model = "structured-recipe-fake"

    def generate(self, prompt: str, **kwargs) -> str:  # type: ignore[no-untyped-def]
        """Return valid structured JSON."""
        return '{"title":"Plan","summary":"Done","success":true}'


def test_recipe_step_serialization() -> None:
    step = RecipeStep(
        name="plan",
        agent=Agent("Planner", "Plan work."),
        task="Create a plan.",
        use_context=True,
        metadata={"order": 1},
    )

    payload = json.loads(step.to_json())

    assert payload["name"] == "plan"
    assert payload["agent"]["name"] == "Planner"
    assert payload["use_context"] is True
    assert payload["metadata"]["order"] == 1


def test_recipe_validation_and_serialization() -> None:
    recipe = Recipe(
        name="demo",
        description="Demo recipe.",
        steps=[RecipeStep(name="plan", agent=Agent("Planner", "Plan."), task="Plan.")],
    )

    assert recipe.validate() is recipe
    assert recipe.to_dict()["name"] == "demo"
    assert "Recipe: demo" in recipe.to_markdown()
    assert json.loads(recipe.to_json())["steps"][0]["name"] == "plan"


def test_recipe_validation_rejects_duplicate_steps() -> None:
    recipe = Recipe(
        name="bad",
        description="Bad recipe.",
        steps=[
            RecipeStep(name="same", task="First."),
            RecipeStep(name="same", task="Second."),
        ],
    )

    with pytest.raises(ValueError, match="unique"):
        recipe.validate()


def test_recipe_runner_sequential_execution() -> None:
    recipe = WorkflowTemplate.sequential(
        name="seq",
        agents=[Agent("Planner", "Plan."), Agent("Reviewer", "Review.")],
        task="Prepare a note.",
    )

    result = RecipeRunner(recipe).run(initial_task="Prepare release note.")

    assert result.success is True
    assert len(result.step_results) == 2
    assert len(result.handoff_states) == 1
    assert result.final_output


def test_recipe_runner_with_context() -> None:
    recipe = Recipe(
        name="context-recipe",
        description="Use context.",
        steps=[
            RecipeStep(
                name="inspect",
                agent=Agent("Inspector", "Inspect context."),
                task="Inspect calculator context.",
                use_context=True,
            )
        ],
    )
    context = ContextPack(
        query="calculator",
        documents=[ContextDocument(path="calculator.py", content="def add(): pass")],
    )

    result = RecipeRunner(recipe).run(context=context)

    assert result.success is True
    assert result.context_used == [context]


def test_recipe_runner_with_memory() -> None:
    memory = MemoryStore()
    memory.add("Calculator uses argparse.", kind="decision")
    recipe = Recipe(
        name="memory-recipe",
        description="Use memory.",
        steps=[
            RecipeStep(
                name="remember",
                agent=Agent("MemoryAgent", "Use memory."),
                task="Plan calculator argparse behavior.",
                use_context=True,
                use_memory=True,
            )
        ],
    )

    result = RecipeRunner(recipe).run(memory=memory)

    assert result.success is True
    assert len(result.memories_used) == 1


def test_recipe_runner_with_tools() -> None:
    @tool
    def read_file(path: str) -> str:
        """Read a file."""
        return Path(path).read_text(encoding="utf-8")

    sample = ROOT / "README.md"
    recipe = Recipe(
        name="tool-recipe",
        description="Use tools.",
        steps=[
            RecipeStep(
                name="read",
                agent=Agent("ToolAgent", "Use tools."),
                task=f"read file {sample}",
                tools=[read_file],
            )
        ],
    )

    result = RecipeRunner(recipe).run()

    assert result.success is True
    assert result.tool_results[0].success is True


def test_recipe_runner_with_structured_step() -> None:
    schema = StructuredOutputSchema(
        name="StepSummary",
        fields={"title": str, "summary": str, "success": bool},
        required=["title", "summary", "success"],
    )
    recipe = Recipe(
        name="structured-recipe",
        description="Structured step.",
        steps=[
            RecipeStep(
                name="plan",
                agent=Agent(
                    "Planner",
                    "Plan.",
                    provider=StructuredRecipeProvider(),
                ),
                task="Plan work.",
                structured_schema=schema,
            )
        ],
    )

    result = RecipeRunner(recipe).run()

    assert result.success is True
    assert result.step_results[0]["mode"] == "structured"
    assert result.step_results[0]["structured_output"]["data"]["title"] == "Plan"


def test_recipe_run_result_serialization() -> None:
    result = RecipeRunResult(
        recipe_name="demo",
        success=True,
        final_output="Done",
        step_results=[{"step_name": "plan", "success": True}],
    )

    assert result.to_dict()["recipe_name"] == "demo"
    assert json.loads(result.to_json())["final_output"] == "Done"
    assert "Recipe Run: demo" in result.to_markdown()


def test_workflow_template_plan_execute_review() -> None:
    recipe = WorkflowTemplate.plan_execute_review(
        name="per",
        task="Build calculator.",
        planner=Agent("Planner", "Plan."),
        executor=Agent("Executor", "Execute."),
        reviewer=Agent("Reviewer", "Review."),
    )

    assert [step.name for step in recipe.steps] == ["plan", "execute", "review"]


def test_workflow_template_review() -> None:
    recipe = WorkflowTemplate.review(
        name="review",
        subject="A proposal.",
        author=Agent("Author", "Draft."),
        reviewer=Agent("Reviewer", "Review."),
    )

    assert [step.name for step in recipe.steps] == ["draft", "review"]


def test_extension_serialization_and_registry() -> None:
    @tool
    def label(value: str) -> str:
        """Label a value."""
        return f"label:{value}"

    recipe = plan_execute_review_recipe()
    extension = Extension(
        name="coding",
        description="Coding extension.",
        version="0.1.0",
        recipes=[recipe],
        tools=[label],
    )
    registry = ExtensionRegistry()
    registry.register(extension)

    assert json.loads(extension.to_json())["name"] == "coding"
    assert registry.get("coding") is extension
    assert registry.list() == [extension]
    assert registry.recipes() == [recipe]
    assert registry.tools()[0].name == "label"


def test_extension_registry_rejects_duplicate_names() -> None:
    registry = ExtensionRegistry()
    extension = Extension(name="demo", description="Demo.", version="0.1.0")
    registry.register(extension)

    with pytest.raises(ValueError, match="already registered"):
        registry.register(extension)


def test_built_in_recipes_create_valid_recipes() -> None:
    for recipe in [
        coding_review_recipe(),
        research_summary_recipe(),
        plan_execute_review_recipe(),
    ]:
        assert recipe.validate() is recipe
        assert recipe.steps


@pytest.mark.parametrize(
    "script_name",
    [
        "recipe_demo.py",
        "coding_review_recipe.py",
        "extension_demo.py",
        "structured_output_demo.py",
        "provider_tool_adapter_demo.py",
        "structured_recipe_demo.py",
    ],
)
def test_recipe_examples_run(script_name: str) -> None:
    completed = subprocess.run(
        [sys.executable, str(ROOT / "examples" / script_name)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
