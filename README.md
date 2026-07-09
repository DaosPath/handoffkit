<div align="center">

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/handoffkit-hero.svg" alt="HandoffKit: structured state transfer for multi-agent workflows" width="100%">

# HandoffKit

**Language-agnostic, cross-runtime framework for multi-agent workflows with Structured State-Transfer Protocols.**

Build agent chains where each agent receives a clear contract: task, decisions, files, errors, next steps, and metadata — across **Python, JavaScript, Rust, and C++**.

[![CI](https://img.shields.io/github/actions/workflow/status/DaosPath/handoffkit/ci.yml?branch=main&label=CI&logo=github&logoColor=white&style=flat-square)](https://github.com/DaosPath/handoffkit/actions)
[![PyPI](https://img.shields.io/pypi/v/handoffkit.svg?logo=python&logoColor=white&style=flat-square)](https://pypi.org/project/handoffkit/)
[![npm](https://img.shields.io/npm/v/@handoffkit/core.svg?logo=npm&logoColor=white&style=flat-square)](https://www.npmjs.com/package/@handoffkit/core)
[![License](https://img.shields.io/github/license/DaosPath/handoffkit.svg?style=flat-square)](LICENSE)
![Python](https://img.shields.io/badge/python-3.10%20|%203.11%20|%203.12%20|%203.13%20|%203.14-blue?style=flat-square)

```bash
pip install handoffkit          # Python
npm install @handoffkit/core    # JavaScript
cargo add handoffkit            # Rust
# C++ — CMake FetchContent (see below)
```

<table>
  <tr>
    <td><strong>Contract-first</strong><br>Agents pass JSON-friendly state instead of vague summaries.</td>
    <td><strong>Cross-runtime</strong><br>Python, JavaScript, Rust, and C++ all share the same wire format.</td>
    <td><strong>Replayable</strong><br>Trace team, recipe, and tool runs without re-running side effects.</td>
    <td><strong>Offline by default</strong><br>Tests and demos run locally with deterministic providers.</td>
  </tr>
</table>

</div>

---

## The Problem: Context Soup → Structured Contract

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/handoffkit-state-flow.svg" alt="HandoffKit turns fragile free-text handoffs into structured HandoffState contracts" width="100%">

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
        v (HandoffState — not a vague paragraph)
Coder
        |
        v
Tester
  receives decisions, files, errors, and test evidence
```

---

## Wow in 5 Minutes

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/coding-review-terminal.svg" alt="Animated terminal demo of pip install handoffkit, coding-review init, report output, and context soup versus HandoffState" width="100%">

The demo shows the same handoff as a vague free-text summary and as structured `HandoffState`: files, decisions, errors, next steps, validation, quality, and replay evidence stay attached to the work.

```bash
pip install handoffkit
handoffkit demo
```

---

## Three Demos, One Contract

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/handoffkit-showcases.svg" alt="Three HandoffKit demos: coding agents, support escalation, and research workflow" width="100%">

| Demo | Agents | Run |
|---|---|---|
| **Coding review** | Architect → Coder → Reviewer → Tester | `python examples/coding_review.py` |
| **Support escalation** | Triage → Billing → Supervisor | `python examples/support_escalation.py` |
| **Research workflow** | Researcher → Extractor → Fact-checker → Writer | `python examples/research_workflow.py` |

---

## Trace, Replay & Reports

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/handoffkit-trace-replay.svg" alt="HandoffKit RunTrace, FileTraceStore, ReplayRunner, and reports flow" width="100%">

```python
from handoffkit import RunTrace, FileTraceStore, ReplayRunner

trace = RunTrace.from_team_result(result, name="coding-review")
store = FileTraceStore("runs/")
store.save(trace)

runner = ReplayRunner(trace)
summary = runner.summary()
# => { stepCount: 4, handoffCount: 3, success: True, ... }

# Generate a timeline
print(trace.to_timeline())
```

<img src="https://raw.githubusercontent.com/DaosPath/handoffkit/main/docs/assets/handoffkit-report-gallery.svg" alt="HandoffKit report gallery for coding agents, support escalation, and research workflow" width="100%">

---

## Supported Runtimes

| Runtime | Package | Install |
|---|---|---|
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/python.svg" width="14"/> **Python** | `handoffkit` | `pip install handoffkit` |
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/javascript.svg" width="14"/> **JavaScript / TypeScript** | `@handoffkit/core` | `npm install @handoffkit/core` |
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/rust.svg" width="14"/> **Rust** | `handoffkit` | `cargo add handoffkit` |
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/cplusplus.svg" width="14"/> **C++** | `handoffkit` | CMake `FetchContent` — see `packages/cpp/` |

All runtimes share the same `snake_case` JSON wire format so a `HandoffState` written in Rust can be read in Python and vice versa.

---

## What 1.9.0 Adds

HandoffKit 1.9.0 organizes the JavaScript packages under one clean folder:

- `@handoffkit/core` is now browser-safe and does not import `fs`, `path`, or
  any Node.js builtin,
- `@handoffkit/node` contains filesystem utilities: `FileTraceStore`,
  `writeReportFiles()`, `loadReportJSON()`, and `ProjectIndexer`,
- source lives under `packages/js/core` and `packages/js/node`,
- npm publishing now releases both JS packages together,
- CI verifies Python, browser-safe JS core, Node JS helpers, Rust, and C++.

```bash
pnpm js:check
pnpm js:test
```

Use `@handoffkit/core` in Next.js client components, Vite, browsers, Workers,
Deno, Bun, and dependency-sensitive runtimes. Use `@handoffkit/node` only for
Node.js scripts that need local files.

---

## State-Transfer Protocols

Choose how state is transferred between agents:

| Protocol | Description |
|---|---|
| **`hybrid_state`** | Default. Full `HandoffState` object inside a system contract alongside history. |
| **`natural_handoff`** | Compiles state into a natural narrative injected into chat history. |
| **`compressed_state`** | Compresses metadata to minimize prompt tokens in long pipelines. |

---

## Monorepo Structure

```text
handoffkit/
  packages/
    contracts/       # Shared JSON schemas and cross-runtime test fixtures
    python/          # PyPI: handoffkit
    js/
      core/          # npm: @handoffkit/core
      node/          # npm: @handoffkit/node
    rust/            # Cargo: handoffkit
    cpp/             # CMake + Conan: handoffkit (C++17)
  apps/
    web/             # Next.js showcase and developer documentation
  docs/
    assets/          # SVG diagrams and visual assets
```

---

## Code Examples

<details>
<summary><img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/python.svg" width="14"/> <strong>Python</strong></summary>

```python
from handoffkit import HandoffState, Agent, Team, HandoffProtocol

state = HandoffState(
    task="Implement user authorization",
    from_agent="Architect",
    to_agent="Coder",
    summary="API contract is finalized.",
    decisions=["Use JWT authentication", "Store secrets in env"],
    important_files=["auth.py", "pyproject.toml"],
    next_steps=["Write unit tests", "Create login handler"],
)

print(state.to_markdown())
print(state.to_json())
loaded = HandoffState.from_markdown(state.to_markdown())
```

</details>

<details>
<summary><img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/javascript.svg" width="14"/> <strong>JavaScript / TypeScript</strong></summary>

```javascript
import { HandoffState, Team, HandoffProtocol } from "@handoffkit/core";

const state = new HandoffState({
  task: "Implement user authorization",
  fromAgent: "Architect",
  toAgent: "Coder",
  summary: "API contract is finalized.",
  decisions: ["Use JWT authentication", "Store secrets in env"],
  importantFiles: ["auth.js", "package.json"],
  nextSteps: ["Write unit tests", "Create login handler"],
});

console.log(state.toMarkdown());
const loaded = HandoffState.fromMarkdown(state.toMarkdown());
```

</details>

<details>
<summary><img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/rust.svg" width="14"/> <strong>Rust</strong></summary>

```rust
use handoffkit::HandoffState;

let state = HandoffState {
    task: "Implement user authorization".to_string(),
    from_agent: "Architect".to_string(),
    to_agent: "Coder".to_string(),
    summary: "API contract is finalized.".to_string(),
    decisions: vec!["Use JWT authentication".to_string()],
    important_files: vec!["Cargo.toml".to_string()],
    next_steps: vec!["Write unit tests".to_string()],
    ..Default::default()
};

let md = state.to_markdown();
let loaded = HandoffState::from_markdown(&md);
```

</details>

<details>
<summary><img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/cplusplus.svg" width="14"/> <strong>C++ (C++17)</strong></summary>

```cpp
#include <handoffkit/handoff.hpp>
using namespace handoffkit;

HandoffState state;
state.task           = "Implement user authorization";
state.from_agent     = "Architect";
state.to_agent       = "Coder";
state.summary        = "API contract is finalized.";
state.decisions      = {"Use JWT authentication"};
state.important_files = {"CMakeLists.txt"};
state.next_steps     = {"Write unit tests"};

std::string md = state.to_markdown();
HandoffState loaded = HandoffState::from_markdown(md);
```

</details>

---

## Quick Start

### Prerequisites

* **Python** 3.10+ · **Node.js** v22+ · **pnpm** v11+ · **Rust** (Cargo) · **CMake** v3.15+

### Install & Run Tests

```bash
git clone https://github.com/DaosPath/handoffkit.git
cd handoffkit
pnpm install

pnpm js:test         # JavaScript core + Node helpers
pnpm python:test     # Python

cd packages/rust && cargo test               # Rust
cd packages/cpp && cmake -B build && cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure   # C++
```

---

## CLI

```bash
handoffkit --version
handoffkit demo
handoffkit demo-trace
handoffkit demo-replay
handoffkit report runs/latest
handoffkit validate-report reports/trace_demo.json
handoffkit evaluate reports/trace_demo.json
handoffkit doctor
handoffkit init my-agent --template basic-agent --output .
```

---

## Roadmap

| Version | Feature |
|---|---|
| `1.9.0` | Go (Golang) runtime package |
| `1.9.x` | Cross-runtime benchmark suite |
| `2.0.0` | Interactive RunTrace web visualizer (Next.js) |

---

## License

MIT — see [LICENSE](LICENSE).
