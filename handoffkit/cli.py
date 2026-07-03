"""Command-line interface."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import platform
import sys
from pathlib import Path

from handoffkit import __version__
from handoffkit.agent import Agent
from handoffkit.builtins import plan_execute_review_recipe
from handoffkit.evaluation import WorkflowEvaluator
from handoffkit.extensions import Extension, ExtensionRegistry
from handoffkit.handoff import HandoffState
from handoffkit.protocol import HandoffProtocol
from handoffkit.provider_adapters import ProviderToolAdapter
from handoffkit.providers import BaseProvider
from handoffkit.quality import HandoffQualityEvaluator
from handoffkit.recipes import RecipeRunner
from handoffkit.replay import ReplayRunner
from handoffkit.reports import load_report_json
from handoffkit.runner import Team
from handoffkit.showcases import load_showcase_report, run_showcase
from handoffkit.structured import StructuredOutputSchema
from handoffkit.templates import TemplateScaffolder
from handoffkit.tool import tool
from handoffkit.tool_execution import ToolRegistry
from handoffkit.tracing import RunTrace
from handoffkit.validation import (
    HandoffStateValidator,
    StructuredOutputValidator,
    ToolSchemaValidator,
)


class _StaticProvider(BaseProvider):
    """Small CLI-only provider for deterministic demos."""

    model = "static"

    def __init__(self, output: str) -> None:
        self.output = output

    def generate(self, prompt: str, **kwargs) -> str:  # type: ignore[no-untyped-def]
        """Return preconfigured output."""
        return self.output


def _demo_handoff_state() -> HandoffState:
    return HandoffState(
        task="Create a Python CLI calculator.",
        from_agent="Architect",
        to_agent="Coder",
        summary="Build a dependency-free argparse calculator with pure operations and tests.",
        decisions=["Use argparse for CLI parsing.", "Keep math operations in pure functions."],
        important_files=["calculator.py", "test_calculator.py"],
        next_steps=["Implement calculator.py", "Write pytest coverage", "Run pytest -q"],
        context_refs=["README.md#real-task-demo"],
        metadata={"errors_checked": True},
    )


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


def run_async_demo() -> str:
    """Run a local async runtime demo."""

    async def _run() -> str:
        team = Team(
            agents=[
                Agent("Planner", "Plan async work."),
                Agent("Reviewer", "Review async handoffs."),
            ],
            protocol=HandoffProtocol(mode="hybrid_state"),
        )
        result = await team.arun("Create a short async release checklist.")
        return (
            "HandoffKit async demo\n"
            f"Agents: {', '.join(agent.name for agent in team.agents)}\n"
            f"Handoffs: {len(result.handoffs)}\n"
            f"Final output:\n{result.final_output}"
        )

    return asyncio.run(_run())


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


def run_quality_demo() -> str:
    """Run a local handoff quality demo."""
    report = HandoffQualityEvaluator().evaluate(_demo_handoff_state())
    return "HandoffKit quality demo\n\n" + report.to_markdown()


def run_validators_demo() -> str:
    """Run local contract validator demos."""

    @tool
    def add(a: int, b: int) -> int:
        """Add two integers."""
        return a + b

    schema = StructuredOutputSchema(
        name="CalculatorPlan",
        fields={"title": str, "steps": list, "ready": bool},
        required=["title", "steps", "ready"],
    )
    state_report = HandoffStateValidator().validate(_demo_handoff_state())
    output_report = StructuredOutputValidator().validate(
        schema,
        {"title": "CLI calculator", "steps": ["implement", "test"], "ready": True},
    )
    tool_report = ToolSchemaValidator().validate(add)
    return (
        "HandoffKit contract validators demo\n"
        f"HandoffState: {state_report.success}\n"
        f"StructuredOutput: {output_report.success}\n"
        f"ToolSchema: {tool_report.success}\n\n"
        f"{state_report.to_markdown()}"
    )


def run_provider_formats_demo() -> str:
    """Run local provider tool format demo."""

    @tool
    def add(a: int, b: int) -> int:
        """Add two integers."""
        return a + b

    openai_adapter = ProviderToolAdapter(provider_format="openai")
    anthropic_adapter = ProviderToolAdapter(provider_format="anthropic")
    openai_call = openai_adapter.parse_tool_calls(
        {
            "tool_calls": [
                {
                    "id": "call_openai_1",
                    "type": "function",
                    "function": {"name": "add", "arguments": '{"a":2,"b":3}'},
                }
            ]
        }
    )[0]
    anthropic_call = anthropic_adapter.parse_tool_calls(
        {
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "add",
                    "input": {"a": 5, "b": 8},
                }
            ]
        }
    )[0]
    openai_schema = openai_adapter.tools_to_provider_format([add])[0]
    anthropic_schema = anthropic_adapter.tools_to_provider_format([add])[0]
    return (
        "HandoffKit provider tool formats demo\n"
        f"OpenAI schema type: {openai_schema['type']}\n"
        f"Anthropic schema keys: {sorted(anthropic_schema)}\n"
        f"OpenAI call: {openai_call.tool_name} {openai_call.arguments} "
        f"id={openai_call.call_id}\n"
        f"Anthropic call: {anthropic_call.tool_name} {anthropic_call.arguments} "
        f"id={anthropic_call.call_id}"
    )


def run_doctor() -> str:
    """Run local package diagnostics without network access."""
    checks = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "handoffkit": __version__,
        "build_installed": importlib.util.find_spec("build") is not None,
        "twine_installed": importlib.util.find_spec("twine") is not None,
        "core_imports": True,
    }
    return (
        "HandoffKit doctor\n"
        f"Python: {checks['python']}\n"
        f"Platform: {checks['platform']}\n"
        f"HandoffKit: {checks['handoffkit']}\n"
        f"build installed: {checks['build_installed']}\n"
        f"twine installed: {checks['twine_installed']}\n"
        f"Core imports: {checks['core_imports']}\n"
        "Status: OK"
    )


def run_api() -> str:
    """Return stable API candidates for the road to 1.0."""
    stable = [
        "Agent",
        "Team",
        "HandoffState",
        "HandoffProtocol",
        "EvaluationCheck",
        "EvaluationResult",
        "WorkflowEvaluationReport",
        "WorkflowEvaluator",
        "Tool",
        "ToolCall",
        "ToolResult",
        "ToolRegistry",
        "ProjectTemplate",
        "TemplateFile",
        "TemplateScaffolder",
        "Recipe",
        "RecipeStep",
        "RecipeRunner",
        "RecipeRunResult",
        "ValidationReport",
        "HandoffQualityReport",
        "ProviderToolAdapter",
        "RunTrace",
        "ReplayRunner",
    ]
    return "HandoffKit stable API candidates\n" + "\n".join(f"- {name}" for name in stable)


def run_trace_demo() -> str:
    """Run a local team demo and return a run trace."""
    team = Team(
        agents=[
            Agent("Architect", "Plan implementation."),
            Agent("Coder", "Implement from handoff state."),
            Agent("Tester", "Review the result."),
        ],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    result = team.run("Create a small Python CLI calculator with tests.")
    return RunTrace.from_team_result(result, name="cli-trace-demo").to_markdown()


def run_replay_demo() -> str:
    """Run a local replay summary demo without re-executing saved work."""
    team = Team(
        agents=[Agent("Planner", "Plan."), Agent("Reviewer", "Review.")],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    trace = RunTrace.from_team_result(
        team.run("Prepare a release checklist."),
        name="cli-replay-demo",
    )
    return ReplayRunner(trace).summary().to_markdown()


def validate_report(path: str) -> str:
    """Validate that a report file is JSON object shaped."""
    payload = load_report_json(Path(path))
    return (
        "HandoffKit report validation\n"
        f"Path: {path}\n"
        f"Keys: {sorted(payload)}\n"
        "Status: OK"
    )


def evaluate_report(path: str) -> str:
    """Evaluate a trace or report JSON file offline."""
    payload = load_report_json(Path(path))
    report = WorkflowEvaluator().from_report_json(payload)
    return report.to_markdown()


def render_report(path: str) -> str:
    """Render a generated HandoffKit run report."""
    return load_showcase_report(path)


def run_coding_review_demo() -> str:
    """Run the real-world coding agents showcase."""
    return run_showcase("coding-review").to_markdown()


def run_support_escalation_demo() -> str:
    """Run the real-world support escalation showcase."""
    return run_showcase("support-escalation").to_markdown()


def run_research_workflow_demo() -> str:
    """Run the real-world research workflow showcase."""
    return run_showcase("research-workflow").to_markdown()


def init_project(
    project_name: str,
    *,
    template: str | None = None,
    output: str = ".",
    force: bool = False,
) -> str:
    """Scaffold a HandoffKit starter project."""
    scaffolder = TemplateScaffolder()
    selected_template = template or "basic-agent"
    if template is None and project_name in scaffolder.list_templates():
        selected_template = project_name
    result = scaffolder.scaffold(
        project_name,
        template=selected_template,
        output=output,
        force=force,
    )
    return result.to_markdown()


def main(argv: list[str] | None = None) -> int:
    """Run the command-line interface."""
    parser = argparse.ArgumentParser(prog="handoffkit")
    parser.add_argument("--version", action="version", version=f"handoffkit {__version__}")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("demo", help="Run a local EchoProvider demo.")
    subparsers.add_parser("demo-async", help="Run a local async runtime demo.")
    subparsers.add_parser("demo-recipe", help="Run a local recipe demo.")
    subparsers.add_parser("demo-extension", help="Run a local extension demo.")
    subparsers.add_parser("demo-structured", help="Run a local structured output demo.")
    subparsers.add_parser("demo-provider-tools", help="Run a local provider tool adapter demo.")
    subparsers.add_parser("demo-quality", help="Run a local handoff quality demo.")
    subparsers.add_parser("demo-validators", help="Run local contract validator demos.")
    subparsers.add_parser("demo-provider-formats", help="Run local provider format demos.")
    subparsers.add_parser("demo-coding-review", help="Run the coding agents showcase.")
    subparsers.add_parser("demo-support", help="Run the support escalation showcase.")
    subparsers.add_parser("demo-research", help="Run the research workflow showcase.")
    subparsers.add_parser("doctor", help="Run local package diagnostics.")
    subparsers.add_parser("api", help="Show stable API candidates.")
    subparsers.add_parser("demo-trace", help="Run a local run trace demo.")
    subparsers.add_parser("demo-replay", help="Run a local replay summary demo.")
    validate_parser = subparsers.add_parser("validate-report", help="Validate a JSON report.")
    validate_parser.add_argument("path", help="Path to a report JSON file.")
    evaluate_parser = subparsers.add_parser(
        "evaluate",
        help="Evaluate a trace or report JSON file.",
    )
    evaluate_parser.add_argument("path", help="Path to a trace or report JSON file.")
    report_parser = subparsers.add_parser("report", help="Render a generated run report.")
    report_parser.add_argument("path", help="Path to runs/latest, report.md, or report.json.")
    init_parser = subparsers.add_parser("init", help="Scaffold a HandoffKit starter project.")
    init_parser.add_argument("project_name", help="Project directory name.")
    init_parser.add_argument("--template", default=None, help="Template name.")
    init_parser.add_argument("--output", default=".", help="Parent output directory.")
    init_parser.add_argument("--force", action="store_true", help="Overwrite existing files.")
    args = parser.parse_args(argv)

    if args.command == "demo":
        print(run_demo())
        return 0
    if args.command == "demo-async":
        print(run_async_demo())
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
    if args.command == "demo-quality":
        print(run_quality_demo())
        return 0
    if args.command == "demo-validators":
        print(run_validators_demo())
        return 0
    if args.command == "demo-provider-formats":
        print(run_provider_formats_demo())
        return 0
    if args.command == "demo-coding-review":
        print(run_coding_review_demo())
        return 0
    if args.command == "demo-support":
        print(run_support_escalation_demo())
        return 0
    if args.command == "demo-research":
        print(run_research_workflow_demo())
        return 0
    if args.command == "doctor":
        print(run_doctor())
        return 0
    if args.command == "api":
        print(run_api())
        return 0
    if args.command == "demo-trace":
        print(run_trace_demo())
        return 0
    if args.command == "demo-replay":
        print(run_replay_demo())
        return 0
    if args.command == "validate-report":
        print(validate_report(args.path))
        return 0
    if args.command == "evaluate":
        print(evaluate_report(args.path))
        return 0
    if args.command == "report":
        print(render_report(args.path))
        return 0
    if args.command == "init":
        print(
            init_project(
                args.project_name,
                template=args.template,
                output=args.output,
                force=args.force,
            )
        )
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
