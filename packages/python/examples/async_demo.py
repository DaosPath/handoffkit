"""Async runtime demo."""

from __future__ import annotations

import asyncio

from handoffkit import Agent, HandoffProtocol, RecipeRunner, Team, WorkflowTemplate


async def main() -> None:
    """Run async team and recipe workflows offline."""
    team = Team(
        agents=[
            Agent("Planner", "Plan work."),
            Agent("Reviewer", "Review handoffs."),
        ],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    team_result = await team.arun("Prepare a release checklist.")

    recipe = WorkflowTemplate.plan_execute_review(
        name="async-plan-execute-review",
        task="Create a short changelog.",
        planner=Agent("Planner", "Plan."),
        executor=Agent("Executor", "Execute."),
        reviewer=Agent("Reviewer", "Review."),
    )
    recipe_result = await RecipeRunner(recipe).arun()

    print("HandoffKit async demo")
    print(f"Team handoffs: {len(team_result.handoffs)}")
    print(f"Recipe success: {recipe_result.success}")


if __name__ == "__main__":
    asyncio.run(main())
