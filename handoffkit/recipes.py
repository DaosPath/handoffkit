"""Reusable agent workflow recipes."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from handoffkit.agent import Agent
from handoffkit.context import ContextPack
from handoffkit.handoff import HandoffState
from handoffkit.memory import MemoryItem, MemoryStore
from handoffkit.protocol import HandoffProtocol
from handoffkit.structured import StructuredOutputSchema
from handoffkit.tool import Tool, ensure_tool
from handoffkit.tool_execution import ToolResult


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


def _agent_to_dict(agent: Agent | None) -> dict[str, Any] | None:
    """Serialize an agent without embedding provider internals."""
    if agent is None:
        return None
    return {
        "name": agent.name,
        "role": agent.role,
        "model": agent.model,
        "provider": agent.provider.__class__.__name__,
    }


@dataclass
class RecipeStep:
    """One reusable step in an agent workflow recipe."""

    name: str
    task: str
    agent: Agent | None = None
    tools: list[Tool | Callable[..., Any]] = field(default_factory=list)
    use_context: bool = False
    use_memory: bool = False
    structured_schema: StructuredOutputSchema | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this recipe step."""
        return {
            "name": self.name,
            "task": self.task,
            "agent": _agent_to_dict(self.agent),
            "tools": [ensure_tool(tool).to_dict() for tool in self.tools],
            "use_context": self.use_context,
            "use_memory": self.use_memory,
            "structured_schema": (
                self.structured_schema.to_dict()
                if self.structured_schema is not None
                else None
            ),
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this recipe step as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)


