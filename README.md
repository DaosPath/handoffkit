<div align="center">

<img src="docs/assets/handoffkit-hero.svg" alt="HandoffKit — contract-first multi-agent workflows across Python, JavaScript, C++, and native Rust" width="100%">

# HandoffKit

**Contract-first infrastructure for multi-agent workflows.**

Move tasks, decisions, files, errors, evidence, and next steps between agents as
validated data instead of fragile chat summaries.

[![CI](https://img.shields.io/github/actions/workflow/status/DaosPath/handoffkit/ci.yml?branch=main&label=CI&logo=github&logoColor=white&style=flat-square)](https://github.com/DaosPath/handoffkit/actions)
[![Rust Runtime](https://img.shields.io/badge/Rust_runtime-1.19.0-38bdf8?style=flat-square)](packages/rust/README.md)
[![PyPI](https://img.shields.io/pypi/v/handoffkit.svg?logo=python&logoColor=white&style=flat-square)](https://pypi.org/project/handoffkit/)
[![npm](https://img.shields.io/npm/v/@handoffkit/core.svg?logo=npm&logoColor=white&style=flat-square)](https://www.npmjs.com/package/@handoffkit/core)
[![C++20](https://img.shields.io/badge/C%2B%2B-20-7c3aed?logo=cplusplus&logoColor=white&style=flat-square)](packages/cpp/README.md)
[![License](https://img.shields.io/github/license/DaosPath/handoffkit.svg?style=flat-square)](LICENSE)

[Quick start](#quick-start) · [Runtime status](#runtime-status) · [Native Fusion](#native-c-fusion) · [Documentation](docs/README.md) · [Roadmap](ROADMAP.md)

</div>

---

## Why HandoffKit

Multi-agent systems often pass one large conversation from step to step. That
works for a demo, but it makes production workflows difficult to inspect,
validate, replay, or move between runtimes.

HandoffKit gives every transition an explicit contract:

```json
{
  "task": "Ship the authentication feature",
  "from_agent": "Architect",
  "to_agent": "Coder",
  "summary": "The API contract and threat model are ready.",
  "decisions": ["Use short-lived JWTs", "Rotate refresh tokens"],
  "important_files": ["auth.py", "tests/test_auth.py"],
  "errors": [],
  "next_steps": ["Implement login", "Run security tests"]
}
```

<img src="docs/assets/handoffkit-state-flow.svg" alt="Context soup compared with a structured HandoffState contract" width="100%">

| Principle | What it means |
|---|---|
| **Contract-first** | Agents exchange JSON-friendly state with known fields and validation rules. |
| **Cross-runtime** | Python, JavaScript, C++, and Rust contract types share the same `snake_case` wire format. |
| **Observable** | Runs can produce traces, timelines, reports, validation results, and quality scores. |
| **Offline-first** | Echo providers, fixtures, demos, and most tests run without API keys or network calls. |

---

## Quick start

### Python

```bash
pip install handoffkit
handoffkit demos
handoffkit showcase coding-review
handoffkit report runs/latest
```

### JavaScript / TypeScript

```bash
pnpm add @handoffkit/core @handoffkit/csp
pnpm add @handoffkit/node          # optional stdio and filesystem helpers
```

```javascript
import { Agent, HandoffProtocol, Team } from "@handoffkit/core";

const team = new Team({
  agents: [
    new Agent({ name: "Architect", role: "Plan the work." }),
    new Agent({ name: "Reviewer", role: "Review the handoff." }),
  ],
  protocol: new HandoffProtocol({ mode: "hybrid_state" }),
});

const result = await team.arun("Prepare a release checklist.");
```

### C++20

```bash
cmake -S packages/cpp -B packages/cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/cpp/build --config Release
ctest --test-dir packages/cpp/build -C Release --output-on-failure
```

```cpp
#include <handoffkit/handoffkit_core.hpp>

using namespace handoffkit;

std::vector<Agent> agents;
agents.emplace_back("Architect", "Plan the work", EchoProvider().as_any());
agents.emplace_back("Reviewer", "Review the handoff", EchoProvider().as_any());

Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
auto result = team.run("Prepare a release checklist");
```

### Rust

```bash
cargo run --manifest-path packages/rust/Cargo.toml -p handoffkit-cli -- csp doctor
cargo run --manifest-path packages/rust/Cargo.toml -p handoffkit-cli -- csp demo
cargo run --manifest-path packages/rust/Cargo.toml -p handoffkit --example csp_runtime_demo
```

<img src="docs/assets/coding-review-terminal.svg" alt="Five-minute HandoffKit coding review demo" width="100%">

---

## Runtime status

HandoffKit subsystems can advance independently. Each runtime has an explicit
version and maturity level; wire compatibility remains governed by HK-CSP 1.0.

| Runtime | Status | Distribution | Main surface |
|---|---|---|---|
| **Python 3.10–3.14** | Production runtime; HK-CSP session runtime experimental | [PyPI `handoffkit`](https://pypi.org/project/handoffkit/) | Agents, teams, tools, recipes, traces, asyncio channels, stdio |
| **JavaScript / TypeScript** | Production runtime; HK-CSP session runtime experimental | npm packages under `@handoffkit/*` | Browser-safe core/CSP, Node stdio, providers, recipes, templates, CLI |
| **C++20** | Experimental native runtime; local/Conan packaging only | CMake install, Conan recipe, vcpkg overlay; registry publication pending | Runtime core, CSP codecs, provider-gated TLS/CSP, tools, reports, training jobs, native Fusion |
| **Rust 1.19** | Native Tokio runtime; transport/security APIs experimental | Source workspace; crates.io publication prepared, not yet released | Contracts, protocol, sessions, TLS transport, processes, Agent/Team/Recipe, stdio/subprocess, CLI |

Runtime documentation:
[Python](packages/python/README.md) ·
[JavaScript](packages/js/README.md) ·
[C++](packages/cpp/README.md) ·
[Rust](packages/rust/README.md)

---

## Historical Rust 1.17.0 baseline

| Area | Included |
|---|---|
| **Async runtime** | Tokio sessions, bounded FIFO channels, blocking backpressure, async send/receive/select, lifecycle and clean closure |
| **Delivery semantics** | ACK/NACK, bounded retry, idempotency keys, in-memory deduplication, deadlines and propagated cancellation |
| **Local execution** | Supervised local processes, progress events, artifact references and structured redacted errors |
| **Workflows** | Native Rust Agent, Team and Recipe execution in classic or additive session mode |
| **Tools and replay** | Async tool registry, Team/Recipe trace construction and side-effect-free replay summaries |
| **Transports** | Bounded NDJSON framing, stdio, subprocess workers, handshake, correlation and graceful shutdown |
| **Interop** | Real Rust to Python/JavaScript and Python/JavaScript to Rust subprocess tests |
| **CLI** | `handoffkit-rs csp doctor`, `inspect`, `run`, `worker` and `demo` |
| **Security** | 8 MiB default frames, depth validation, process/ACK/retry limits, malformed-line rejection and orphan protection |

Contracts and HK-CSP 1.0 wire semantics are stable. Rust runtime, transport and
CLI APIs remain experimental through the 1.19 stabilization phase. The current
1.19 Rust workspace additionally contains provider-backed TLS transport and
durable security state; those capabilities remain experimental and are not
implied by this historical baseline section.

[Rust runtime guide](docs/rust/RUNTIME.md) ·
[Rust workspace](packages/rust/README.md) ·
[HK-CSP roadmap](docs/spec/HK_CSP_ROADMAP.md)

---

## What ships in 1.16.0

| Area | Included |
|---|---|
| **HK-CSP contracts** | Versioned envelopes, sessions, channels, ACK/NACK, retry, deadlines, cancellation, jobs, capabilities, progress, and artifact references |
| **Python session runtime** | Async bounded FIFO channels, local processes, deduplication, backpressure, stdio, and additive Team/Recipe session mode |
| **JavaScript session runtime** | Browser-safe `@handoffkit/csp`; Node process/stdio transports in `@handoffkit/node` |
| **Native protocol foundations** | Rust `contracts`/`protocol` workspace and C++20 CSP codecs plus ML job adapters |
| **Interop** | Offline Python ↔ JavaScript NDJSON stdio demo using the canonical `snake_case` wire format |
| **Structured handoffs** | `HandoffState`, protocol modes, shared schemas, Markdown and JSON serialization |
| **Agent runtimes** | Agent/team execution in Python, JavaScript, and C++ |
| **Validation and quality** | Contract validators, tool schema checks, deterministic handoff quality scoring |
| **Tools and providers** | Tool registries, safe local tools, provider adapters, registries, selection, and fallbacks |
| **Trace and replay** | Durable run traces, stores, replay summaries, timelines, JSON and Markdown reports |
| **Workflow composition** | Recipes, templates, extensions, project context, memory, and showcase workflows |
| **Native C++ Fusion** | Tiered multi-agent synthesis with role packs, configurable prompts, DAG execution, cache, persistence, and quality contracts |

The canonical wire contracts and cross-runtime fixtures live in
[`packages/contracts`](packages/contracts/README.md). Contract drift becomes a
CI failure instead of a production surprise.

### HandoffState vs HK-CSP

`HandoffState` defines **what information moves**: task, decisions, files,
errors, evidence, and next steps. HK-CSP defines **how it moves**: session,
channel, ordering, backpressure, acknowledgement, retries, cancellation, and
deadlines.

```python
from handoffkit import CspRuntime, RuntimeMode

runtime = CspRuntime(mode=RuntimeMode.SESSION)
session = runtime.create_session(session_id="release-review")
```

```bash
handoffkit csp doctor
handoffkit csp demo
handoffkit csp inspect packages/contracts/fixtures/message_envelope.json
```

Defaults remain safe and explicit: bounded channels (`64`), blocking
backpressure, at most three attempts, an 8 MiB frame limit, and no exactly-once
claim. `RuntimeMode.CLASSIC` is unchanged. The Python `CspRuntime` distributed
mode still provides local CSP execution; network worker routing belongs to the
explicit distributed scheduler APIs and remains experimental.

Specification: [HK-CSP](docs/spec/HK_CSP.md) ·
[wire format](docs/spec/HK_CSP_WIRE.md) ·
[security model](docs/spec/HK_CSP_SECURITY.md) ·
[1.16–1.19 roadmap](docs/spec/HK_CSP_ROADMAP.md)

---

## Demos that produce evidence

<img src="docs/assets/handoffkit-showcases.svg" alt="Coding, support, and research workflows using the same HandoffKit contract" width="100%">

| Workflow | What remains attached | Run |
|---|---|---|
| **Coding agents** | Files, design decisions, review findings, commands, and test evidence | `handoffkit showcase coding-review` |
| **Support escalation** | Charge IDs, policy checks, refund reasons, approvals, and escalation context | `handoffkit showcase support-escalation` |
| **Research workflow** | Sources, claims, confidence, corrections, citations, and writer constraints | `handoffkit showcase research-workflow` |

Additional offline demos cover media workflows, tools, structured outputs,
provider formats, memory, project context, evaluations, medical research
benchmarks, and Fusion-style panels.

- [Python demo index](docs/python/demos/README.md)
- [JavaScript demo index](docs/js/demos/README.md)
- [C++ demo index](docs/cpp/demos/README.md)
- [Rust demo index](docs/rust/demos/README.md)

---

## Trace, replay, and reports

A completed run can become durable evidence without repeating provider calls or
tool side effects.

<img src="docs/assets/handoffkit-trace-replay.svg" alt="RunTrace, storage, replay, timeline, and report pipeline" width="100%">

```python
from handoffkit import FileTraceStore, ReplayRunner, RunTrace

trace = RunTrace.from_team_result(result, name="coding-review")
FileTraceStore("runs").save(trace)

summary = ReplayRunner(trace).summary()
print(summary.to_markdown())
print(trace.to_timeline())
```

<img src="docs/assets/handoffkit-report-gallery.svg" alt="Inspectable HandoffKit JSON and Markdown reports" width="100%">

Golden reports used by demos and tests live under
[`packages/python/examples/fixtures/reports`](packages/python/examples/fixtures/reports/README.md).

---

## Native C++ Fusion

Fusion is HandoffKit's optional native C++ synthesis engine. It runs planned
multi-agent call graphs with structured handoffs and progressively stronger
quality contracts.

| Tier | Planned calls | Intended use |
|---|---:|---|
| **Lite** | 3 | Fast, compact synthesis |
| **Medium** | 3 | Balanced default with stronger structure |
| **Pro** | 5 | Multiple proposals plus critique and merge |
| **Ultra** | 5 | Wider DAG execution with stronger evidence checks |
| **Genius** | 8 | Six architect branches, synthesis, and final meta-judge |

```bash
handoffkit-cli fusion tiers
handoffkit-cli fusion explain --tier genius --profile research
handoffkit-cli fusion --provider echo --tier medium --prompt "Compare A and B."
```

Fusion supports JSON configuration, external role packs, custom prompt packs,
phase-specific generation settings, bounded parallel branches, persistence,
cache isolation, resume, provider routing, and local offline validation.

- [Fusion architecture and complete audit](docs/cpp/fusion/README.md)
- [Fusion configuration](docs/cpp/fusion/CONFIGURATION.md)
- [Fusion role packs](docs/cpp/fusion/ROLE_PACKS.md)
- [Fusion changelog](docs/cpp/fusion/CHANGELOG.md)

---

## Monorepo map

```text
handoffkit/
├── packages/
│   ├── contracts/        shared schemas and cross-runtime fixtures
│   ├── python/           production Python runtime and CLI
│   ├── js/               core, CSP, node, providers, recipes, templates, CLI
│   ├── cpp/              native C++20 runtime, CLI, tools, and Fusion
│   ├── cpp-ml/           optional native training complement
│   └── rust/             Rust contracts/protocol workspace and parity tests
├── apps/
│   └── web/              Next.js Studio and documentation experience
├── docs/
│   ├── cpp/fusion/       canonical Fusion documentation
│   ├── python/           Python guides, integrations, and launch material
│   ├── js/               JavaScript documentation hub
│   ├── rust/             Rust documentation hub
│   └── assets/           shared README diagrams
└── reports/              selected repository-level report examples
```

Start at the [documentation hub](docs/README.md) for language-specific guides.

---

## Development

```bash
git clone https://github.com/DaosPath/handoffkit.git
cd handoffkit
pnpm install

pnpm js:check
pnpm js:test
pnpm python:lint
pnpm python:test
cargo test --manifest-path packages/rust/Cargo.toml
cargo fmt --manifest-path packages/rust/Cargo.toml --all --check
cargo clippy --manifest-path packages/rust/Cargo.toml --workspace --all-targets -- -D warnings

cmake -S packages/cpp -B packages/cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/cpp/build --config Release
ctest --test-dir packages/cpp/build -C Release --output-on-failure
```

Normal tests are designed to run offline. Live provider tests and network access
must be explicitly enabled and supplied with scoped credentials.

---

## Project documentation

- [Documentation hub](docs/README.md)
- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Python API stability](docs/python/API_STABILITY.md)
- [Release process](docs/python/RELEASE_PROCESS.md)

## License

MIT — see [LICENSE](LICENSE).
