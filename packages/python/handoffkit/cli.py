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
from handoffkit.recipes.builtins import plan_execute_review_recipe
from handoffkit.benchmarks.doctor import run_doctor_benchmark as execute_doctor_benchmark
from handoffkit.evaluation import WorkflowEvaluator
from handoffkit.extensions import Extension, ExtensionRegistry
from handoffkit.recipes.fusion import run_fusion_demo
from handoffkit.handoff import HandoffState
from handoffkit.benchmarks.mai import run_mai_style_benchmark
from handoffkit.recipes.media import (
    MediaAsset,
    MediaWorkflowReport,
    SpeakerProfile,
    TranscriptSegment,
    build_dubbing_plan,
    ffmpeg_available,
    read_transcript_json,
    write_srt,
    write_transcript_json,
)
from handoffkit.protocol import HandoffProtocol
from handoffkit.provider_adapters import ProviderToolAdapter
from handoffkit.providers import BaseProvider, ProviderSelector
from handoffkit.quality import HandoffQualityEvaluator
from handoffkit.recipes import RecipeRunner
from handoffkit.replay import ReplayRunner
from handoffkit.reports import load_report_json, write_report_files, write_report_html
from handoffkit.runner import Team
from handoffkit.recipes.showcases import build_showcase, load_showcase_report, run_showcase, showcase_names
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


def build_media_demo_report(output_dir: Path | None = None) -> MediaWorkflowReport:
    """Build and write a deterministic offline media dubbing report."""
    target_dir = output_dir or Path("examples") / "output" / "media_dubbing_demo"
    target_dir.mkdir(parents=True, exist_ok=True)
    source = MediaAsset(
        path="examples/input/market_scene_zh.mp4",
        media_type="video",
        language="zh",
        duration_seconds=13.2,
        metadata={"mode": "offline-demo", "real_video_required": False},
    )
    transcript = [
        TranscriptSegment(
            index=1,
            start=0.0,
            end=3.4,
            speaker="SPEAKER_01",
            language="zh",
            text="我们今天要检查新的库存系统。",
        ),
        TranscriptSegment(
            index=2,
            start=3.5,
            end=7.2,
            speaker="SPEAKER_02",
            language="zh",
            text="订单同步失败，但付款记录还在。",
        ),
        TranscriptSegment(
            index=3,
            start=7.4,
            end=13.2,
            speaker="SPEAKER_01",
            language="zh",
            text="先保留日志，然后通知技术团队。",
        ),
    ]
    speakers = [
        SpeakerProfile("SPEAKER_01", "Operations lead", "es-LATAM-calm-lead", "es"),
        SpeakerProfile("SPEAKER_02", "Support analyst", "es-LATAM-analyst", "es"),
    ]
    dubbing_segments = build_dubbing_plan(
        transcript,
        {
            1: "Hoy vamos a revisar el nuevo sistema de inventario.",
            2: "La sincronización de pedidos falló, pero los registros de pago siguen ahí.",
            3: "Primero conserva los logs y luego avisa al equipo técnico.",
        },
        speakers,
    )
    transcript_path = write_transcript_json(transcript, target_dir / "transcript_zh.json")
    zh_srt = write_srt(transcript, target_dir / "subtitles_zh.srt")
    es_srt = write_srt(dubbing_segments, target_dir / "subtitles_es.srt", translated=True)
    handoff = HandoffState(
        task="Translate and dub a Chinese operations video into Spanish.",
        from_agent="Transcriber",
        to_agent="DubbingAdapter",
        summary="Timestamped Mandarin transcript converted into a Spanish dubbing plan.",
        decisions=[
            "Keep timestamps stable for the first pass.",
            "Assign one Spanish voice profile per detected speaker.",
            "Write subtitles before generating or muxing audio.",
        ],
        important_files=[str(transcript_path), str(zh_srt), str(es_srt)],
        next_steps=[
            "Run real transcription with Whisper or another provider.",
            "Generate one TTS clip per DubbingSegment.",
            "Mux final Spanish audio into the source video with ffmpeg.",
        ],
        metadata={"source_language": "zh", "target_language": "es"},
    )
    return MediaWorkflowReport(
        success=True,
        source=source,
        target_language="es",
        transcript_segments=transcript,
        speakers=speakers,
        dubbing_segments=dubbing_segments,
        output_files=[
            str(transcript_path),
            str(zh_srt),
            str(es_srt),
            str(target_dir / "dubbed_audio_es.wav"),
            str(target_dir / "final_video_es.mp4"),
        ],
        warnings=[
            "Offline demo only; no real transcription, TTS, diarization, or muxing was run.",
            "Review translated dubbing for timing, rights, and voice consent before publishing.",
        ],
        metadata={"handoff": handoff.to_dict(), "ffmpeg_available": ffmpeg_available()},
    )


