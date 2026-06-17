"""Command-line interface."""

from __future__ import annotations

import argparse
import json

from handoffkit import __version__
from handoffkit.agent import Agent
from handoffkit.builtins import plan_execute_review_recipe
from handoffkit.extensions import Extension, ExtensionRegistry
from handoffkit.protocol import HandoffProtocol
from handoffkit.provider_adapters import ProviderToolAdapter
from handoffkit.providers import BaseProvider
from handoffkit.recipes import RecipeRunner
from handoffkit.runner import Team
from handoffkit.structured import StructuredOutputSchema
from handoffkit.tool import tool
from handoffkit.tool_execution import ToolRegistry


class _StaticProvider(BaseProvider):
    """Small CLI-only provider for deterministic demos."""

    model = "static"

    def __init__(self, output: str) -> None:
        self.output = output

    def generate(self, prompt: str, **kwargs) -> str:  # type: ignore[no-untyped-def]
        """Return preconfigured output."""
        return self.output


def run_demo() -> str:
    """Run a local demo using EchoProvider."""
    architect = Agent("Architect", "Analyze projects and create technical plans")
    coder = Agent("Coder", "Write code based on received handoff state")
    tester = Agent("Tester", "Test implementation and report errors")
    team = Team(
        agents=[architect, coder, tester],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    result = team.run("Create a small Python CLI calculator with tests")
    return (
        "HandoffKit demo\n"
        "Protocol: hybrid_state\n"
        f"Agents: {', '.join(agent.name for agent in team.agents)}\n"
        f"Handoffs: {len(result.handoffs)}\n"
        f"Final output:\n{result.final_output}"
    )


def run_recipe_demo() -> str:
    """Run a local built-in recipe demo."""
    recipe = plan_execute_review_recipe()
    result = RecipeRunner(recipe).run(initial_task="Create a short local release checklist.")
    return result.to_markdown()


def run_extension_demo() -> str:
    """Run a local extension registry demo."""

    @tool
    def echo_label(label: str) -> str:
        """Return a label for demo purposes."""
        return f"label:{label}"

    recipe = plan_execute_review_recipe()
    extension = Extension(
        name="demo",
        description="Local demo extension.",
        version="0.1.0",
        recipes=[recipe],
        tools=[echo_label],
    )
    registry = ExtensionRegistry()
    registry.register(extension)
    result = RecipeRunner(registry.recipes()[0]).run(initial_task="Show extension workflow.")
    return (
        "HandoffKit extension demo\n"
        f"Extensions: {[item.name for item in registry.list()]}\n"
        f"Recipes: {[item.name for item in registry.recipes()]}\n"
        f"Tools: {[item.name for item in registry.tools()]}\n\n"
        f"{result.to_markdown()}"
    )


def run_structured_demo() -> str:
    """Run a local structured output demo."""
    schema = StructuredOutputSchema(
        name="TaskSummary",
        description="A concise structured task summary.",
        fields={"title": str, "summary": str, "success": bool},
        required=["title", "summary", "success"],
    )
    provider = _StaticProvider(
        json.dumps(
            {
                "title": "Structured demo",
                "summary": "HandoffKit validated JSON from a provider response.",
                "success": True,
            }
        )
    )
    agent = Agent("Reporter", "Return structured summaries.", provider=provider)
    result = agent.run_structured("Summarize the structured demo.", schema=schema)
    return result.to_markdown()


def run_provider_tools_demo() -> str:
    """Run a local provider tool adapter demo."""

    @tool
    def label(value: str) -> str:
        """Label a value."""
        return f"label:{value}"

    adapter = ProviderToolAdapter()
    registry = ToolRegistry([label])
    response = {
        "tool_calls": [
            {"function": {"name": "label", "arguments": '{"value":"demo"}'}},
        ]
    }
    calls = adapter.parse_tool_calls(response)
    results = [registry.execute(call) for call in calls]
    return (
        "HandoffKit provider tool adapter demo\n"
        f"Tool schemas: {len(adapter.tools_to_provider_format([label]))}\n"
        f"Tool calls: {[call.tool_name for call in calls]}\n"
        f"Tool results: {[result.to_dict() for result in results]}"
    )


def main(argv: list[str] | None = None) -> int:
    """Run the command-line interface."""
    parser = argparse.ArgumentParser(prog="handoffkit")
    parser.add_argument("--version", action="version", version=f"handoffkit {__version__}")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("demo", help="Run a local EchoProvider demo.")
    subparsers.add_parser("demo-recipe", help="Run a local recipe demo.")
    subparsers.add_parser("demo-extension", help="Run a local extension demo.")
    subparsers.add_parser("demo-structured", help="Run a local structured output demo.")
    subparsers.add_parser("demo-provider-tools", help="Run a local provider tool adapter demo.")
    args = parser.parse_args(argv)

    if args.command == "demo":
        print(run_demo())
        return 0
    if args.command == "demo-recipe":
        print(run_recipe_demo())
        return 0
    if args.command == "demo-extension":
        print(run_extension_demo())
        return 0
    if args.command == "demo-structured":
        print(run_structured_demo())
        return 0
    if args.command == "demo-provider-tools":
        print(run_provider_tools_demo())
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
