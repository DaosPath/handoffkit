# HandoffKit <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/githubactions.svg" width="32" height="32" align="right" style="fill: #2088FF;"/>

[![CI Status](https://img.shields.io/github/actions/workflow/status/DaosPath/handoffkit/ci.yml?branch=main&label=CI&logo=github&logoColor=white)](https://github.com/DaosPath/handoffkit/actions)
[![PyPI version](https://img.shields.io/pypi/v/handoffkit.svg?logo=python&logoColor=white)](https://pypi.org/project/handoffkit/)
[![npm version](https://img.shields.io/npm/v/@handoffkit/core.svg?logo=npm&logoColor=white)](https://www.npmjs.com/package/@handoffkit/core)
[![License](https://img.shields.io/github/license/DaosPath/handoffkit.svg?logo=git&logoColor=white)](https://github.com/DaosPath/handoffkit/blob/main/LICENSE)

**HandoffKit** is a language-agnostic, cross-runtime framework for building multi-agent teams with **Structured State-Transfer Protocols**. It provides a unified contract layer, execution model, tool registries, context retrievers, and tracing utilities across **Python, JavaScript/TypeScript, Rust, and C++**.

By standardizing the state (the "handoff") transferred from one agent to another using deterministic JSON schemas, HandoffKit allows you to build agents in different languages that collaborate seamlessly in a single pipeline without context pollution.

---

## <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/lighthouse.svg" width="22" height="22" style="vertical-align: middle;"/> State-Transfer Protocols

When routing tasks between agents, standard conversation histories quickly become cluttered with context drift. HandoffKit introduces three optimized state-transfer protocols:

* **`hybrid_state`**: The default mode. Transports the complete structured `HandoffState` (decisions, modified files, errors, next steps) inside a system contract boundary alongside conversation history.
* **`natural_handoff`**: Minimizes schema overhead by compiling the handoff state directly into a natural narrative summary that is injected seamlessly into the chat history.
* **`compressed_state`**: Compresses metadata payloads to reduce prompt token consumption in complex or long-running multi-agent pipelines.

---

## <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/gitbook.svg" width="22" height="22" style="vertical-align: middle;"/> Monorepo Structure

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

## <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/codeblocks.svg" width="22" height="22" style="vertical-align: middle;"/> Symmetrical Code Examples

Below is how you declare a `HandoffState` and serialize it to markdown/JSON across all four supported runtimes.

### <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/python.svg" width="20" height="20" style="vertical-align: middle;"/> Python
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

### <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/javascript.svg" width="20" height="20" style="vertical-align: middle;"/> JavaScript / TypeScript
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

### <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/rust.svg" width="20" height="20" style="vertical-align: middle;"/> Rust
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

### <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/cplusplus.svg" width="20" height="20" style="vertical-align: middle;"/> C++
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

## <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/timeline.svg" width="22" height="22" style="vertical-align: middle;"/> Trace Timeline Visualization

By utilizing `RunTrace.to_timeline()`, you can instantly render a structured ASCII flow representing the sequence of agent handoffs, tools executed, and completion status.

**Example Output:**
```markdown
# Execution Timeline: Support Escalation (Run ID: run-9c2b-4e81)
- Success: true
- Total Steps: 3
- Total Handoffs: 2

## Timeline
1. [Triage] -> Task: Classify customer issue renewal.
   - Mode: hybrid_state
   - Success: true
   - Tools Used: 1
   - Output Preview: Escalating renewal issues to the billing team...
   - [Handoff] -> Triage to Billing
2. [Billing] -> Task: Inspect billing records for renewal.
   - Mode: hybrid_state
   - Success: true
   - Tools Used: 2
   - Output Preview: Found duplicate charge of $49.00...
   - [Handoff] -> Billing to Supervisor
3. [Supervisor] -> Task: Approve refund request.
   - Mode: compressed_state
   - Success: true
   - Tools Used: 1
   - Output Preview: Refund processed and closed...
```

---

## <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/speedtest.svg" width="22" height="22" style="vertical-align: middle;"/> Quick Start Development

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

## <img src="https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/roadmap.svg" width="22" height="22" style="vertical-align: middle;"/> Roadmap & Community

1. **Additional Language Ports**: Go (Golang) package is planned for version `1.9.0`.
2. **Standardized Benchmarks**: Cross-runtime stability and rescue diagnostics under different LLM providers.
3. **Web-based Visualizer**: An interactive Next.js application to upload `RunTrace` JSON structures and render interactive team graphs.

## License 📄

HandoffKit is open-source software licensed under the [MIT License](LICENSE).