def run_media_demo() -> str:
    """Run the local media dubbing demo."""
    report = build_media_demo_report()
    json_path, markdown_path = write_report_files(report, "media_dubbing_demo", "reports")
    return (
        "HandoffKit media dubbing demo\n"
        "Pipeline: Extract -> Transcribe -> Speaker Map -> Translate -> TTS -> Mux\n"
        f"Segments: {len(report.transcript_segments)}\n"
        f"Speakers: {len(report.speakers)}\n"
        f"ffmpeg available: {ffmpeg_available()}\n"
        f"Markdown report: {markdown_path}\n"
        f"JSON report: {json_path}\n\n"
        f"{report.to_markdown()}"
    )


def inspect_media_transcript(path: str) -> str:
    """Inspect a transcript JSON file."""
    segments = read_transcript_json(path)
    speakers = sorted({segment.speaker for segment in segments if segment.speaker})
    duration = max((segment.end for segment in segments), default=0.0)
    return (
        "HandoffKit media transcript inspection\n"
        f"Path: {path}\n"
        f"Segments: {len(segments)}\n"
        f"Speakers: {', '.join(speakers) if speakers else 'none'}\n"
        f"Duration seconds: {duration:.2f}"
    )


def plan_media_dubbing(video_path: str, *, source_language: str, target_language: str) -> str:
    """Return an offline media dubbing plan."""
    return (
        "HandoffKit media dubbing plan\n"
        f"Video: {video_path}\n"
        f"Language: {source_language} -> {target_language}\n"
        f"ffmpeg available: {ffmpeg_available()}\n\n"
        "1. Extract original audio with ffmpeg.\n"
        "2. Transcribe audio with timestamps and speaker labels.\n"
        "3. Translate segments while preserving timing constraints.\n"
        "4. Generate one voice clip per speaker/segment.\n"
        "5. Mux the translated audio back into the source video.\n"
        "6. Export transcript JSON, subtitles, final video, and HandoffKit report."
    )


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
    rendered = result.to_markdown()
    if selected_template in showcase_names():
        script = selected_template.replace("-", "_") + ".py"
        rendered += (
            "\n## Next Commands\n\n"
            "```bash\n"
            f"cd {project_name}\n"
            f"python {script}\n"
            "handoffkit report runs/latest\n"
            "```\n"
        )
    return rendered


def init_project_interactive(
    default_project_name: str | None = None,
    *,
    template: str | None = None,
    output: str = ".",
    force: bool = False,
) -> str:
    """Scaffold a project interactively prompting for name, provider, and API key."""
    name = (default_project_name or "").strip()
    if not name:
        name = input("Project name (my-agent): ").strip() or "my-agent"
    else:
        inp_name = input(f"Project name ({name}): ").strip()
        if inp_name:
            name = inp_name

    selected_template = template or "basic-agent"
    inp_tmpl = input(f"Template ({selected_template}): ").strip()
    if inp_tmpl:
        selected_template = inp_tmpl

    provider = input("LLM Provider (openai/nvidia/groq/ollama/echo) [openai]: ").strip() or "openai"
    api_key = ""
    if provider not in ("echo", "ollama"):
        api_key = input(f"API Key for {provider.upper()}: ").strip()

    scaffolder = TemplateScaffolder()
    target_dir = Path(output) / name
    result = scaffolder.scaffold(
        name,
        template=selected_template,
        output=output,
        force=force,
    )
    rendered = result.to_markdown()

    env_lines = []
    if api_key:
        env_name = f"{provider.upper()}_API_KEY"
        env_lines.append(f"{env_name}={api_key}")
    
    if env_lines:
        env_path = target_dir / ".env"
        env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
        
        gitignore_path = target_dir / ".gitignore"
        if gitignore_path.exists():
            try:
                git_content = gitignore_path.read_text(encoding="utf-8")
                if ".env" not in git_content:
                    git_content += "\n.env\n"
                    gitignore_path.write_text(git_content, encoding="utf-8")
            except Exception:
                pass

    import json
    config = {
        "provider": provider,
        "model": "gpt-4o-mini" if provider == "openai" else ("meta/llama-3.1-8b-instruct" if provider == "nvidia" else "default")
    }
    config_path = target_dir / "handoff.config.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

    rendered += (
        f"\n## Next Commands\n\n"
        f"cd {name}\n"
        f"Configured provider: {provider}\n"
        + (f"Saved API Key to .env\n" if api_key else "No API Key saved\n")
    )
    return rendered


