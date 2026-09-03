"""Async runtime tests."""

from __future__ import annotations

import asyncio

from handoffkit import Agent, HandoffProtocol, RecipeRunner, Team, WorkflowTemplate
from handoffkit.providers import BaseProvider


class StaticProvider(BaseProvider):
    """Simple sync provider for async fallback tests."""

    model = "static"

    def generate(self, prompt: str, **kwargs: object) -> str:
        return f"static:{prompt.splitlines()[0]}"


def test_base_provider_agenerate_uses_sync_fallback() -> None:
    provider = StaticProvider()

    output = asyncio.run(provider.agenerate("hello"))

    assert output == "static:hello"


def test_agent_arun_matches_sync_shape() -> None:
    agent = Agent("Planner", "Plan work.", provider=StaticProvider())

    output = asyncio.run(agent.arun("Prepare release."))

    assert output.startswith("static:Agent: Planner")


def test_team_arun_preserves_handoffs() -> None:
    team = Team(
        [Agent("Planner", "Plan."), Agent("Reviewer", "Review.")],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )

    result = asyncio.run(team.arun("Create a release checklist."))

    assert len(result.agent_outputs) == 2
    assert len(result.handoffs) == 1


def test_recipe_runner_arun_preserves_steps() -> None:
    recipe = WorkflowTemplate.plan_execute_review(
        name="async-review",
        task="Prepare a changelog.",
        planner=Agent("Planner", "Plan."),
        executor=Agent("Executor", "Execute."),
        reviewer=Agent("Reviewer", "Review."),
    )

    result = asyncio.run(RecipeRunner(recipe).arun())

    assert result.success is True
    assert len(result.step_results) == 3
    assert result.metadata["async"] is True
