<div align="center">

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/packages/python/docs/assets/handoffkit-hero.svg" alt="HandoffKit: structured state transfer for multi-agent cross-runtime workflows" width="100%">

# HandoffKit

**Structured state transfer for multi-agent Python, JavaScript, Rust, and C++ workflows.**

Build agent chains where each agent receives a clear contract: task, decisions,
files, errors, next steps, and metadata. No messy context soup.

[![Tests](https://github.com/DaosPath/handoffkit/actions/workflows/ci.yml/badge.svg)](https://github.com/DaosPath/handoffkit/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/handoffkit.svg)](https://pypi.org/project/handoffkit/)
![Python versions](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12%20%7C%203.13%20%7C%203.14-blue)
![License](https://img.shields.io/badge/license-MIT-green)

```bash
pip install handoffkit
```

<table>
  <tr>
    <td><strong>Contract-first</strong><br>Agents pass JSON-friendly state instead of vague summaries.</td>
    <td><strong>Cross-runtime</strong><br>Python, JavaScript, Rust, and C++ share canonical fixtures.</td>
    <td><strong>Replayable</strong><br>Trace team, recipe, and tool runs without re-running side effects.</td>
    <td><strong>Offline by default</strong><br>Tests and demos run locally with deterministic providers.</td>
  </tr>
</table>

<p>
  <strong>1.9.0:</strong> browser-safe `@handoffkit/core` plus Node-only `@handoffkit/node` filesystem helpers.<br>
  <strong>1.8.8:</strong> installed-package-safe contract parity reports.<br>
  <strong>1.7.0:</strong> shared Python + JavaScript contracts with canonical JSON fixtures.<br>
  <strong>1.6.0:</strong> JavaScript core package with async runtime, provider tool formats, traces, and reports.<br>
  <strong>1.5.0:</strong> media workflow contracts for audiobook and translated video dubbing demos.<br>
  <strong>1.3.0:</strong> tool creation, OpenCode providers, and research-only evidence tools.<br>
  <strong>1.4.5:</strong> native NVIDIA, OpenRouter, Groq, Grok, and OpenAI-compatible provider routing.
</p>

</div>

---

## Contents

- [Quickstart](#quickstart)
- [Unified Cross-runtime Contracts](#unified-cross-runtime-contracts)
- [Provider Registry and Model Routing](#provider-registry-and-model-routing)
- [JavaScript Core](#javascript-core)
- [Media Workflows](#media-workflows)
- [Tool Creation and Evidence Tools](#tool-creation-and-evidence-tools)
- [Wow in 5 Minutes](#wow-in-5-minutes)
- [Research-only Benchmarks](#research-only-benchmarks)
- [Integrations](#integrations)
- [Stable API Surface](#stable-api-surface)
- [Repository Layout](#repository-layout)
- [Development](#development)
- [Publishing](#publishing)

## What It Is

HandoffKit is a lightweight Python framework for building multi-agent AI
workflows where agents pass **structured state** instead of free-text summaries.

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/packages/python/docs/assets/handoffkit-state-flow.svg" alt="HandoffKit turns fragile free text handoffs into structured HandoffState contracts" width="100%">

Most multi-agent demos do this:

```text
Agent A -> "Here is roughly what happened..." -> Agent B
```

HandoffKit does this:

```text
Architect
  task: "Build a calculator CLI"
  decisions: ["Use argparse", "Keep operations pure"]
  files: ["calculator.py", "test_calculator.py"]
  next_steps: ["Implement CLI", "Run pytest"]
        |
        v
Coder
  receives HandoffState, not a vague paragraph
        |
        v
Tester
  receives decisions, files, errors, and test evidence
```

That makes agent workflows easier to inspect, test, replay, and improve.

## Unified Cross-runtime Contracts

HandoffKit 1.8.x makes the Python, JavaScript, Rust, and C++ runtimes speak the
same wire format. The canonical JSON contracts live in
[`packages/contracts`](https://github.com/DaosPath/handoffkit/tree/main/packages/contracts).

- Python uses `HandoffState.to_dict()` and `RunTrace.to_dict()`.
- JavaScript uses `toJSON()` / `JSON.stringify()`.
- Rust uses serde structs for the shared contract fixtures.
- C++ uses nlohmann/json adapters for the shared contract fixtures.
- The shared wire format uses `snake_case`: `from_agent`, `to_agent`,
  `important_files`, `next_steps`, `run_id`, `final_output`, and
  `tool_results`.
- JavaScript still exposes ergonomic camelCase properties in memory, such as
  `state.fromAgent` and `trace.finalOutput`.

```python
from handoffkit import HandoffState

state = HandoffState.from_dict(shared_json)
state.validate()
```

```js
import { HandoffState } from "@handoffkit/core";

const state = HandoffState.fromJSON(sharedJson);
console.log(state.fromAgent);
console.log(JSON.stringify(state));
```

The Python, JavaScript, Rust, and C++ test suites read the same fixture files,
so contract drift becomes a CI failure instead of a surprise for users.

```python
from handoffkit import build_contract_parity_report

report = build_contract_parity_report(runtime="python", version="1.9.0")
print(report.to_markdown())
```

## Repository Layout

HandoffKit is organized as a clean monorepo. The Python package published to
PyPI lives in `packages/python`:

```text
handoffkit/
  packages/
    contracts/       # Shared JSON schemas and cross-runtime fixtures
    js/
      core/          # JavaScript/TypeScript package: @handoffkit/core
      node/          # Node.js filesystem package: @handoffkit/node
    rust/            # Rust contract package
    cpp/             # C++17 contract package
    python/
      handoffkit/      # Python package published to PyPI
      examples/        # Python examples and demos
      tests/           # Python tests
      docs/            # Python package docs and assets
  apps/
    web/               # Next.js demo and docs app
```

Use the root `pnpm` workspace for common commands:

```bash
pnpm python:test
pnpm python:build
pnpm web:dev
pnpm web:lint
pnpm web:build
```

## Wow in 5 Minutes

Start with a real coding-agent workflow, not an abstract toy:

```bash
pip install handoffkit
handoffkit demos
handoffkit showcase coding-review
handoffkit report runs/latest
```

Or scaffold the same workflow as a tiny editable project:

```bash
handoffkit init coding-review
cd coding-review
python coding_review.py
handoffkit report runs/latest
```

The demo shows the same handoff as a vague free-text summary and as structured
`HandoffState`: files, decisions, errors, next steps, validation, quality, and
replay evidence stay attached to the work.

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/packages/python/docs/assets/coding-review-terminal.svg" alt="Animated terminal demo of pip install handoffkit, coding-review init, report output, and context soup versus HandoffState" width="100%">

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/packages/python/docs/assets/handoffkit-showcases.svg" alt="Three HandoffKit demos: coding agents, support escalation, and research workflow" width="100%">

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/packages/python/docs/assets/handoffkit-report-gallery.svg" alt="HandoffKit report gallery for coding agents, support escalation, and research workflow" width="100%">

Bonus educational healthcare workflow:

```bash
handoffkit showcase doctor-orchestrator
handoffkit report runs/latest
```

`doctor-orchestrator` is a synthetic demo inspired by virtual physician-panel
orchestration patterns: Intake -> Hypothesis -> Challenger -> Test Steward ->
Checklist -> Final Reviewer. It demonstrates structured uncertainty, missing
questions, red-flag tracking, cost-aware test reasoning, and replayable review
evidence. It is not medical advice.

Real open-access case benchmark preview:

```bash
handoffkit benchmark-doctor --cases 30
handoffkit report runs/latest
```

`benchmark-doctor` uses 30 real cases from the public MedCaseReasoning test
split, derived from PMC Open Access case reports. It runs in `gold_replay` mode:
it replays clinician-authored diagnoses and reasoning to test HandoffKit
contracts, reports, quality scoring, and traceability. It does not claim model
diagnostic accuracy and is not medical advice.

MAI/SDBench-style public benchmark preview:

```bash
handoffkit benchmark-doctor-mai --cases 30
handoffkit report runs/latest
```

`benchmark-doctor-mai` mirrors the public mechanics described for SDBench:
opening note, gatekeeper, targeted questions, tests, simulated costs, final
diagnosis, trace, and replay. It uses public MedCaseReasoning / PMC Open Access
cases, not private NEJM SDBench data.

Fusion-style model panel preview:

```bash
handoffkit demo-fusion
python examples/fusion_style_demo.py
```

`demo-fusion` is inspired by multi-model deliberation systems: a panel of model
roles proposes moves, then a deterministic judge reports consensus,
contradictions, coverage gaps, blind spots, and a final next-step strategy.
It runs offline by default. Real provider calls are opt-in through the example
script with `--real`.

Media dubbing workflow preview:

```bash
handoffkit demo-media
handoffkit media inspect examples/output/media_dubbing_demo/transcript_zh.json
handoffkit media plan input_zh.mp4 --from zh --to es
```

`demo-media` shows how a Chinese video translation pipeline can pass structured
state through Extract -> Transcribe -> Speaker Map -> Translate -> TTS -> Mux.
It writes transcript JSON, Chinese/Spanish SRT subtitles, a reusable report,
and a handoff contract for the next audio/video stage. It does not call real
transcription, TTS, diarization, or video APIs by default.

## Report Gallery

Reports generated by the offline demos:

| Demo | Report | Command |
|---|---|---|
| Coding agents | [`examples/fixtures/reports/coding_review.md`](examples/fixtures/reports/coding_review.md) | `handoffkit showcase coding-review` |
| Support escalation | [`examples/fixtures/reports/support_escalation.md`](examples/fixtures/reports/support_escalation.md) | `handoffkit showcase support-escalation` |
| Research workflow | [`examples/fixtures/reports/research_workflow.md`](examples/fixtures/reports/research_workflow.md) | `handoffkit showcase research-workflow` |
| Doctor orchestrator | [`examples/fixtures/reports/doctor_orchestrator.md`](examples/fixtures/reports/doctor_orchestrator.md) | `handoffkit showcase doctor-orchestrator` |
| Doctor benchmark 30 | [`examples/fixtures/reports/doctor_benchmark_30.md`](examples/fixtures/reports/doctor_benchmark_30.md) | `handoffkit benchmark-doctor --cases 30` |
| MAI-style doctor benchmark 30 | [`examples/fixtures/reports/mai_style_doctor_benchmark_30.md`](examples/fixtures/reports/mai_style_doctor_benchmark_30.md) | `handoffkit benchmark-doctor-mai --cases 30` |
| Fusion-style panel | [`examples/fixtures/reports/fusion_style_demo.md`](examples/fixtures/reports/fusion_style_demo.md) | `handoffkit demo-fusion` |
| Media dubbing workflow | [`examples/fixtures/reports/media_dubbing_demo.md`](examples/fixtures/reports/media_dubbing_demo.md) | `handoffkit demo-media` |

Technical post: [`Context Soup vs Contract Handoffs`](docs/CONTEXT_SOUP_VS_CONTRACT_HANDOFFS.md).
Launch copy for Hacker News, Reddit, X/LinkedIn, and LangGraph communities:
[`docs/launch/CONTEXT_SOUP_LAUNCH_KIT.md`](docs/launch/CONTEXT_SOUP_LAUNCH_KIT.md).
Full showcase gallery: [`docs/SHOWCASE_GALLERY.md`](docs/SHOWCASE_GALLERY.md).

## Visual Overview

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/packages/python/docs/assets/handoffkit-trace-replay.svg" alt="HandoffKit RunTrace, FileTraceStore, ReplayRunner, and reports flow" width="100%">

HandoffKit is built around three ideas:

| Layer | API | Why it matters |
|---|---|---|
| State transfer | `HandoffState`, `HandoffProtocol`, `Team` | Agents receive explicit task, decisions, files, errors, and next steps. |
| Quality control | `ValidationReport`, `HandoffQualityReport` | Handoffs can be validated, scored, serialized, and reviewed. |
| Audit trail | `RunTrace`, `FileTraceStore`, `ReplayRunner` | Runs can be stored and replay-inspected without providers, tools, or shell. |

## What 1.9.0 Adds

HandoffKit 1.9.0 splits the JavaScript/TypeScript layer into browser-safe core
and Node-only helpers:

- `@handoffkit/core` for JS apps that need the same handoff contract shape in
  browsers, Next.js client components, Vite, Workers, Deno, Bun, or Node,
- `@handoffkit/node` for local filesystem helpers,
- async `Agent.arun()` and `Team.arun()` helpers,
- `ToolRegistry`, `ToolCall`, `ToolResult`, and `Agent.runWithTools()`,
- `ProviderToolAdapter` for HandoffKit, OpenAI, and Anthropic-style tool
  schemas/calls,
- `FileTraceStore`, `writeReportFiles()`, `loadReportJSON()`, and
  `ProjectIndexer` live in `@handoffkit/node`.

The JS core package is dependency-free, browser-safe, and tested offline.
Provider SDKs and filesystem features are intentionally left to adapter packages
or app code.

```bash
pnpm js:check
pnpm js:test
```

## JavaScript Core

Use `@handoffkit/core` when your Next.js/Node app needs structured agent
handoffs without pulling in the Python runtime:

```js
import {
  Agent,
  HandoffProtocol,
  ProviderToolAdapter,
  RunTrace,
  Team,
  defineTool,
} from "@handoffkit/core";

const add = defineTool({
  name: "add",
  description: "Add two numbers.",
  parameters: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  execute: ({ a, b }) => a + b,
});

const openaiTools = new ProviderToolAdapter().toolsToProviderFormat([add], "openai");

const team = new Team({
  agents: [new Agent({ name: "Architect" }), new Agent({ name: "Coder" })],
  protocol: new HandoffProtocol(),
});

const result = await team.arun("Build a calculator.");
const trace = RunTrace.fromTeamResult(result);
```

Package source: [`packages/js/core`](https://github.com/DaosPath/handoffkit/tree/main/packages/js/core).

## What 1.5.0 Adds

HandoffKit 1.5.0 adds lightweight media workflow contracts and offline demos:

- `MediaAsset`, `TranscriptSegment`, `SpeakerProfile`, `DubbingSegment`, and
  `MediaWorkflowReport` for audiobook, transcription, translation, and dubbing
  workflows,
- subtitle/transcript helpers: `write_srt()`, `write_transcript_json()`, and
  `read_transcript_json()`,
- optional `ffmpeg` wrappers for extracting audio and muxing translated audio
  back into a video,
- `handoffkit demo-media` and `handoffkit media ...` CLI commands.

No media dependency is installed by default. Real transcription, TTS, speaker
diarization, source separation, and video processing stay opt-in.

## Media Workflows

Use HandoffKit as the contract layer around media agents:

```text
Video -> Audio Extractor -> Transcriber -> Speaker Mapper
      -> Translator -> Voice Generator -> Mixer -> Publisher
```

The state passed between stages can include:

```python
from handoffkit import TranscriptSegment, SpeakerProfile, build_dubbing_plan, write_srt

segments = [
    TranscriptSegment(1, 0.0, 2.5, "ÃƒÂ¤Ã‚Â½Ã‚Â ÃƒÂ¥Ã‚Â¥Ã‚Â½", speaker="SPEAKER_01", language="zh"),
]
speakers = [SpeakerProfile("SPEAKER_01", "Narrator", "es-LATAM-calm", "es")]
dubbing = build_dubbing_plan(segments, {1: "Hola."}, speakers)
write_srt(dubbing, "examples/output/media/subtitles_es.srt", translated=True)
```

Optional ffmpeg helpers are available when an ffmpeg binary is installed:

```python
from handoffkit import extract_audio, mux_audio

extract_audio("input_zh.mp4", "examples/output/media/original.wav")
mux_audio("input_zh.mp4", "dubbed_es.wav", "examples/output/media/output_es.mp4")
```

Docs: [`docs/MEDIA_WORKFLOWS.md`](docs/MEDIA_WORKFLOWS.md).

## What 1.3.0 Adds

HandoffKit 1.3.0 is focused on stronger tool creation and
evidence-aware agent workflows:

- `ToolSpec`, `ToolFactory`, `DeclarativeTool`, and `HttpJsonTool` for building
  provider-ready tools without hand-writing wrappers,
- public medical evidence lookup tools for PubMed, ClinicalTrials.gov, and
  DailyMed,
- clinical MAI-style MiMo benchmark runner with multi-stage handoffs,
  adversarial challenge, label normalization, and replayable reports.

Medical tools are for research and benchmark workflows only. They do not
diagnose, treat, or replace clinical judgment.

```python
from handoffkit.tools import pubmed_search, clinical_trials_search, dailymed_drug_search

pubmed_search.run(query="scleroderma renal crisis case report", max_results=3)
clinical_trials_search.run(condition="systemic sclerosis", max_results=3)
dailymed_drug_search.run(drug_name="ibuprofen", max_results=3)
```

## Tool Creation and Evidence Tools

HandoffKit 1.3.0 makes tool creation explicit and testable. Use declarative
tool specs for local workflows, HTTP JSON wrappers for public APIs, and
provider-ready schemas when an agent needs tool calls.

```python
from handoffkit import ToolFactory

factory = ToolFactory()
tool = factory.from_function(
    name="summarize_file",
    description="Summarize a project file for the next agent.",
    func=lambda path: f"summary for {path}",
)

print(tool.to_schema())
```

Research/evidence helpers are opt-in and public-data only:

```bash
python examples/medical_tools_demo.py
python examples/opencode_go_agent.py --help
python examples/opencode_zen_agent.py --help
```

Medical and benchmark tooling is for research workflows only. It is not
clinical validation, not patient care, and not a diagnostic system.

## What 1.4.5 Adds

HandoffKit 1.4.5 adds native OpenAI-compatible provider entries without adding
provider SDK dependencies:

- NVIDIA NIM, including `z-ai/glm-5.2` through NVIDIA Build,
- OpenRouter unified routing,
- Groq and xAI Grok,
- Together AI, Fireworks AI, DeepInfra, Perplexity, Mistral AI, Cerebras,
  SambaNova Cloud, and Z.ai / GLM.

All provider CLI commands stay offline unless `--real` is passed:

```bash
handoffkit providers list
handoffkit providers models --provider nvidia
handoffkit providers select --provider openrouter --models openrouter/auto --json
```

Real probes use provider-specific env vars:

```powershell
$env:NVIDIA_API_KEY="..."
handoffkit providers probe --provider nvidia --models z-ai/glm-5.2 --real

$env:OPENROUTER_API_KEY="..."
handoffkit providers probe --provider openrouter --models openrouter/auto --real
```

## What 1.4.0 Adds

HandoffKit 1.4.0 adds experimental provider routing:

- provider registry entries for OpenCode Go, OpenCode Zen, OpenAI-compatible
  endpoints, and Ollama,
- `ProviderSelector` for offline model lists and real opt-in probes,
- `ProviderRouter` for ordered fallback between model candidates,
- retry/backoff for transient OpenCode `429`, `5xx`, and transport failures,
- `handoffkit providers ...` CLI commands that never call real APIs unless
  `--real` is passed.

```bash
handoffkit providers list
handoffkit providers models --provider opencode-go
handoffkit providers select --provider opencode-go --models mimo-v2.5,deepseek-v4-flash --json
```

Real probes require an explicit flag and a scoped provider key:

```powershell
$env:OPENCODE_API_KEY="..."
handoffkit providers probe --provider opencode-go --models mimo-v2.5,deepseek-v4-flash --real
```

## Provider Registry and Model Routing

The provider registry is experimental in 1.4.x. It is intended for diagnostics,
model selection, and fallback without adding heavy provider SDKs.

```python
from handoffkit.providers import ModelCandidate, ProviderRouter

router = ProviderRouter(
    [
        ModelCandidate("opencode-go", "mimo-v2.5"),
        ModelCandidate("opencode-go", "deepseek-v4-flash"),
    ]
)

print(router.generate("Create a concise release checklist."))
```

Docs: [`docs/PROVIDERS.md`](docs/PROVIDERS.md).

Native providers in 1.4.5:

| Provider | Key env var | Default model |
|---|---|---|
| `nvidia` | `NVIDIA_API_KEY` | `z-ai/glm-5.2` |
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `grok` | `XAI_API_KEY` | `grok-4.3` |
| `together` | `TOGETHER_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| `fireworks` | `FIREWORKS_API_KEY` | `accounts/fireworks/models/deepseek-v3p1` |
| `deepinfra` | `DEEPINFRA_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| `perplexity` | `PERPLEXITY_API_KEY` | `sonar-pro` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` |
| `cerebras` | `CEREBRAS_API_KEY` | `llama3.1-8b` |
| `sambanova` | `SAMBANOVA_API_KEY` | `Meta-Llama-3.3-70B-Instruct` |
| `zai` | `ZAI_API_KEY` | `glm-5.2` |

## Fusion-style Model Panels

HandoffKit can also model a Fusion-style workflow without external APIs:

1. assign specialist roles to a panel,
2. collect parallel model answers or deterministic offline stand-ins,
3. compare consensus, contradictions, gaps, and blind spots,
4. write reusable JSON/Markdown reports.

```bash
handoffkit demo-fusion
python examples/fusion_style_demo.py --help
```

For real provider probes, pass `--real` and configure provider credentials in
environment variables. The demo never prints tokens and never calls real APIs
unless explicitly requested.

## Research-only Benchmarks

HandoffKit includes benchmark tooling to stress-test handoff contracts,
traceability, report generation, and model routing. These workflows are
educational and research-only.

| Run | Model | Cases | Correct | Accuracy | Report |
|---|---|---:|---:|---:|---|
| MAI-style clinical panel | `mimo-v2.5` | 400 | 233 | 58.25% | [`clinical_benchmark_400_summary.md`](examples/fixtures/reports/clinical_benchmark_400_summary.md) |

This is not a medical device, not clinical validation, not patient care, and
not a diagnostic claim. Full model outputs, partials, logs, and OpenCode live
artifacts are intentionally kept out of Git and PyPI.

## Integrations

HandoffKit is intentionally small: no heavy runtime integrations are required.
Use it as the contract and reporting layer beside orchestration frameworks:

- [`LangGraph`](docs/integrations/LANGGRAPH.md): graph nodes pass `HandoffState`,
- [`OpenAI Agents SDK`](docs/integrations/OPENAI_AGENTS.md): agent handoffs become auditable contracts,
- [`Pydantic AI`](docs/integrations/PYDANTIC_AI.md): typed outputs become workflow handoff state,
- [`OpenCode Go / Zen`](docs/integrations/OPENCODE.md): provider adapters route
  OpenCode model families to their matching API endpoint styles.
- [`Provider Registry`](docs/PROVIDERS.md): experimental provider listing,
  probing, model selection, and fallback routing.

Runnable offline examples:
[`examples/langgraph_integration.py`](examples/langgraph_integration.py),
[`examples/openai_agents_sdk_integration.py`](examples/openai_agents_sdk_integration.py),
and [`examples/pydantic_ai_integration.py`](examples/pydantic_ai_integration.py).

## Release Highlights

Older releases built the stable base that 1.3.0 and 1.4.0 sit on:

| Release | Highlight |
|---|---|
| 1.2.0 | Showcase CLI, report gallery, better onboarding, and integration examples. |
| 1.1.0 | Three real-world demos: coding agents, support escalation, and research workflow. |
| 1.0.x | Stable API, Trusted Publishing docs, security docs, async runtime, templates, and evaluator reports. |
| 0.8-0.9 | Trace/replay, stable API docs, compatibility tests, and stronger provider validation. |
| 0.6-0.7 | Structured outputs, provider tool adapters, contract validators, and quality reports. |
| 0.3-0.5 | Tool execution loop, memory/project context, recipes, and extension APIs. |

For detailed release notes, see [`CHANGELOG.md`](CHANGELOG.md).

## Why HandoffKit?

Multi-agent systems break when context handoffs are vague. One agent makes a
decision, another agent never sees it. One agent finds an error, the next agent
gets only a polished summary. Files, constraints, and validation evidence vanish.

HandoffKit gives you:

- `Agent`: a small role-based agent abstraction.
- `HandoffState`: a JSON-friendly contract between agents.
- `HandoffProtocol`: protocol modes for different transfer styles.
- `Team`: sequential multi-agent execution.
- `tool`: typed Python tools with schema metadata.
- `EchoProvider`: deterministic local provider for tests and demos.
- `OllamaProvider`: local Ollama integration.
- `OpenAIProvider`: OpenAI and OpenAI-compatible APIs.
- `OpenCodeZenProvider`: OpenCode Zen with GPT, Claude, Qwen, DeepSeek,
  MiniMax, GLM, Kimi, MiMo, Grok, and free model routing.
- `OpenCodeGoProvider`: OpenCode Go with curated open coding models.

## Core Concept

```python
from handoffkit import Agent, HandoffProtocol

architect = Agent("Architect", "Create implementation plans.")
coder = Agent("Coder", "Implement from structured handoff state.")

protocol = HandoffProtocol(mode="hybrid_state")

state = protocol.transfer(
    from_agent=architect,
    to_agent=coder,
    task="Create a small Python CLI calculator with tests.",
    summary="Build a dependency-free CLI with pytest coverage.",
    decisions=["Use argparse.", "Keep calculator operations pure."],
    important_files=["calculator.py", "test_calculator.py"],
    next_steps=["Implement code.", "Run pytest."],
)

state.validate()
print(state.to_json())
```

## Protocols

| Mode | What it passes | Best for |
|---|---|---|
| `natural` | Human-readable summary | Simple demos and debugging |
| `compressed` | Compact summary | Token-sensitive transfers |
| `hybrid_min` | Task, summary, next steps | Lightweight structured chains |
| `hybrid_state` | Full state contract | Replayable, testable workflows |

## Quickstart

```python
from handoffkit import Agent

agent = Agent(
    name="Planner",
    role="Create concise implementation plans.",
)

print(agent.run("Create a plan for a Python CLI app with tests."))
```

No API key required. By default, HandoffKit uses `EchoProvider`, so examples and
tests run locally and deterministically.

## Tool Schema Example

```python
from handoffkit import tool


@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


print(add.to_schema())
print(add.run(a=2, b=3))
```

Output:

```python
{
    "name": "add",
    "description": "Add two numbers.",
    "parameters": {
        "type": "object",
        "properties": {
            "a": {"type": "integer"},
            "b": {"type": "integer"},
        },
        "required": ["a", "b"],
    },
}
```

## Tool Execution Loop

Register Python tools, let an agent create structured `ToolCall` objects, execute
them through a `ToolRegistry`, and receive structured `ToolResult` objects.

```python
from handoffkit import Agent
from handoffkit.tools.filesystem import list_files, read_file

agent = Agent(
    name="FileAgent",
    role="Use tools to inspect files.",
    tools=[read_file, list_files],
)

result = agent.run_with_tools("read file README.md")
print(result.final_output)
print(result.tool_results)
```

There are two modes:

- **Deterministic/local mode**: with `EchoProvider`, HandoffKit handles simple
  tasks such as `read file README.md`, `list files .`, `write file ...`, or
  `run command ...`. This is honest local automation, not hidden AI reasoning.
- **Provider JSON mode**: if a provider returns JSON with `tool_calls`,
  HandoffKit executes those tools and feeds results into the next step until the
  provider returns `{"final": "..."}` or `max_steps` is reached.

Provider tool-call JSON:

```json
{
  "tool_calls": [
    {
      "tool_name": "read_file",
      "arguments": {
        "path": "README.md"
      }
    }
  ],
  "final": null
}
```

Safety:

- dangerous shell commands such as `rm -rf`, `del /s`, `format`, `shutdown`,
  `reboot`, `mkfs`, and `diskpart` are blocked;
- when `require_approval=True`, write and shell tools return
  `approval_required` instead of executing.

## Structured Outputs + Provider Tool Adapters

Structured outputs matter because multi-agent workflows need machine-checkable
contracts, not only polished prose. HandoffKit can ask a provider for JSON,
parse common response shapes, validate the result, and perform small safe
repairs such as removing Markdown fences or trailing commas.

```python
from handoffkit import Agent, StructuredOutputSchema

schema = StructuredOutputSchema(
    name="TaskSummary",
    fields={
        "title": str,
        "summary": str,
        "success": bool,
    },
    required=["title", "summary", "success"],
)

agent = Agent(name="Reporter", role="Return structured task summaries.")
result = agent.run_structured("Summarize the task.", schema=schema)

print(result.data)
print(result.to_markdown())
```

`Agent.run_structured()` sends schema instructions to the provider, parses the
response with `JsonOutputParser`, validates it with `StructuredOutputSchema`,
and can use `OutputRepairer` for simple JSON mistakes. It works with fake or
local providers, so normal tests do not require API keys.

Provider tool adapters keep tool calling provider-agnostic:

```python
from handoffkit import ProviderToolAdapter, ToolRegistry, tool

@tool
def read_file(path: str) -> str:
    """Read a file."""
    return f"read:{path}"

adapter = ProviderToolAdapter()
provider_tools = adapter.tools_to_provider_format([read_file])
tool_calls = adapter.parse_tool_calls({
    "tool_calls": [
        {
            "function": {
                "name": "read_file",
                "arguments": "{\"path\":\"README.md\"}",
            }
        }
    ]
})

registry = ToolRegistry([read_file])
results = [registry.execute(call) for call in tool_calls]
```

The internal format stays `ToolCall(tool_name="read_file", arguments={...})`
whether a provider returns HandoffKit JSON or function-style tool calls. This is
provider-neutral by design; HandoffKit does not require any external SDK for
normal tests.

## Handoff Quality Metrics

Quality checks are deterministic and offline. They help compare handoff states
without calling a provider or judging prose with another model.

```python
from handoffkit import HandoffQualityEvaluator, HandoffState

state = HandoffState(
    task="Create a Python CLI calculator.",
    from_agent="Architect",
    to_agent="Coder",
    summary="Build an argparse calculator with pure operations and tests.",
    decisions=["Use argparse.", "Keep operations pure."],
    important_files=["calculator.py", "test_calculator.py"],
    next_steps=["Implement calculator.py", "Run pytest -q"],
    context_refs=["README.md#real-task-demo"],
    metadata={"errors_checked": True},
)

report = HandoffQualityEvaluator().evaluate(state)
print(report.score, report.grade)
print(report.to_markdown())
```

Metrics:

| Metric | Checks |
|---|---|
| `completeness` | required fields, summary, decisions, files, context, next steps |
| `clarity` | useful summary length and non-empty decisions |
| `actionability` | next steps written as concrete actions |
| `traceability` | important files and context references |
| `error_awareness` | recorded errors or explicit error-check metadata |

## Contract Validators

Validators return `ValidationReport` objects that can be serialized, rendered as
Markdown, or raised as exceptions. Existing APIs stay compatible:
`HandoffState.validate()` still returns `self` or raises `HandoffValidationError`,
and `StructuredOutputSchema.validate()` still returns the input dictionary or
raises `OutputValidationError`.

```python
from handoffkit import (
    HandoffStateValidator,
    StructuredOutputSchema,
    StructuredOutputValidator,
    ToolSchemaValidator,
    tool,
)

@tool
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b

schema = StructuredOutputSchema(
    name="Plan",
    fields={"title": str, "ready": bool},
    required=["title", "ready"],
)

print(StructuredOutputValidator().validate(schema, {"title": "Demo", "ready": True}).to_json())
print(ToolSchemaValidator().validate(add).to_markdown())
```

## Provider Tool Formats

`ProviderToolAdapter` can render tools as HandoffKit, OpenAI function-style, or
Anthropic `tool_use` schemas. It also parses provider-native tool call payloads
back into HandoffKit `ToolCall` objects.

```python
from handoffkit import ProviderToolAdapter, tool

@tool
def read_file(path: str) -> str:
    """Read a file."""
    return f"read:{path}"

openai_adapter = ProviderToolAdapter(provider_format="openai")
anthropic_adapter = ProviderToolAdapter(provider_format="anthropic")

print(openai_adapter.tools_to_provider_format([read_file]))
print(anthropic_adapter.tools_to_provider_format([read_file]))

calls = openai_adapter.parse_tool_calls({
    "tool_calls": [
        {
            "id": "call_123",
            "type": "function",
            "function": {"name": "read_file", "arguments": "{\"path\":\"README.md\"}"},
        }
    ]
})
print(calls[0].tool_name, calls[0].arguments, calls[0].call_id)
```

## Replayable Workflows

Run traces turn team, recipe, and tool execution reports into durable evidence.
Replay does not call providers or tools again; it inspects a saved trace.

```python
from handoffkit import Agent, HandoffProtocol, RunTrace, Team

team = Team(
    agents=[Agent("Planner", "Plan."), Agent("Reviewer", "Review.")],
    protocol=HandoffProtocol(mode="hybrid_state"),
)

result = team.run("Prepare a release checklist.")
trace = RunTrace.from_team_result(result)

print(trace.to_json())
print(trace.to_markdown())
```

## Run Traces

`RunTrace` can be created from `TeamRunResult`, `RecipeRunResult`, and
`ToolExecutionReport`.

```python
from handoffkit import FileTraceStore, ReplayRunner, RunTrace

trace = RunTrace.from_team_result(result, name="release-checklist")
path = FileTraceStore("traces").save(trace)
loaded = FileTraceStore("traces").load(path)
summary = ReplayRunner(loaded).summary()

print(summary.to_markdown())
```

## Report Files

Any report object with `to_json()`, `to_markdown()`, or `to_dict()` can be
written consistently:

```python
from handoffkit import write_report_files

json_path, markdown_path = write_report_files(trace, "trace_demo")
```

## Evaluation Suite

Use `WorkflowEvaluator` to check whether workflow artifacts are ready to ship:

```python
from handoffkit import RunTrace, WorkflowEvaluator

trace = RunTrace.from_team_result(team_result)
report = WorkflowEvaluator().evaluate(trace)
print(report.to_markdown())
```

The evaluator runs offline and checks contracts, handoff quality, replay
summaries, trace completeness, and tool result success.

## Async Runtime

Synchronous APIs remain the compatibility baseline. Async helpers are additive:

```python
from handoffkit import Agent, Team

team = Team([Agent("Planner", "Plan."), Agent("Reviewer", "Review.")])
result = await team.arun("Prepare a release checklist.")
```

Providers can implement native `agenerate()`, or use HandoffKit's default
thread-backed async wrapper.

## Project Templates

Start small offline projects with built-in templates:

```bash
handoffkit init my-agent --template basic-agent --output .
handoffkit init my-team --template team-workflow --output .
handoffkit init coding-review
handoffkit init support-escalation
handoffkit init research-workflow
```

Templates never overwrite existing files unless `--force` is passed.

## CLI Doctor

```bash
handoffkit doctor
handoffkit api
handoffkit demo-async
handoffkit demo-trace
handoffkit demo-replay
handoffkit demo-coding-review
handoffkit demo-support
handoffkit demo-research
handoffkit demo-doctor
handoffkit report runs/latest
handoffkit validate-report examples/fixtures/reports/trace_demo.json
handoffkit evaluate examples/fixtures/reports/trace_demo.json
```

`doctor` runs local package diagnostics only. It does not make network calls and
does not inspect secrets.

## Stable API Surface

The following APIs are stable for the 1.x series:

- `Agent`, `Team`, `HandoffState`, `HandoffProtocol`,
- `Tool`, `ToolCall`, `ToolResult`, `ToolRegistry`,
- `Recipe`, `RecipeStep`, `RecipeRunner`, `RecipeRunResult`,
- `ValidationReport`, `HandoffQualityReport`,
- `WorkflowEvaluator`, `WorkflowEvaluationReport`,
- `ProviderToolAdapter`,
- `RunTrace`, `ReplayRunner`,
- `TemplateScaffolder`, `ProjectTemplate`.

See `docs/API_STABILITY.md` and `docs/ROAD_TO_1_0.md`.

## Road to 1.0

1.0.0 completes the first stable API commitment. The stable surface is
documented in `docs/PUBLIC_API.md`, migration notes live in
`docs/MIGRATION_1_0.md`, and runtime/test/provider support policy lives in
`docs/COMPATIBILITY.md`.

## Memory + Project Context

HandoffKit can store durable project decisions, index local files, retrieve
relevant context, and hand explicit references from one agent to the next.

```python
from handoffkit import (
    Agent,
    ContextPack,
    ContextRetriever,
    JsonMemoryStore,
    ProjectIndexer,
)

memory = JsonMemoryStore("examples/output/memory.json")
memory.add(
    "Calculator CLI should use argparse and pure functions.",
    kind="decision",
    tags=["calculator", "cli"],
)

documents = ProjectIndexer(".").index()
retriever = ContextRetriever(documents)
matches = retriever.search("calculator argparse tests", limit=3)

context = ContextPack(
    query="Create a calculator CLI implementation plan.",
    documents=matches,
    memories=memory.search("calculator cli", limit=3),
)

agent = Agent("Architect", "Create concise implementation plans.")
result = agent.run_with_context(
    "Create a concise architecture plan for a Python CLI calculator.",
    context=context,
    memory=memory,
)

print(result.final_output)
print(context.to_markdown())
```

Run the included demos:

```bash
python examples/memory_demo.py
python examples/project_context_demo.py
python examples/context_handoff_demo.py
```

## Recipes + Extension API

Recipes make agent workflows reusable. Instead of wiring the same planner,
executor, reviewer, tools, context, and memory flow by hand in every script, you
can define a `Recipe` once and run it with `RecipeRunner`.

```python
from handoffkit import Agent, Recipe, RecipeRunner, RecipeStep

planner = Agent(name="Planner", role="Plan the task.")
executor = Agent(name="Executor", role="Execute the plan.")
reviewer = Agent(name="Reviewer", role="Review the result.")

recipe = Recipe(
    name="plan-execute-review",
    description="A reusable three-step workflow.",
    steps=[
        RecipeStep(name="plan", agent=planner, task="Create a plan."),
        RecipeStep(name="execute", agent=executor, task="Execute the plan."),
        RecipeStep(name="review", agent=reviewer, task="Review the output."),
    ],
)

result = RecipeRunner(recipe).run()
print(result.to_markdown())
```

Templates create common workflow shapes:

```python
from handoffkit import Agent, WorkflowTemplate

recipe = WorkflowTemplate.sequential(
    name="simple-workflow",
    agents=[
        Agent("Architect", "Plan."),
        Agent("Coder", "Build."),
        Agent("Tester", "Test."),
    ],
    task="Build a small calculator.",
)
```

Extensions bundle recipes and tools safely:

```python
from handoffkit import Extension, ExtensionRegistry

registry = ExtensionRegistry()
registry.register(
    Extension(
        name="coding",
        description="Local coding workflows.",
        version="0.1.0",
        recipes=[recipe],
        tools=[],
    )
)

print([recipe.name for recipe in registry.recipes()])
```

HandoffKit does not ship Git/GitHub APIs as core primitives. A repository agent
can be built as an extension or recipe using HandoffKit's general tools:
structured state, memory, context packs, recipes, and extension registries.

## Real Task Demo

HandoffKit includes a reproducible real task demo:

```bash
python examples/real_task_calculator.py
```

It runs this workflow:

```text
Architect -> Coder -> Tester -> Reporter
```

Task:

```text
Create a tiny Python CLI calculator with add, subtract, multiply and divide
operations, plus tests.
```

The demo creates a real generated project:

```text
examples/output/calculator_cli/
  calculator.py
  test_calculator.py
  README.md
```

It also writes reproducibility reports:

```text
examples/fixtures/reports/real_task_calculator.md
examples/fixtures/reports/real_task_calculator.json
```

The generated project is tested with `pytest`, and the report captures command,
cwd, return code, stdout, stderr, files created, provider used, model used, and
handoff flow.

## Providers

### Local deterministic provider

```python
from handoffkit import Agent

agent = Agent("Planner", "Plan work.")
print(agent.run("Prepare a package release."))
```

### Ollama

```bash
ollama pull llama3.1
ollama serve
python examples/ollama_agent.py --model llama3.1
```

### OpenAI-compatible APIs

```powershell
$env:OPENAI_API_KEY="..."
$env:OPENAI_BASE_URL="https://api.freemodel.dev/v1"
$env:OPENAI_MODEL="gpt-4o-mini"
python examples/freemodel_openai_compatible.py
```

Optional real API tests are skipped unless explicitly enabled:

```powershell
$env:HANDOFFKIT_RUN_API_TESTS="1"
$env:OPENAI_API_KEY="..."
$env:OPENAI_BASE_URL="https://api.freemodel.dev/v1"
$env:OPENAI_MODEL="gpt-4o-mini"
pytest tests_api -q
```

Use temporary or scoped provider tokens. Do not commit API keys.

### OpenCode Go and OpenCode Zen

HandoffKit can call OpenCode Go and OpenCode Zen without adding provider SDK
dependencies. Use one `OPENCODE_API_KEY`; choose the catalog-specific model with
`OPENCODE_GO_MODEL` or `OPENCODE_ZEN_MODEL`. For offline model lists, probes,
selection, and fallback routing, use the provider registry commands above.

```powershell
$env:OPENCODE_API_KEY="..."
$env:OPENCODE_GO_MODEL="deepseek-v4-flash"
python examples/opencode_go_agent.py
```

```powershell
$env:OPENCODE_API_KEY="..."
$env:OPENCODE_ZEN_MODEL="gpt-5.4"
python examples/opencode_zen_agent.py
```

Docs:
[`docs/integrations/OPENCODE.md`](docs/integrations/OPENCODE.md) and
[`docs/PROVIDERS.md`](docs/PROVIDERS.md).

## CLI

```bash
handoffkit --version
handoffkit demo
handoffkit demo-async
handoffkit demo-recipe
handoffkit demo-extension
handoffkit demo-structured
handoffkit demo-provider-tools
handoffkit demo-quality
handoffkit demo-validators
handoffkit demo-provider-formats
handoffkit doctor
handoffkit api
handoffkit demo-trace
handoffkit demo-replay
handoffkit validate-report examples/fixtures/reports/trace_demo.json
handoffkit evaluate examples/fixtures/reports/trace_demo.json
handoffkit providers list
handoffkit providers models --provider opencode-go
handoffkit providers select --provider opencode-go --models mimo-v2.5,deepseek-v4-flash --json
handoffkit init my-agent --template basic-agent --output .
```

## Examples

```bash
python examples/simple_agent.py
python examples/coding_review.py
python examples/support_escalation.py
python examples/research_workflow.py
python examples/doctor_orchestrator.py
python examples/handoff_demo.py
python examples/coding_team.py
python examples/tool_schema_demo.py
python examples/tool_execution_demo.py
python examples/fake_provider_tool_call_demo.py
python examples/opencode_go_agent.py
python examples/opencode_zen_agent.py
python examples/structured_output_demo.py
python examples/provider_tool_adapter_demo.py
python examples/handoff_quality_demo.py
python examples/contract_validation_demo.py
python examples/provider_tool_formats_demo.py
python examples/evaluation_demo.py
python examples/async_demo.py
python examples/template_demo.py
python examples/trace_demo.py
python examples/replay_demo.py
python examples/provider_matrix_demo.py
python examples/structured_recipe_demo.py
python examples/recipe_demo.py
python examples/coding_review_recipe.py
python examples/extension_demo.py
python examples/memory_demo.py
python examples/project_context_demo.py
python examples/context_handoff_demo.py
python examples/real_task_calculator.py
```

## Development

```bash
git clone https://github.com/DaosPath/handoffkit.git
cd handoffkit
cd packages/python
pip install -e ".[dev]"
```

Run checks:

```bash
ruff check .
pytest -q
python -m build
python -m twine check dist/*
```

From the repository root, the same checks are available as:

```bash
pnpm python:lint
pnpm python:test
pnpm python:build
pnpm python:twine
```

## Publishing

HandoffKit 1.0.0 was uploaded manually with `twine`. HandoffKit 1.0.1 and later
are prepared for PyPI Trusted Publishing through GitHub Actions OIDC.

Trusted Publishing keeps package tokens out of the repository and out of GitHub
Secrets. TestPyPI publishing is triggered manually from the `Publish` workflow;
real PyPI publishing is triggered by publishing a GitHub Release after CI is
green.

Trusted Publisher settings must be configured on TestPyPI and PyPI before using
the workflow:

- owner: `DaosPath`
- repository: `handoffkit`
- workflow: `publish.yml`
- TestPyPI environment: `handoffkit`
- PyPI environment: `pypi`

See `docs/RELEASE_PROCESS.md` for the full release checklist.

Local build validation still uses:

```bash
python -m build
python -m twine check dist/*
```

## Inspiration

HandoffKit is inspired by the research and reproducibility repository
[`DaosPath/state-transfer-protocols`](https://github.com/DaosPath/state-transfer-protocols),
especially its comparison of `natural`, `compressed`, `hybrid_min`, and
`hybrid_state` handoff protocols for multi-agent workflows.

HandoffKit is a developer library, not a copy of that repository.

## Roadmap

- 1.x compatibility maintenance,
- richer memory persistence adapters after 1.0,
- broader provider-specific integration examples,
- benchmark-inspired quality comparisons,
- more workflow templates and extension examples.

## License

MIT.
