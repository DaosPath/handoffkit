# HandoffKit

HandoffKit is a lightweight Python framework for building multi-agent workflows with structured state transfer protocols.

HandoffKit helps developers build multi-agent AI workflows where agents pass structured state instead of messy free-text context.

The core idea is simple:

> Agents should not merely pass prose. They should pass task state.

That state can include the original task, a summary, decisions, important files, errors, next steps, and metadata. This makes handoffs easier to inspect, replay, test, and improve.

## Inspiration

This package is inspired by the research and reproducibility repository [`DaosPath/state-transfer-protocols`](https://github.com/DaosPath/state-transfer-protocols), especially its comparison of `natural`, `compressed`, `hybrid_min`, and `hybrid_state` handoff protocols for multilingual multi-agent workflows.

This is a new developer library, not a copy of that repository. The research repo focuses on experiments, task banks, validators, data freezes, and claims about protocol behavior. This package turns the same conceptual direction into a simple Python API for building agent workflows.

## What Problem It Solves

Multi-agent systems often lose context because each agent receives a loose text summary from the previous agent. That works for demos, but becomes fragile when workflows involve files, decisions, errors, validation, and long chains.

HandoffKit gives developers:

- agents with tools,
- local execution with `EchoProvider`,
- structured handoff state,
- protocol modes for different transfer styles,
- team workflows such as `Architect -> Coder -> Tester`,
- a simple CLI demo,
- tests and packaging for PyPI.

## Installation

Future PyPI installation:

```bash
pip install handoffkit
```

## Development Installation

From the project root:

```bash
pip install -e .
```

## Basic Agent

```python
from handoffkit import Agent

agent = Agent(
    name="Planner",
    role="You create technical plans."
)

result = agent.run("Create a plan for a Python CLI app")
print(result)
```

If no provider is configured, `EchoProvider` is used. It requires no API key and is useful for tests, examples, and local development.

## Tool Decorator

```python
from handoffkit import tool

@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

print(add.run(a=2, b=3))
```

Tools keep metadata such as name, description, parameters, type hints, and the original function.

## Handoff Protocol

```python
from handoffkit import Agent, HandoffProtocol

architect = Agent(
    name="Architect",
    role="Analyze projects and create technical plans"
)

coder = Agent(
    name="Coder",
    role="Write code based on received handoff state"
)

protocol = HandoffProtocol(mode="hybrid_state")

state = protocol.transfer(
    from_agent=architect,
    to_agent=coder,
    task="Create a Python package"
)

print(state.to_json())
```

## Team Workflow

```python
from handoffkit import Agent, HandoffProtocol, Team

architect = Agent("Architect", "Create technical plans")
coder = Agent("Coder", "Implement code from handoff state")
tester = Agent("Tester", "Test implementation and report errors")

team = Team(
    agents=[architect, coder, tester],
    protocol=HandoffProtocol(mode="hybrid_state")
)

result = team.run("Create a small Python CLI calculator with tests")
print(result)
```

## Protocol Modes

### `natural`

Transfers a human-readable handoff summary. Useful for simple collaboration and debugging.

### `compressed`

Transfers a compact representation that keeps the task, agents, abbreviated summary, and next steps. Useful when the handoff should stay short.

### `hybrid_min`

Transfers only `task`, `summary`, and `next_steps`. Useful when the receiving agent needs the minimum viable state.

### `hybrid_state`

Transfers the complete structured state: task, source agent, target agent, summary, decisions, important files, errors, next steps, and metadata. Useful when operational state preservation matters.

## Ollama

Run Ollama locally, then use:

```python
from handoffkit import Agent
from handoffkit.providers import OllamaProvider

agent = Agent(
    name="LocalAgent",
    role="Answer using a local model.",
    provider=OllamaProvider(model="llama3.1")
)

print(agent.run("Explain state transfer in one paragraph."))
```

The provider calls:

```txt
http://localhost:11434/api/generate
```

## OpenAI

Set your environment variable:

```bash
set OPENAI_API_KEY=your-key
```

Then:

```python
from handoffkit import Agent
from handoffkit.providers import OpenAIProvider

agent = Agent(
    name="OpenAIAgent",
    role="Answer clearly.",
    provider=OpenAIProvider(model="gpt-4o-mini")
)

print(agent.run("Create a concise implementation plan."))
```

No API keys are stored in this package.

## Included Tools

Filesystem:

- `read_file(path)`
- `write_file(path, content)`
- `list_files(path)`
- `file_exists(path)`

Shell:

- `run_command(command, cwd=None)`

Dangerous commands such as `rm -rf`, `del /s`, `format`, `shutdown`, `reboot`, `mkfs`, and `diskpart` are blocked.

Text:

- `summarize_text(text, max_chars=500)`
- `extract_keywords(text)`

## Run Tests

```bash
pytest
```

## Build Package

```bash
python -m build
```

## Publish to PyPI

After configuring a PyPI token:

```bash
python -m build
python -m twine upload dist/*
```

## Roadmap

- vector memory,
- RAG,
- JSON schema tool calling,
- Claude provider,
- GitHub integration,
- ForgeAI Studio integration,
- Rust project agents,
- repository editing agents,
- EXP01-EXP16-inspired benchmark analysis,
- contract validators,
- handoff quality metrics,
- partial reproduction utilities for the original protocol experiments.

## License

MIT.
