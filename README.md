# HandoffKit 🚀

[![CI Status](https://img.shields.io/github/actions/workflow/status/DaosPath/handoffkit/ci.yml?branch=main&label=CI)](https://github.com/DaosPath/handoffkit/actions)
[![PyPI version](https://img.shields.io/pypi/v/handoffkit.svg)](https://pypi.org/project/handoffkit/)
[![npm version](https://img.shields.io/npm/v/@handoffkit/core.svg)](https://www.npmjs.com/package/@handoffkit/core)
[![License](https://img.shields.io/github/license/DaosPath/handoffkit.svg)](https://github.com/DaosPath/handoffkit/blob/main/LICENSE)

**HandoffKit** is a language-agnostic, cross-runtime framework for building multi-agent teams with **Structured State-Transfer Protocols**. It provides a unified contract layer, execution model, tool registries, context retrievers, and tracing utilities across **Python, JavaScript/TypeScript, Rust, and C++**.

By standardizing the state (the "handoff") transferred from one agent to another using deterministic JSON schemas, HandoffKit allows you to build agents in different languages that collaborate seamlessly in a single pipeline without context pollution.

---

## Key Features 🌟

* **Unified Contracts**: Shared schemas and wire formats (`snake_case` JSON) ensure `HandoffState` and `RunTrace` transition between Python, JS, Rust, and C++ workflows out-of-the-box.
* **Symmetrical Runtimes**: Symmetrical API patterns for offline/online agent execution, multi-agent teams, tool adapters, and context retrievers.
* **Handoff State Protocols**: Choose how state is transferred (`hybrid_state`, `natural_handoff`, or `compressed_state`) to control prompt token sizes and prevent context drift.
* **Cross-Language Tool Execution**: Unified definitions for agent tools (`defineTool`), registries, and structured provider payload adapters.
* **Visual Timeline**: Generate structured markdown execution timelines (`to_timeline()`) for easy debugging of multi-agent runs.

---

## Monorepo Structure 📁

```text
handoffkit/
  packages/
    contracts/       # Shared JSON schemas and cross-runtime test fixtures
    python/          # Python package published to PyPI as handoffkit
    js/              # JavaScript contract package published as @handoffkit/core
    rust/            # Rust crate with serde serialization support
    cpp/             # C++ library with CMake, Conan, and nlohmann_json support
  apps/
    web/             # Next.js showcase app and developer documentation
```

---

## Symmetrical Code Examples 💻

Below is how you declare a `HandoffState` and serialize it to markdown/JSON across all four supported runtimes.

### 🐍 Python
```python
from handoffkit import HandoffState

state = HandoffState(
    task="Implement user authorization",
    from_agent="Architect",
    to_agent="Coder",
    summary="API contract is finalized.",
    decisions=["Use JWT authentication", "Store secrets in env"],
    important_files=["auth.py", "pyproject.toml"],
    next_steps=["Write unit tests", "Create login handler"]
)

# Convert to Markdown or JSON
markdown_report = state.to_markdown()
json_payload = state.to_json()

# Parse back
loaded = HandoffState.from_markdown(markdown_report)
```

### 🟨 JavaScript / TypeScript
```javascript
import { HandoffState } from "@handoffkit/core";

const state = new HandoffState({
  task: "Implement user authorization",
  fromAgent: "Architect",
  toAgent: "Coder",
  summary: "API contract is finalized.",
  decisions: ["Use JWT authentication", "Store secrets in env"],
  importantFiles: ["auth.js", "package.json"],
  nextSteps: ["Write unit tests", "Create login handler"]
});

// Convert to Markdown or JSON
const markdownReport = state.toMarkdown();
const jsonPayload = state.toJSONString();

// Parse back
const loaded = HandoffState.fromMarkdown(markdownReport);
```

### 🦀 Rust
```rust
use handoffkit::HandoffState;

let state = HandoffState {
    task: "Implement user authorization".to_string(),
    from_agent: "Architect".to_string(),
    to_agent: "Coder".to_string(),
    summary: "API contract is finalized.".to_string(),
    decisions: vec!["Use JWT authentication".to_string()],
    important_files: vec!["Cargo.toml".to_string()],
    errors: vec![],
    next_steps: vec!["Write unit tests".to_string()],
    context_refs: vec![],
    metadata: std::collections::HashMap::new(),
};

// Convert to Markdown
let markdown_report = state.to_markdown();

// Parse back
let loaded = HandoffState::from_markdown(&markdown_report);
```

### ⚙️ C++ (C++17)
```cpp
#include <handoffkit/handoff.hpp>
#include <iostream>

using namespace handoffkit;

HandoffState state;
state.task = "Implement user authorization";
state.from_agent = "Architect";
state.to_agent = "Coder";
state.summary = "API contract is finalized.";
state.decisions = {"Use JWT authentication"};
state.important_files = {"CMakeLists.txt"};
state.next_steps = {"Write unit tests"};

// Convert to Markdown
std::string markdown_report = state.to_markdown();

// Parse back
HandoffState loaded = HandoffState::from_markdown(markdown_report);
```

---

## Quick Start Development 🚀

### Prerequisites
* [Node.js](https://nodejs.org/) (v22+)
* [pnpm](https://pnpm.io/) (v11.1.1+)
* [Python](https://www.python.org/) (v3.10+)
* [Rust](https://www.rust-lang.org/) (Cargo)
* [CMake](https://cmake.org/) (v3.15+)

### Installation
Clone the repository and install all workspace dependencies:
```bash
git clone https://github.com/DaosPath/handoffkit.git
cd handoffkit
pnpm install
```

### Running Tests Across Runtimes

* **JavaScript**:
  ```bash
  pnpm js:test
  ```
* **Python**:
  ```bash
  pnpm python:test
  ```
* **Rust**:
  ```bash
  cd packages/rust
  cargo test
  ```
* **C++**:
  ```bash
  cd packages/cpp
  cmake -B build
  cmake --build build --config Release
  ctest --test-dir build -C Release --output-on-failure
  ```

---

## Roadmap & Community 🗺️

1. **Additional Language Ports**: Go (Golang) package is planned for version `1.9.0`.
2. **Standardized Benchmarks**: Cross-runtime stability and rescue diagnostics under different LLM providers.
3. **Web-based Visualizer**: An interactive Next.js application to upload `RunTrace` JSON structures and render interactive team graphs.

## License 📄

HandoffKit is open-source software licensed under the [MIT License](LICENSE).
