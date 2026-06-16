# HandoffKit

[![Tests](https://github.com/DaosPath/handoffkit/actions/workflows/ci.yml/badge.svg)](https://github.com/DaosPath/handoffkit/actions/workflows/ci.yml)
![Python versions](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-blue)
![Package version](https://img.shields.io/badge/version-0.1.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

A lightweight Python framework for building multi-agent workflows with structured state transfer protocols.

HandoffKit helps developers build multi-agent AI workflows where agents pass structured state instead of messy free-text context.

## Why HandoffKit?

Multi-agent systems often lose context because each agent receives a loose prose summary from the previous agent. That works for demos, but it becomes fragile when workflows involve files, decisions, errors, validation, and long chains.

HandoffKit gives developers:

- deterministic local agents for tests and demos,
- structured `HandoffState` objects,
- protocol modes for different transfer styles,
- a sequential `Team` runner,
- typed tools,
- local Ollama and OpenAI provider adapters,
- package metadata and CI checks suitable for PyPI preparation.

## Core Concept

Agents should not merely pass prose. They should pass task state.

A `HandoffState` can include:

- the original task,
- source and target agent names,
- summary,
- decisions,
- important files,
- errors,
- next steps,
- metadata.

That state is JSON-friendly, testable, inspectable, and reusable across agent boundaries.

## Installation

After the package is published:

```bash
pip install handoffkit
```

For local development from a clone:

```bash
pip install -e ".[dev]"
```

## Quick Start

```python
from handoffkit import Agent

agent = Agent(
    name="Planner",
    role="Create concise implementation plans."
)

print(agent.run("Create a plan for a Python CLI app with tests."))
```

If no provider is configured, HandoffKit uses `EchoProvider`, a deterministic local provider designed for tests, examples, and package demos.

## Protocols

HandoffKit ships four protocol modes:

- `natural`: human-readable summary handoff.
- `compressed`: whitespace-normalized compact summary.
- `hybrid_min`: minimal structured state with task, summary, and next steps.
- `hybrid_state`: full structured state with decisions, files, errors, next steps, and metadata.

Example:

```python
from handoffkit import Agent, HandoffProtocol

architect = Agent("Architect", "Create technical plans.")
coder = Agent("Coder", "Implement from handoff state.")

protocol = HandoffProtocol(mode="hybrid_state")
state = protocol.transfer(
    from_agent=architect,
    to_agent=coder,
    task="Prepare a Python package for PyPI.",
    summary="Use typed package metadata, tests, CI, and twine validation.",
    decisions=["Keep runtime dependencies empty."],
    important_files=["pyproject.toml", "README.md"],
    next_steps=["Implement changes.", "Run pytest and twine check."],
)

state.validate()
print(state.to_json())
```

## Examples

Run examples from the repository root:

```bash
python examples/simple_agent.py
python examples/handoff_demo.py
python examples/coding_team.py
python examples/ollama_agent.py --model llama3.1
```

Included examples:

- `examples/simple_agent.py`: one deterministic local agent.
- `examples/handoff_demo.py`: explicit `Architect -> Coder` `HandoffState`.
- `examples/coding_team.py`: visible `Architect -> Coder -> Tester` handoff chain.
- `examples/ollama_agent.py`: real Ollama provider example with configurable model and clear startup error.
- `examples/tool_agent.py`: custom tool decorator example.

## Ollama

Start Ollama locally and pull a model:

```bash
ollama pull llama3.1
ollama serve
```

Then run:

```bash
python examples/ollama_agent.py --model llama3.1 "Explain structured agent handoffs."
```

You can also configure it with environment variables:

```bash
set OLLAMA_MODEL=llama3.1
set OLLAMA_BASE_URL=http://localhost:11434
python examples/ollama_agent.py
```

If Ollama is not running, the example exits with a clear message explaining how to start it.

## Development

Install the package with development dependencies:

```bash
pip install -e ".[dev]"
```

Run tests:

```bash
pytest -q
```

Build and validate package artifacts:

```bash
python -m build
python -m twine check dist/*
```

## Publishing

Do not publish from an unvalidated working tree.

Recommended release flow:

```bash
pytest -q
python -m build
python -m twine check dist/*
```

After configuring a PyPI token, publish with:

```bash
python -m twine upload dist/*
```

## CLI

```bash
handoffkit --version
handoffkit demo
```

## Inspiration

This package is inspired by the research and reproducibility repository [`DaosPath/state-transfer-protocols`](https://github.com/DaosPath/state-transfer-protocols), especially its comparison of `natural`, `compressed`, `hybrid_min`, and `hybrid_state` handoff protocols for multilingual multi-agent workflows.

This is a developer library, not a copy of that repository. The research repo focuses on experiments, task banks, validators, data freezes, and claims about protocol behavior. HandoffKit turns the same conceptual direction into a simple Python API for building agent workflows.

## Roadmap

- vector memory,
- RAG,
- JSON schema tool calling,
- Claude provider,
- GitHub integration,
- ForgeAI Studio integration,
- Rust project agents,
- repository editing agents,
- benchmark-inspired analysis utilities,
- richer contract validators,
- handoff quality metrics.

## License

MIT.
