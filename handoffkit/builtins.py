"""Built-in recipe factories."""

from __future__ import annotations

from handoffkit.agent import Agent
from handoffkit.recipes import Recipe, RecipeStep, WorkflowTemplate


def coding_review_recipe() -> Recipe:
    """Return a generic coding review recipe without Git-specific logic."""
    reader = Agent("CodeReader", "Read code context and identify relevant behavior.")
    reviewer = Agent("CodeReviewer", "Review code for correctness, clarity, and tests.")
    reporter = Agent("ReviewReporter", "Summarize findings and recommended next steps.")
    return Recipe(
        name="coding-review",
        description="Review local code context with a general multi-agent workflow.",
        steps=[
            RecipeStep(
                name="read-context",
                agent=reader,
                task="Read the provided code context.",
                use_context=True,
            ),
            RecipeStep(
                name="review",
                agent=reviewer,
                task="Review behavior, risks, and missing tests.",
                use_context=True,
            ),
            RecipeStep(name="report", agent=reporter, task="Write concise review findings."),
        ],
        metadata={"domain": "coding", "core_specificity": "general"},
    )


def research_summary_recipe() -> Recipe:
    """Return a generic research summary recipe."""
    collector = Agent("ResearchCollector", "Collect and organize provided context.")
    synthesizer = Agent("ResearchSynthesizer", "Create concise summaries from context.")
    reviewer = Agent("ResearchReviewer", "Check clarity and remaining questions.")
    return Recipe(
        name="research-summary",
        description="Summarize provided research context without external APIs.",
        steps=[
            RecipeStep(
                name="collect",
                agent=collector,
                task="Identify key facts from the provided context.",
                use_context=True,
            ),
            RecipeStep(
                name="synthesize",
                agent=synthesizer,
                task="Write a concise research summary.",
                use_context=True,
            ),
            RecipeStep(
                name="review",
                agent=reviewer,
                task="Review the summary and list open questions.",
            ),
        ],
        metadata={"domain": "research"},
    )


def plan_execute_review_recipe() -> Recipe:
    """Return a generic plan -> execute -> review recipe."""
    planner = Agent("Planner", "Plan the task.")
    executor = Agent("Executor", "Execute the plan.")
    reviewer = Agent("Reviewer", "Review the result.")
    return WorkflowTemplate.plan_execute_review(
        name="plan-execute-review",
        task="Complete a small local task with evidence.",
        planner=planner,
        executor=executor,
        reviewer=reviewer,
    )