@dataclass
class Recipe:
    """Reusable workflow recipe made of ordered agent steps."""

    name: str
    description: str
    steps: list[RecipeStep]
    metadata: dict[str, Any] = field(default_factory=dict)

    def validate(self) -> Recipe:
        """Validate the recipe contract and return self."""
        problems: list[str] = []
        if not self.name.strip():
            problems.append("name must be a non-empty string")
        if not self.steps:
            problems.append("steps must not be empty")
        seen: set[str] = set()
        duplicates: set[str] = set()
        for step in self.steps:
            if not step.name.strip():
                problems.append("step name must be a non-empty string")
            if step.name in seen:
                duplicates.add(step.name)
            seen.add(step.name)
            if not step.task.strip():
                problems.append(f"step {step.name!r} task must be a non-empty string")
        if duplicates:
            problems.append(f"step names must be unique: {', '.join(sorted(duplicates))}")
        if problems:
            raise ValueError("; ".join(problems))
        return self

    def to_dict(self) -> dict[str, Any]:
        """Serialize this recipe."""
        return {
            "name": self.name,
            "description": self.description,
            "steps": [step.to_dict() for step in self.steps],
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this recipe as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize this recipe as Markdown."""
        steps = "\n".join(
            (
                f"- `{step.name}`: {step.task} "
                f"(agent={step.agent.name if step.agent else 'none'}, "
                f"context={step.use_context}, memory={step.use_memory}, tools={len(step.tools)})"
            )
            for step in self.steps
        )
        return (
            f"# Recipe: {self.name}\n\n"
            f"## Description\n\n{self.description}\n\n"
            f"## Steps\n\n{steps or '- none'}\n\n"
            "## Metadata\n\n```json\n"
            f"{json.dumps(self.metadata, indent=2, default=_json_default)}\n"
            "```\n"
        )


@dataclass
class RecipeRunResult:
    """Result returned by RecipeRunner."""

    recipe_name: str
    success: bool
    final_output: str
    step_results: list[dict[str, Any]] = field(default_factory=list)
    handoff_states: list[HandoffState] = field(default_factory=list)
    context_used: list[ContextPack] = field(default_factory=list)
    memories_used: list[MemoryItem] = field(default_factory=list)
    tool_results: list[ToolResult] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this recipe run result."""
        return {
            "recipe_name": self.recipe_name,
            "success": self.success,
            "final_output": self.final_output,
            "step_results": self.step_results,
            "handoff_states": [state.to_dict() for state in self.handoff_states],
            "context_used": [context.to_dict() for context in self.context_used],
            "memories_used": [memory.to_dict() for memory in self.memories_used],
            "tool_results": [result.to_dict() for result in self.tool_results],
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this recipe run result as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize this recipe run result as Markdown."""
        steps = "\n".join(
            f"- `{item['step_name']}` success={item['success']} agent={item.get('agent_name', '')}"
            for item in self.step_results
        )
        handoffs = "\n".join(
            f"- `{state.from_agent}` -> `{state.to_agent}`: {state.task}"
            for state in self.handoff_states
        )
        tools = "\n".join(
            f"- `{result.tool_name}` success={result.success} error={result.error or ''}"
            for result in self.tool_results
        )
        return (
            f"# Recipe Run: {self.recipe_name}\n\n"
            f"## Success\n\n{self.success}\n\n"
            f"## Final Output\n\n{self.final_output}\n\n"
            f"## Step Results\n\n{steps or '- none'}\n\n"
            f"## Handoffs\n\n{handoffs or '- none'}\n\n"
            f"## Tool Results\n\n{tools or '- none'}\n"
        )


class RecipeRunner:
    """Run a Recipe deterministically step by step."""

    def __init__(self, recipe: Recipe, *, protocol: HandoffProtocol | None = None) -> None:
        self.recipe = recipe.validate()
        self.protocol = protocol or HandoffProtocol(mode="hybrid_state")

    def run(
        self,
        initial_task: str | None = None,
        memory: MemoryStore | None = None,
        context: ContextPack | None = None,
        tools: Sequence[Tool | Callable[..., Any]] | None = None,
    ) -> RecipeRunResult:
        """Run the recipe and return a structured report."""
        step_results: list[dict[str, Any]] = []
        handoff_states: list[HandoffState] = []
        context_used: list[ContextPack] = []
        memories_used: list[MemoryItem] = []
        tool_results: list[ToolResult] = []
        previous_output = ""
        previous_state: HandoffState | None = None
        success = True

        for index, step in enumerate(self.recipe.steps):
            agent = step.agent or Agent(step.name, f"Execute recipe step {step.name}.")
            task = self._build_step_task(step, initial_task, previous_output, index)
            combined_tools = list(step.tools) + list(tools or [])
            output = ""
            step_success = True
            mode = "agent"
            structured_output: dict[str, Any] | None = None

            try:
                if step.structured_schema is not None:
                    structured_result = agent.run_structured(
                        task,
                        schema=step.structured_schema,
                        context=context if step.use_context else None,
                        memory=memory if step.use_memory else None,
                    )
                    output = structured_result.to_json()
                    structured_output = structured_result.to_dict()
                    step_success = structured_result.success
                    mode = "structured"
                elif combined_tools:
                    report = agent.run_with_tools(task, tools=combined_tools)
                    output = report.final_output
                    step_success = report.success
                    tool_results.extend(report.tool_results)
                    mode = "tools"
                elif step.use_context:
                    context_result = agent.run_with_context(
                        task,
                        context=context,
                        memory=memory if step.use_memory else None,
                    )
                    output = context_result.final_output
                    step_success = context_result.success
                    if context_result.context_used is not None:
                        context_used.append(context_result.context_used)
                    memories_used.extend(context_result.memories_used)
                    mode = "context"
                else:
                    output = agent.run(task, handoff_state=previous_state)
            except Exception as exc:
                output = str(exc)
                step_success = False
                success = False

            step_results.append(
                {
                    "step_name": step.name,
                    "agent_name": agent.name,
                    "task": task,
                    "output": output,
                    "success": step_success,
                    "mode": mode,
                    "structured_output": structured_output,
                    "metadata": step.metadata,
                }
            )
            success = success and step_success

            next_step = self.recipe.steps[index + 1] if index + 1 < len(self.recipe.steps) else None
            if next_step is not None:
                next_agent = next_step.agent or Agent(
                    next_step.name,
                    f"Execute recipe step {next_step.name}.",
                )
                state = self.protocol.transfer(
                    from_agent=agent,
                    to_agent=next_agent,
                    task=next_step.task,
                    summary=output,
                    decisions=[f"Step {step.name} completed with success={step_success}."],
                    next_steps=[next_step.task],
                    context_refs=[
                        doc.path
                        for doc in (context.documents if context is not None else [])
                    ],
                    metadata={
                        "recipe": self.recipe.name,
                        "from_step": step.name,
                        "to_step": next_step.name,
                    },
                )
                handoff_states.append(state)
                previous_state = state
            previous_output = output

        final_output = step_results[-1]["output"] if step_results else ""
        return RecipeRunResult(
            recipe_name=self.recipe.name,
            success=success,
            final_output=final_output,
            step_results=step_results,
            handoff_states=handoff_states,
            context_used=context_used,
            memories_used=memories_used,
            tool_results=tool_results,
            metadata={"step_count": len(self.recipe.steps)},
        )

    def _build_step_task(
        self,
        step: RecipeStep,
        initial_task: str | None,
        previous_output: str,
        index: int,
    ) -> str:
        parts = []
        if index == 0 and initial_task:
            parts.append(f"Initial task: {initial_task}")
        if previous_output:
            parts.append(f"Previous output: {previous_output}")
        parts.append(f"Step task: {step.task}")
        return "\n\n".join(parts)


class WorkflowTemplate:
    """Factory helpers for common reusable workflow recipes."""

    @staticmethod
    def sequential(
        *,
        name: str,
        agents: Sequence[Agent],
        task: str,
        description: str = "Sequential multi-agent workflow.",
    ) -> Recipe:
        """Create one step per agent in order."""
        steps = [
            RecipeStep(
                name=agent.name.lower().replace(" ", "-"),
                agent=agent,
                task=task if index == 0 else f"Continue workflow for: {task}",
            )
            for index, agent in enumerate(agents)
        ]
        return Recipe(name=name, description=description, steps=steps)

    @staticmethod
    def review(
        *,
        name: str,
        subject: str,
        reviewer: Agent,
        author: Agent | None = None,
    ) -> Recipe:
        """Create a simple author/reviewer recipe."""
        steps = []
        if author is not None:
            steps.append(RecipeStep(name="draft", agent=author, task=f"Draft work for: {subject}"))
        steps.append(RecipeStep(name="review", agent=reviewer, task=f"Review: {subject}"))
        return Recipe(name=name, description="Reusable review workflow.", steps=steps)

    @staticmethod
    def plan_execute_review(
        *,
        name: str,
        task: str,
        planner: Agent,
        executor: Agent,
        reviewer: Agent,
    ) -> Recipe:
        """Create a planner -> executor -> reviewer recipe."""
        return Recipe(
            name=name,
            description="Plan, execute, and review a task.",
            steps=[
                RecipeStep(name="plan", agent=planner, task=f"Create a plan for: {task}"),
                RecipeStep(name="execute", agent=executor, task=f"Execute the plan for: {task}"),
                RecipeStep(name="review", agent=reviewer, task=f"Review the result for: {task}"),
            ],
        )
