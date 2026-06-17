# HandoffKit

[![Tests](https://github.com/DaosPath/handoffkit/actions/workflows/ci.yml/badge.svg)](https://github.com/DaosPath/handoffkit/actions/workflows/ci.yml)
![Python versions](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-blue)
![Package version](https://img.shields.io/badge/version-0.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

HandoffKit helps developers build reliable multi-agent AI workflows by letting agents transfer structured state instead of messy free-text context.

## What Problem It Solves

Multi-agent systems often lose useful context at the exact moment one agent hands work to another. A prose summary may omit files, decisions, constraints, errors, and next steps. That makes workflows hard to test, replay, inspect, and improve.

HandoffKit gives you a small Python API for making those handoffs explicit:

- agents run with pluggable providers,
- tools expose metadata and JSON-schema-style parameter schemas,
- handoffs move through `HandoffState`,
- protocols choose how much state to preserve,
- team workflows can be tested locally with no API key.

## Why HandoffKit Exists

Most agent demos pass free text between roles. Real workflows need a clearer contract. HandoffKit is intentionally lightweight: it does not try to be a full orchestration platform, but it gives developers reliable primitives for state transfer, tool description, and sequential agent collaboration.

The default `EchoProvider` makes examples and tests deterministic. You can later swap in providers such as Ollama or OpenAI.

## Installation

From PyPI after publication:

```bash
pip install handoffkit
```

For local development:

```bash
pip install -e ".[dev]"
```

## Quickstart

```python
from handoffkit import Agent

agent = Agent(
    name="Planner",
    role="Create concise implementation plans."
)

print(agent.run("Create a plan for a Python CLI app with tests."))
```

No provider is required for local demos. If none is configured, HandoffKit uses `EchoProvider`.

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

Schema output:

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

Supported schema types include `str`, `int`, `float`, `bool`, `list`, and `dict`.

## HandoffState Example

```python
from handoffkit import HandoffState

state = HandoffState(
    task="Prepare a Python package for release.",
    from_agent="Architect",
    to_agent="Coder",
    summary="Package needs tests, CI, and metadata validation.",
    decisions=["Keep runtime dependencies empty."],
    important_files=["pyproject.toml", "README.md"],
    errors=[],
    next_steps=["Run pytest.", "Build wheel.", "Run twine check."],
    metadata={"mode": "hybrid_state"},
)

state.validate()
print(state.to_json())
```

`validate()` raises `HandoffValidationError` when required fields are empty or state fields have the wrong shape.

## Protocol Comparison

HandoffKit ships four protocol modes:

| Mode | Shape | Use case |
|---|---|---|
| `natural` | Human-readable handoff summary | Debugging and simple collaboration |
| `compressed` | Short compact summary | Token-sensitive handoffs |
| `hybrid_min` | Task, summary, next steps | Minimal structured transfer |
| `hybrid_state` | Full state with decisions, files, errors, metadata | Workflows that need replayable state |

```python
from handoffkit import Agent, HandoffProtocol

architect = Agent("Architect", "Create technical plans.")
coder = Agent("Coder", "Implement from handoff state.")

protocol = HandoffProtocol(mode="hybrid_state")
state = protocol.transfer(
    from_agent=architect,
    to_agent=coder,
    task="Prepare a package release.",
    summary="Use typed package metadata, tests, CI, and twine validation.",
    decisions=["Keep package runtime dependency-free."],
    important_files=["pyproject.toml", "README.md"],
    next_steps=["Implement changes.", "Run pytest and twine check."],
)

print(state.to_json())
```

## Architect -> Coder -> Tester Example

Run the local example:

```bash
python examples/coding_team.py
```

The example shows:

1. Architect receives a task.
2. Architect produces decisions and next steps.
3. Coder receives `HandoffState`.
4. Coder produces simulated implementation output.
5. Tester receives state from Coder.
6. Tester produces a final result.

It runs without an API key using `EchoProvider`.

## Real Task Demo

Run a reproducible multi-agent task that generates a tiny calculator CLI, tests it,
and writes Markdown and JSON evidence:

```bash
python examples/real_task_calculator.py
```

The demo creates:

- `examples/output/calculator_cli/calculator.py`
- `examples/output/calculator_cli/test_calculator.py`
- `examples/output/calculator_cli/README.md`
- `reports/real_task_calculator.md`
- `reports/real_task_calculator.json`

It uses `EchoProvider` by default, so it works without network access. If
`OPENAI_API_KEY` is configured, it tries an OpenAI-compatible provider through
`OPENAI_BASE_URL` and prefers `gpt-5.4` before falling back to `gpt-4o-mini`.

## Providers

Built-in providers:

- `EchoProvider`: deterministic local responses for tests and examples.
- `OllamaProvider`: calls a local Ollama server.
- `OpenAIProvider`: calls the OpenAI API when configured.

Ollama example:

```bash
ollama pull llama3.1
ollama serve
python examples/ollama_agent.py --model llama3.1
```

OpenAI usage requires `OPENAI_API_KEY` in your environment.

## OpenAI-compatible Providers

`OpenAIProvider` can call OpenAI-compatible chat-completions APIs by setting a custom base URL and model.

PowerShell example:

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

Use a temporary or scoped token for provider experiments. Do not commit API keys.

## Development

Install development dependencies:

```bash
pip install -e ".[dev]"
```

Run checks:

```bash
ruff check .
pytest -q
python -m build
python -m twine check dist/*
```

Useful CLI commands:

```bash
handoffkit --version
handoffkit demo
```

## Publishing

Validate before publishing:

```bash
pytest -q
python -m build
python -m twine check dist/*
```

Publish only after validating the target repository and token:

```bash
python -m twine upload dist/*
```

## Inspiration

This package is inspired by the research and reproducibility repository [`DaosPath/state-transfer-protocols`](https://github.com/DaosPath/state-transfer-protocols), especially its comparison of `natural`, `compressed`, `hybrid_min`, and `hybrid_state` handoff protocols for multilingual multi-agent workflows.

HandoffKit is a developer library, not a copy of that repository.

## Roadmap

- richer contract validators,
- better tool schema coverage,
- provider adapters,
- structured tool calling loops,
- handoff quality metrics,
- memory integrations,
- benchmark-inspired examples,
- multi-agent workflow templates.

## License

MIT.
