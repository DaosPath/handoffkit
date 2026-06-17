<div align="center">

# HandoffKit

**Structured state transfer for multi-agent Python workflows.**

Build agent chains where each agent receives a clear contract: task, decisions,
files, errors, next steps, and metadata. No messy context soup.

[![Tests](https://github.com/DaosPath/handoffkit/actions/workflows/ci.yml/badge.svg)](https://github.com/DaosPath/handoffkit/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/handoffkit.svg)](https://pypi.org/project/handoffkit/)
![Python versions](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-blue)
![License](https://img.shields.io/badge/license-MIT-green)

```bash
pip install handoffkit
```

</div>

---

## What It Is

HandoffKit is a lightweight Python framework for building multi-agent AI
workflows where agents pass **structured state** instead of free-text summaries.

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

## What 0.4.0 Adds

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
```

## Examples

```bash
python examples/simple_agent.py
python examples/handoff_demo.py
python examples/coding_team.py
python examples/tool_schema_demo.py
python examples/tool_execution_demo.py
python examples/fake_provider_tool_call_demo.py
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

Build and validate:

```bash
python -m build
python -m twine check dist/*
```

Upload to TestPyPI first:

```bash
python -m twine upload --repository testpypi dist/*
```

Upload to PyPI only after TestPyPI install verification:

```bash
python -m twine upload dist/*
```

## Inspiration

HandoffKit is inspired by the research and reproducibility repository
[`DaosPath/state-transfer-protocols`](https://github.com/DaosPath/state-transfer-protocols),
especially its comparison of `natural`, `compressed`, `hybrid_min`, and
`hybrid_state` handoff protocols for multi-agent workflows.

HandoffKit is a developer library, not a copy of that repository.

## Roadmap

- richer contract validators,
- broader tool schema coverage,
- provider adapters,
- structured tool calling loops,
- handoff quality metrics,
- memory integrations,
- project context retrieval,
- benchmark-inspired examples,
- multi-agent workflow templates.

## License

MIT.