def set_key(name: str, value: str) -> str:
    """Set key in local .env."""
    env_path = Path(".env")
    content = ""
    if env_path.exists():
        content = env_path.read_text(encoding="utf-8")
    
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    updated = False
    new_lines = []
    for line in lines:
        parts = line.split("=", 1)
        if parts[0].strip() == name:
            updated = True
            new_lines.append(f"{name}={value}")
        else:
            new_lines.append(line)
            
    if not updated:
        new_lines.append(f"{name}={value}")
        
    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    return f"Set key {name} successfully in .env"


def delete_key(name: str) -> str:
    """Delete key from local .env."""
    env_path = Path(".env")
    if not env_path.exists():
        return "No .env file found."
        
    content = env_path.read_text(encoding="utf-8")
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    new_lines = []
    for line in lines:
        parts = line.split("=", 1)
        if parts[0].strip() != name:
            new_lines.append(line)
            
    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    return f"Deleted key {name} successfully from .env"


def list_keys() -> str:
    """List keys from local .env with redacted values."""
    env_path = Path(".env")
    if not env_path.exists():
        return "No keys configured (.env not found)."
        
    content = env_path.read_text(encoding="utf-8")
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if not lines:
        return "No keys configured (.env is empty)."
        
    rows = []
    for line in lines:
        parts = line.split("=", 1)
        key = parts[0].strip()
        val = parts[1].strip() if len(parts) > 1 else ""
        redacted = f"{val[:4]}...{val[-4:]} (redacted)" if len(val) > 8 else "[redacted]"
        rows.append(f"- {key}={redacted}")
        
    return "Configured Keys:\n" + "\n".join(rows)


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
    subparsers.add_parser("demos", help="List real-world offline showcases.")
    showcase_parser = subparsers.add_parser("showcase", help="Run one real-world showcase.")
    showcase_parser.add_argument("slug", choices=showcase_names(), help="Showcase slug.")
    subparsers.add_parser("demo-coding-review", help="Run the coding agents showcase.")
    subparsers.add_parser("demo-support", help="Run the support escalation showcase.")
    subparsers.add_parser("demo-research", help="Run the research workflow showcase.")
    subparsers.add_parser("demo-doctor", help="Run the educational doctor-orchestrator showcase.")
    subparsers.add_parser("demo-fusion", help="Run the local Fusion-style panel demo.")
    subparsers.add_parser("demo-media", help="Run the local media dubbing workflow demo.")
    media_parser = subparsers.add_parser("media", help="Inspect and plan media workflows.")
    media_subparsers = media_parser.add_subparsers(dest="media_command")
    media_inspect_parser = media_subparsers.add_parser("inspect", help="Inspect transcript JSON.")
    media_inspect_parser.add_argument("path", help="Path to transcript JSON.")
    media_plan_parser = media_subparsers.add_parser("plan", help="Plan a video dubbing workflow.")
    media_plan_parser.add_argument("video_path", help="Input video path.")
    media_plan_parser.add_argument("--from", dest="source_language", default="auto")
    media_plan_parser.add_argument("--to", dest="target_language", default="es")
    providers_parser = subparsers.add_parser("providers", help="Inspect provider registry.")
    providers_subparsers = providers_parser.add_subparsers(dest="providers_command")
    providers_list_parser = providers_subparsers.add_parser("list", help="List providers.")
    providers_list_parser.add_argument("--json", action="store_true", help="Print JSON.")
    providers_models_parser = providers_subparsers.add_parser(
        "models",
        help="List provider models.",
    )
    providers_models_parser.add_argument("--provider", required=True, help="Provider name.")
    providers_models_parser.add_argument(
        "--real",
        action="store_true",
        help="Call provider endpoint.",
    )
    providers_models_parser.add_argument("--json", action="store_true", help="Print JSON.")
    providers_probe_parser = providers_subparsers.add_parser("probe", help="Probe provider models.")
    providers_probe_parser.add_argument("--provider", required=True, help="Provider name.")
    providers_probe_parser.add_argument("--models", default=None, help="Comma-separated models.")
    providers_probe_parser.add_argument(
        "--real",
        action="store_true",
        help="Call provider endpoint.",
    )
    providers_probe_parser.add_argument("--json", action="store_true", help="Print JSON.")
    providers_select_parser = providers_subparsers.add_parser(
        "select",
        help="Select a provider model.",
    )
    providers_select_parser.add_argument("--provider", required=True, help="Provider name.")
    providers_select_parser.add_argument("--models", default=None, help="Comma-separated models.")
    providers_select_parser.add_argument(
        "--real",
        action="store_true",
        help="Call provider endpoint.",
    )
    providers_select_parser.add_argument("--json", action="store_true", help="Print JSON.")
    benchmark_doctor_parser = subparsers.add_parser(
        "benchmark-doctor",
        help="Run the real-case doctor benchmark harness.",
    )
    benchmark_doctor_parser.add_argument(
        "--cases",
        type=int,
        default=30,
        help="Number of bundled real cases to replay.",
    )
    benchmark_doctor_mai_parser = subparsers.add_parser(
        "benchmark-doctor-mai",
        help="Run public MAI-style sequential doctor benchmark.",
    )
    benchmark_doctor_mai_parser.add_argument(
        "--cases",
        type=int,
        default=30,
        help="Number of bundled real cases to replay.",
    )
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
    report_parser.add_argument("--html", action="store_true", help="Write a polished HTML report.")
    report_parser.add_argument("--output", default=None, help="Output path for --html.")
    init_parser = subparsers.add_parser("init", help="Scaffold a HandoffKit starter project.")
    init_parser.add_argument("project_name", nargs="?", default=None, help="Project directory name.")
    init_parser.add_argument("--interactive", "-i", action="store_true", help="Scaffold interactively.")
    init_parser.add_argument("--template", default=None, help="Template name.")
    init_parser.add_argument("--output", default=".", help="Parent output directory.")
    init_parser.add_argument("--force", action="store_true", help="Overwrite existing files.")

    keys_parser = subparsers.add_parser("keys", help="Manage local API keys in .env.")
    keys_subparsers = keys_parser.add_subparsers(dest="keys_command")
    
    keys_set_parser = keys_subparsers.add_parser("set", help="Set a local key.")
    keys_set_parser.add_argument("name", help="Key name.")
    keys_set_parser.add_argument("value", help="Key value.")
    
    keys_delete_parser = keys_subparsers.add_parser("delete", help="Delete a local key.")
    keys_delete_parser.add_argument("name", help="Key name.")
    
    keys_list_parser = keys_subparsers.add_parser("list", help="List configured keys.")

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
    if args.command == "demos":
        print(list_showcases())
        return 0
    if args.command == "showcase":
        print(run_named_showcase(args.slug))
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
    if args.command == "demo-doctor":
        print(run_doctor_orchestrator_demo())
        return 0
    if args.command == "demo-fusion":
        print(run_fusion_style_demo())
        return 0
    if args.command == "demo-media":
        print(run_media_demo())
        return 0
    if args.command == "media":
        if args.media_command == "inspect":
            print(inspect_media_transcript(args.path))
            return 0
        if args.media_command == "plan":
            print(
                plan_media_dubbing(
                    args.video_path,
                    source_language=args.source_language,
                    target_language=args.target_language,
                )
            )
            return 0
        parser.error("media requires a subcommand")
    if args.command == "providers":
        if args.providers_command == "list":
            print(list_providers(json_output=args.json))
            return 0
        if args.providers_command == "models":
            print(list_provider_models(args.provider, real=args.real, json_output=args.json))
            return 0
        if args.providers_command == "probe":
            print(
                probe_provider_models(
                    args.provider,
                    models=args.models,
                    real=args.real,
                    json_output=args.json,
                )
            )
            return 0
        if args.providers_command == "select":
            print(
                select_provider_model(
                    args.provider,
                    models=args.models,
                    real=args.real,
                    json_output=args.json,
                )
            )
            return 0
        parser.error("providers requires a subcommand")
    if args.command == "benchmark-doctor":
        print(run_doctor_benchmark_demo(args.cases))
        return 0
    if args.command == "benchmark-doctor-mai":
        print(run_mai_style_doctor_benchmark_demo(args.cases))
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
        print(render_report(args.path, html=args.html, output=args.output))
        return 0
    if args.command == "init":
        if args.interactive or not args.project_name:
            print(
                init_project_interactive(
                    args.project_name,
                    template=args.template,
                    output=args.output,
                    force=args.force,
                )
            )
        else:
            print(
                init_project(
                    args.project_name,
                    template=args.template,
                    output=args.output,
                    force=args.force,
                )
            )
        return 0
    if args.command == "keys":
        if args.keys_command == "set":
            print(set_key(args.name, args.value))
            return 0
        if args.keys_command in ("delete", "remove"):
            print(delete_key(args.name))
            return 0
        if args.keys_command == "list":
            print(list_keys())
            return 0
        parser.error("keys requires a subcommand: set, list, delete")

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())



