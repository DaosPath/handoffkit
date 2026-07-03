<div align="center">

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/handoffkit-hero.svg" alt="HandoffKit: structured state transfer for multi-agent Python workflows" width="100%">

# HandoffKit

**Structured state transfer for multi-agent Python workflows.**

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
    <td><strong>Replayable</strong><br>Trace team, recipe, and tool runs without re-running side effects.</td>
    <td><strong>Offline by default</strong><br>Tests and demos run locally with deterministic providers.</td>
  </tr>
</table>

</div>

---

## What It Is

HandoffKit is a lightweight Python framework for building multi-agent AI
workflows where agents pass **structured state** instead of free-text summaries.

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/handoffkit-state-flow.svg" alt="HandoffKit turns fragile free text handoffs into structured HandoffState contracts" width="100%">

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

## Wow in 5 Minutes

Start with a real coding-agent workflow, not an abstract toy:

```bash
pip install handoffkit
handoffkit init coding-review
cd coding-review
python coding_review.py
handoffkit report runs/latest
```

The demo shows the same handoff as a vague free-text summary and as structured
`HandoffState`: files, decisions, errors, next steps, validation, quality, and
replay evidence stay attached to the work.

## Visual Overview

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/handoffkit-trace-replay.svg" alt="HandoffKit RunTrace, FileTraceStore, ReplayRunner, and reports flow" width="100%">

HandoffKit is built around three ideas:

| Layer | API | Why it matters |
|---|---|---|
| State transfer | `HandoffState`, `HandoffProtocol`, `Team` | Agents receive explicit task, decisions, files, errors, and next steps. |
| Quality control | `ValidationReport`, `HandoffQualityReport` | Handoffs can be validated, scored, serialized, and reviewed. |
| Audit trail | `RunTrace`, `FileTraceStore`, `ReplayRunner` | Runs can be stored and replay-inspected without providers, tools, or shell. |

## What 1.1.0 Adds

HandoffKit 1.1.0 focuses on adoption:

- coding agents demo: `Architect -> Coder -> Reviewer -> Tester`,
- customer support demo: `Triage -> Billing -> Refund -> Supervisor`,
- research demo: `Researcher -> Extractor -> Fact-checker -> Writer`,
- direct templates through `handoffkit init coding-review`,
  `handoffkit init support-escalation`, and `handoffkit init research-workflow`,
- `handoffkit report runs/latest` for rendering generated run reports,
- deterministic showcase reports that work offline and require no API key.

## What 1.0.1 Adds

HandoffKit 1.0.1 is a release-trust patch:

- PyPI/TestPyPI publishing is documented around GitHub Actions Trusted Publishing,
- package tokens are not stored in the repository or workflow secrets,
- release steps are captured in `docs/RELEASE_PROCESS.md`,
- security reporting is documented in `SECURITY.md`,
- the stable 1.x public API remains unchanged.

## What 1.0.0 Adds

HandoffKit 1.0.0 is the first stable release:

- production/stable package metadata,
- frozen public API documentation for the 1.x series,
- offline `WorkflowEvaluator` reports for traces, handoffs, teams, recipes, and tools,
- async runtime helpers for `Agent`, `Team`, and `RecipeRunner`,
- safe built-in project templates through `TemplateScaffolder` and `handoffkit init`,
- migration notes from 0.9.x to 1.0.0.

## What 0.9.0 Adds

HandoffKit 0.9.0 is the final pre-1.0 stabilization release:

- beta package metadata,
- final public API documentation for 1.0 candidates,
- migration notes from 0.8.x to 0.9.x,
- compatibility documentation for Python, providers, and dependencies,
- stronger public API signature and import compatibility tests,
- local wheel install smoke coverage,
- hardened malformed provider tool-call validation.

## What 0.8.0 Adds

HandoffKit 0.8.0 prepares the package for the road to 1.0 with traceable,
replayable workflow evidence:

- `RunTrace`, `TraceStep`, and `TraceEvent` for serializable run traces,
- `FileTraceStore` for local trace storage,
- `ReplayRunner` and `ReplaySummary` for replay inspection without re-execution,
- `write_report_files()` and `load_report_json()` for report IO,
- `HandoffState.json_schema()`, `ValidationReport.json_schema()`, and
  `RunTrace.json_schema()`,
