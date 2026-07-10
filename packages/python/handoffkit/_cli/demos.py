"""Offline demo runners for the handoffkit CLI."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import platform
import sys
from pathlib import Path

from handoffkit._cli.project import load_dynamic_extensions
from handoffkit._version import __version__
from handoffkit.agent import Agent
from handoffkit.benchmarks.doctor import run_doctor_benchmark as execute_doctor_benchmark
from handoffkit.benchmarks.independent import (
    methodology_manifest,
    run_independent_benchmark,
)
from handoffkit.benchmarks.mai import run_mai_style_benchmark
from handoffkit.evaluation import WorkflowEvaluator
from handoffkit.extensions import Extension, ExtensionRegistry
from handoffkit.handoff import HandoffState
from handoffkit.protocol import HandoffProtocol
from handoffkit.provider_adapters import ProviderToolAdapter
from handoffkit.providers import BaseProvider, ProviderSelector
from handoffkit.quality import HandoffQualityEvaluator
from handoffkit.recipes import RecipeRunner
from handoffkit.recipes.builtins import plan_execute_review_recipe
from handoffkit.recipes.fusion import run_fusion_demo
from handoffkit.recipes.showcases import (
    build_showcase,
    load_showcase_report,
    run_showcase,
    showcase_names,
)
from handoffkit.replay import ReplayRunner
from handoffkit.reports import load_report_json, write_report_html
from handoffkit.runner import Team
from handoffkit.structured import StructuredOutputSchema
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
    load_dynamic_extensions(registry)
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
        "MediaAsset",
        "TranscriptSegment",
        "SpeakerProfile",
        "DubbingSegment",
        "MediaWorkflowReport",
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


def _load_report_payload(path: str | Path) -> dict[str, object]:
    """Load a report payload from a run directory or JSON file."""
    target = Path(path)
    if target.is_dir():
        for candidate in ["report.json", "trace.json"]:
            candidate_path = target / candidate
            if candidate_path.exists():
                return load_report_json(candidate_path)
        raise FileNotFoundError(f"No report.json or trace.json found in {target}")
    return load_report_json(target)


def render_report(path: str, *, html: bool = False, output: str | None = None) -> str:
    """Render a generated HandoffKit run report."""
    if html:
        payload = _load_report_payload(path)
        if output:
            output_path = Path(output)
        else:
            target = Path(path)
            output_path = (target if target.is_dir() else target.parent) / "report.html"
        write_report_html(payload, output_path)
        return f"HandoffKit HTML report written: {output_path}"
    return load_showcase_report(path)


def list_showcases() -> str:
    """List the offline real-world showcases."""
    lines = ["HandoffKit showcases", ""]
    for slug in showcase_names():
        showcase = build_showcase(slug)
        lines.append(f"- {slug}: {showcase.title}")
        lines.append(f"  command: handoffkit showcase {slug}")
    return "\n".join(lines)


def _split_models(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [item.strip() for item in value.split(",") if item.strip()]


def list_providers(*, json_output: bool = False) -> str:
    """List experimental provider registry entries."""
    selector = ProviderSelector()
    specs = [spec.to_dict() for spec in selector.list_providers()]
    if json_output:
        return json.dumps({"providers": specs}, indent=2, sort_keys=True)
    lines = ["HandoffKit providers", ""]
    for spec in selector.list_providers():
        lines.append(f"- {spec.name}: {spec.description}")
        lines.append(f"  default: {spec.default_model}")
        lines.append(f"  models: {', '.join(spec.suggested_models)}")
        lines.append(f"  env: {', '.join(spec.env_vars)}")
    return "\n".join(lines)


def list_provider_models(provider: str, *, real: bool = False, json_output: bool = False) -> str:
    """List known provider models without network unless real=True."""
    selector = ProviderSelector()
    models = selector.list_models(provider, real=real)
    payload = {"provider": provider, "real": real, "models": models}
    if json_output:
        return json.dumps(payload, indent=2, sort_keys=True)
    mode = "real" if real else "offline"
    return (
        f"HandoffKit provider models ({mode})\n"
        f"Provider: {provider}\n"
        + "\n".join(f"- {model}" for model in models)
    )


def probe_provider_models(
    provider: str,
    *,
    models: str | None = None,
    real: bool = False,
    json_output: bool = False,
) -> str:
    """Probe provider model candidates."""
    selector = ProviderSelector()
    results = [
        selector.probe(candidate, real=real)
        for candidate in selector.candidates(provider, _split_models(models))
    ]
    payload = {"provider": provider, "real": real, "results": [item.to_dict() for item in results]}
    if json_output:
        return json.dumps(payload, indent=2, sort_keys=True)
    mode = "real" if real else "offline"
    lines = [f"HandoffKit provider probe ({mode})", f"Provider: {provider}"]
    for result in results:
        status = "ok" if result.success else "failed"
        suffix = f" error={result.error}" if result.error else ""
        lines.append(f"- {result.model}: {status} {result.latency_seconds:.3f}s{suffix}")
    return "\n".join(lines)


def select_provider_model(
    provider: str,
    *,
    models: str | None = None,
    real: bool = False,
    json_output: bool = False,
) -> str:
    """Select the first working provider model."""
    selector = ProviderSelector()
    result = selector.select(provider, _split_models(models), real=real)
    payload = result.to_dict()
    if json_output:
        return json.dumps(payload, indent=2, sort_keys=True)
    mode = "real" if real else "offline"
    return (
        f"HandoffKit provider select ({mode})\n"
        f"Provider: {result.provider}\n"
        f"Model: {result.model}\n"
        f"Success: {result.success}\n"
        f"Latency: {result.latency_seconds:.3f}s"
    )


def run_named_showcase(slug: str) -> str:
    """Run one named showcase and write runs/latest artifacts."""
    return run_showcase(slug).to_markdown()


def run_coding_review_demo() -> str:
    """Run the real-world coding agents showcase."""
    return run_named_showcase("coding-review")


def run_support_escalation_demo() -> str:
    """Run the real-world support escalation showcase."""
    return run_named_showcase("support-escalation")


def run_research_workflow_demo() -> str:
    """Run the real-world research workflow showcase."""
    return run_named_showcase("research-workflow")



def run_doctor_benchmark_demo(limit: int = 30) -> str:
    """Run the real-case offline doctor benchmark harness."""
    return execute_doctor_benchmark(limit).to_markdown()


def run_mai_style_doctor_benchmark_demo(limit: int = 30) -> str:
    """Run the public MAI-style sequential doctor benchmark."""
    return run_mai_style_benchmark(limit).to_markdown()


def run_independent_benchmark_demo(
    *,
    seed: str = "handoffkit-independent-2026",
    manifest_only: bool = False,
) -> str:
    """Run the independent protocol benchmark (no leaderboard)."""
    if manifest_only:
        return json.dumps(methodology_manifest(), ensure_ascii=False, indent=2) + "\n"
    report = run_independent_benchmark(seed=seed)
    arts = "\n".join(f"- {k}: {v}" for k, v in report.artifacts.items())
    return (
        f"{report.to_markdown()}\n"
        f"## Written artifacts\n\n{arts}\n"
    )


def run_doctor_orchestrator_demo() -> str:
    """Run the educational doctor-orchestrator showcase."""
    return run_named_showcase("doctor-orchestrator")


def run_fusion_style_demo() -> str:
    """Run the local Fusion-style panel demo."""
    report, json_path, markdown_path = run_fusion_demo(output_dir=Path("reports"))
    return (
        "HandoffKit Fusion-style panel demo\n"
        f"Mode: {report.mode}\n"
        f"Panel models: {', '.join(item.model for item in report.panel)}\n"
        f"Markdown report: {markdown_path}\n"
        f"JSON report: {json_path}\n\n"
        f"{report.to_markdown()}"
    )