- configurable `HandoffQualityEvaluator(min_score=..., required_metrics=...)`,
- CLI commands for `doctor`, `api`, `demo-trace`, `demo-replay`, and
  `validate-report`,
- stable API documentation for the path to 1.0.

## What 0.7.0 Adds

HandoffKit 0.7.0 adds reusable validation and quality layers for mature
multi-agent workflows:

- `ValidationIssue` and `ValidationReport` for reusable contract reports,
- `HandoffStateValidator`, `StructuredOutputValidator`, and `ToolSchemaValidator`,
- `validate_report(...)` helpers while keeping existing `validate()` behavior,
- `HandoffQualityEvaluator` with deterministic handoff quality scoring,
- quality metrics for completeness, clarity, actionability, traceability, and error awareness,
- provider-native tool schemas for `handoffkit`, `openai`, and `anthropic`,
- provider-style tool call parsing with call ID preservation,
- `provider_adapter` support in `Agent.run_with_tools(...)`,
- offline quality, validator, and provider-format demos with JSON/Markdown reports.

## What 0.6.0 Adds

HandoffKit 0.6.0 adds structured outputs and provider-neutral tool adapters:

- `StructuredOutputSchema` for lightweight schemas without Pydantic,
- `StructuredOutputResult` for validated model output reports,
- `JsonOutputParser` for clean, fenced, or embedded JSON,
- `OutputRepairer` for simple JSON cleanup,
- `Agent.run_structured()` for schema-guided agent runs,
- `ProviderCapabilities` for serializable provider feature flags,
- `ProviderToolAdapter` for normalizing provider tool schemas and calls,
- `ToolCallParser` for provider-style tool call payloads,
- `provider_json` mode in `Agent.run_with_tools()`,
- structured demos and tests that run without API keys.

## What 0.5.0 Added

HandoffKit 0.5.0 adds reusable workflow building blocks:

- `RecipeStep` for one named workflow step,
- `Recipe` for reusable agent workflows,
- `RecipeRunner` and `RecipeRunResult` for execution and reports,
- `WorkflowTemplate` for common workflow patterns,
- `Extension` and `ExtensionRegistry` for safe local extension bundles,
- built-in recipe factories,
- recipe and extension demos,
- Markdown/JSON recipe reports.

This keeps HandoffKit general. Repo agents, research agents, coding agents, and
business agents can be built on top of HandoffKit without turning the core into
a GitHub- or repository-specific package.

## What 0.4.0 Added

HandoffKit 0.4.0 adds a lightweight memory and project context engine:

- `MemoryItem`, `MemoryStore`, and `JsonMemoryStore` for structured memory,
- `ProjectIndexer` for scanning local project files,
- `ContextRetriever` for deterministic keyword retrieval,
- `ContextPack` for bundling relevant files and memories,
- `Agent.run_with_context()` for context-aware agent runs,
- `HandoffState.context_refs` so agents can pass explicit context references.

No vector database. No heavy dependency stack. Just transparent, inspectable
context for agent workflows.

## What 0.3.0 Added

HandoffKit 0.3.0 adds a real tool execution loop:

- `ToolCall` and `ToolResult` models,
- `ToolRegistry` for registering and executing tools by name,
- `Agent.run_with_tools()` for structured tool loops,
- deterministic local tool execution with `EchoProvider`,
- provider JSON tool-call mode for fake or real providers,
- basic safety checks for shell and write operations,
- `ToolExecutionReport` with JSON and Markdown export.

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
handoffkit report runs/latest
handoffkit validate-report reports/trace_demo.json
handoffkit evaluate reports/trace_demo.json
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
reports/real_task_calculator.md
reports/real_task_calculator.json
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
handoffkit validate-report reports/trace_demo.json
handoffkit evaluate reports/trace_demo.json
handoffkit init my-agent --template basic-agent --output .
```

## Examples

```bash
python examples/simple_agent.py
python examples/coding_review.py
python examples/support_escalation.py
python examples/research_workflow.py
python examples/handoff_demo.py
python examples/coding_team.py
python examples/tool_schema_demo.py
python examples/tool_execution_demo.py
python examples/fake_provider_tool_call_demo.py
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
pip install -e ".[dev]"
```

Run checks:

```bash
ruff check .
pytest -q
python -m build
python -m twine check dist/*
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
