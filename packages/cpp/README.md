# HandoffKit (C++)

Native **C++20** multi-agent runtime with structured handoffs.

- **Wire parity** with Python/JS: JSON uses `snake_case` and shared fixtures under `packages/contracts/`.
- **API is idiomatic C++** (not a 1:1 clone of Python class names).
- **Packaging-first**: CMake `install`/`find_package`, Conan recipe, vcpkg overlay, release tarball + OIDC attestations (see [RELEASE.md](RELEASE.md)).

> Status: **runtime core ready for local/Conan use**; registry publish (Conan Center / vcpkg upstream) is PR-based after GitHub Release assets.

## Features

| Area | Status |
|------|--------|
| Contract types + all `packages/contracts/fixtures/*` round-trips | Done |
| `HandoffStateValidator` + `ToolSchemaValidator` | Done |
| Deterministic `HandoffQualityEvaluator` | Done |
| `EchoProvider`, `FallbackProvider`, usage metrics on `AnyProvider` | Done |
| `Agent`, `Team`, `ToolRegistry` (default safe tools, no shell) | Done |
| Protocol modes: natural, compressed, hybrid_min, hybrid_state | Done |
| In-memory `AgentMemory` | Done |
| `build_run_trace` + `write_report_json` / `write_report_files` | Done |
| Provider catalog (NVIDIA/Groq/Grok/OpenRouter/Ollama/OpenCode/…) | Done |
| Live HTTP via `OpenAiCompatibleProvider` (`HANDOFFKIT_WITH_HTTP`) | Done (default OFF) |
| Native web explorer (`explore::WebExplorer`, injectable `WebTransport`) | Done (offline fixture + optional live HTTP) |
| CMake: `handoffkit_core` vs optional `handoffkit_demos` (fusion) | Done |
| CMake install + `handoffkit::core` / `handoffkit::handoffkit` | Done |
| Conan recipe + `test_package` | Done |
| vcpkg overlay port | Done |
| Release tarball + publish workflow attestations | Done |

### Library targets

| Target | Contents |
|--------|----------|
| `handoffkit_core` / `handoffkit::core` | Runtime only (agent/team/protocol/providers/tools/explore/io) — **no fusion demos** |
| `handoffkit_demos` / `handoffkit::demos` | Demo catalog + fusion suite + CLI app sources (optional, `HANDOFFKIT_BUILD_DEMOS=ON` default) |
| `handoffkit` / `handoffkit::handoffkit` | INTERFACE → demos (full monorepo) or core when demos OFF |

```cmake
# Runtime-only consumer
target_link_libraries(app PRIVATE handoffkit::core)
# Monorepo / CLI surface
target_link_libraries(app PRIVATE handoffkit::handoffkit)
```

Core umbrella: `#include <handoffkit/handoffkit_core.hpp>`.

## Train / distill / finetune (core, lightweight)

HandoffKit does **not** embed PyTorch. It prepares **datasets**, runs **distill** (teacher LLM → student SFT JSONL), and executes a **TrainJob** via pluggable backends:

| Backend | Use |
|---------|-----|
| `echo` | Offline CI: synthetic epochs + `metrics.json` + adapter marker |
| `process` | Real trainers: `config.extra_args` = argv (`{dataset}`, `{output_dir}`, …) |

```cpp
#include <handoffkit/train/runner.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
using namespace handoffkit;
using namespace handoffkit::train;

auto teacher = EchoProvider("teacher").as_any();
EchoTrainBackend student;
auto pipe = distill_then_train(
    teacher,
    {"Explain structured handoffs.", "What is SFT?"},
    student,
    DistillThenTrainConfig{}
);
// pipe->distill.dataset.path  JSONL for student
// pipe->train.report.metrics  snake_case loss curve (echo) or process logs
```

JSONL example line: `{"format":"prompt_completion","prompt":"...","completion":"...","meta":{...}}`.

CLI (offline echo by default; demos/CLI build):

```text
handoffkit-cli train pipeline --out DIR
handoffkit-cli train distill --out DIR/student.jsonl --prompt "..."
handoffkit-cli train dataset --out data.jsonl --prompt "..."
handoffkit-cli train run --dataset data.jsonl --backend echo --out DIR
# process: repeated --extra TOKEN, or bare -- then argv
# placeholders: {dataset} {output_dir} {epochs} {job_id}
handoffkit-cli train run --dataset data.jsonl --backend process --out DIR \
  --extra python --extra scripts/hk_train_echo_stub.py \
  --extra --dataset --extra {dataset} \
  --extra --output-dir --extra {output_dir}
# equivalent:
handoffkit-cli train run --dataset data.jsonl --backend process --out DIR \
  -- python scripts/hk_train_echo_stub.py --dataset {dataset} --output-dir {output_dir}
```

Point `ProcessTrainBackend` at an external **C++** trainer binary after distill (or any non-Python exe); HandoffKit core owns job manifests, handoffs, and reports — **not** weight math.

### End-to-end: distill → native student SFT → generate

```powershell
# 1) Teacher (offline Echo) → student JSONL
handoffkit-cli train distill --out runs/e2e/student.jsonl --prompt "P: MARK42"

# 2a) Direct student train (cpp-ml; CUDA optional)
handoffkit-ml sft --dataset runs/e2e/student.jsonl --out runs/e2e/student `
  --allow-tiny --device cuda-resident --epochs 20 `
  --n-embd 64 --n-layer 2 --n-head 4 --block-size 64 --tokenizer byte

# 2b) Same via core process backend (placeholders substituted)
handoffkit-cli train run --dataset runs/e2e/student.jsonl --backend process `
  --out runs/e2e/bridge --epochs 10 -- `
  path\to\handoffkit-ml.exe sft --dataset {dataset} --out {output_dir} `
  --allow-tiny --device cuda-resident --epochs {epochs} `
  --n-embd 64 --n-layer 2 --n-head 4 --block-size 64 --tokenizer byte

# 3) Loadable model.hkckpt
handoffkit-ml generate --ckpt runs/e2e/student/model.hkckpt --prompt "P:" --max-new 16
```

JSONL wire is shared: `{"prompt":"...","completion":"..."}` (extra `format`/`meta` fields ignored by the ML loader).

### Optional: native weight training (`handoffkit-ml`)

**Core does not ship a neural trainer** (no autograd/CUDA in `handoffkit_core`).  
For **C++-only** SFT/LoRA/QLoRA/device-resident train, see the sibling complement:

- [`packages/cpp-ml/`](../cpp-ml/) — `handoffkit-ml` `0.4+` (opt-in; **not** linked from core)
- Product split: `handoffkit-cli train …` = jobs/distill; `handoffkit-ml sft|generate …` = native weights (CPU / CUDA / cuda-resident)

Default Conan/tarball/core CI remain light. See `packages/cpp-ml/NONGOALS.md`.

## Quick start (in-tree)

```powershell
cmake -S packages/cpp -B packages/cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/cpp/build --config Release
ctest --test-dir packages/cpp/build -C Release --output-on-failure
.\packages\cpp\build\example_team_handoff.exe
```

## 5 minutes: install + `handoffkit::core` consumer

Validates the path real apps use (`find_package`, not monorepo `add_subdirectory`):

```powershell
# 1) Build + install
cmake -S packages/cpp -B packages/cpp/build -DCMAKE_BUILD_TYPE=Release -DHANDOFFKIT_WITH_HTTP=OFF
cmake --build packages/cpp/build --config Release
cmake --install packages/cpp/build --prefix "$env:USERPROFILE/handoffkit-prefix" --config Release

# 2) Out-of-tree consumer (links handoffkit::core only)
cmake -S packages/cpp/examples/consumer_core -B packages/cpp/build-consumer `
  -DCMAKE_PREFIX_PATH="$env:USERPROFILE/handoffkit-prefix"
cmake --build packages/cpp/build-consumer --config Release
.\packages\cpp\build-consumer\consumer_core.exe runs/consumer_core
```

One-shot helper (configure, install, build consumer, run):

```powershell
pwsh packages/cpp/scripts/consumer_install_smoke.ps1
```

```bash
bash packages/cpp/scripts/consumer_install_smoke.sh
```

See [examples/consumer_core/README.md](examples/consumer_core/README.md).

## CLI (`handoffkit-cli`)

Built by default (`HANDOFFKIT_BUILD_CLI=ON`). Offline Echo-based demos — no API keys required.

```powershell
.\packages\cpp\build\handoffkit-cli.exe help
.\packages\cpp\build\handoffkit-cli.exe version
.\packages\cpp\build\handoffkit-cli.exe doctor
.\packages\cpp\build\handoffkit-cli.exe demos
.\packages\cpp\build\handoffkit-cli.exe team --out runs/cpp-cli/team
.\packages\cpp\build\handoffkit-cli.exe demo support_escalation --out runs/cpp-cli/support
.\packages\cpp\build\handoffkit-cli.exe demo coding_review --out runs/cpp-cli/coding
.\packages\cpp\build\handoffkit-cli.exe validate --sample-good
.\packages\cpp\build\handoffkit-cli.exe quality
.\packages\cpp\build\handoffkit-cli.exe tools list
.\packages\cpp\build\handoffkit-cli.exe explore fixture --max-depth 2
.\packages\cpp\build\handoffkit-cli.exe cases --domain support
```

Subcommands: `help`, `version`, `doctor`, `demos`, `demo`, `explore`, `team`, `tools`, `validate`, `quality`, `report`, `cases`.

### Native web explorer (fork-controllable)

First-party C++ explorer (not a browser embed). Callers own **policy** + **transport**:

```cpp
#include <handoffkit/explore/explorer.hpp>
#include <handoffkit/explore/tools.hpp>

using namespace handoffkit::explore;

auto map = make_fixture_map_transport();  // or your MapTransport / HttpTransport
WebExplorer ex(map);
ExplorePolicy pol;
pol.max_depth = 2;
pol.max_pages = 8;
pol.allow_hosts = {"fixture.local"};
pol.deny_hosts = {"evil.example"};
pol.user_agent = "MyFork/1.0";
auto result = ex.explore("https://fixture.local/", pol);
// result->to_json() is snake_case wire

ToolRegistry reg;
register_web_explorer_tools(reg, map);  // tools: web_fetch, web_explore
```

- **Offline / tests:** `MapTransport` or `make_fixture_map_transport()` (no network).
- **Live HTTPS:** build with `-DHANDOFFKIT_WITH_HTTP=ON` and use `HttpTransport` / `--transport http`.
- **Markdown field:** results include `markdown` (HTMLâ†’MD). Tools: `html_to_markdown`, `web_fetch_markdown`.
- **CLI:** `explore fixture | fetch | crawl | md | html2md | tools` with `--max-depth`, `--deny-host`, `--json`, `--markdown`.

There are **40+ demos** (team, tools, protocol matrix, validation/quality, support escalation, coding review, research, doctor panel, fusion, recipe, memory, tool stress, multi-case batch, replay, quality gates, incident response, product handoff, ...) plus a **40 unique offline corpus cases** for batch/showcase runs.
## Consume

### After `cmake --install` (recommended for apps)

```cmake
find_package(handoffkit CONFIG REQUIRED)
# Runtime only (no fusion demos):
target_link_libraries(app PRIVATE handoffkit::core)
# Or full monorepo surface (demos + fusion when HANDOFFKIT_BUILD_DEMOS=ON):
# target_link_libraries(app PRIVATE handoffkit::handoffkit)
```

```cpp
#include <handoffkit/handoffkit_core.hpp>
using namespace handoffkit;
// Team + EchoProvider + Protocol — see examples/consumer_core/main.cpp
```

When built with FetchContent for nlohmann_json, headers are installed into the same prefix.

| CMake option | Default | Meaning |
|--------------|---------|---------|
| `HANDOFFKIT_BUILD_DEMOS` | ON | Build/install `handoffkit_demos` (fusion + CLI catalog) |
| `HANDOFFKIT_BUILD_CLI` | ON | `handoffkit-cli` (requires demos) |
| `HANDOFFKIT_WITH_HTTP` | OFF | Live OpenAI-compatible HTTP provider |

### FetchContent / monorepo

```cmake
add_subdirectory(path/to/handoffkit/packages/cpp)
target_link_libraries(app PRIVATE handoffkit::handoffkit)
```

### Conan 2

```bash
cd packages/cpp
conan create . --build=missing
```

### vcpkg (overlay)

```bash
vcpkg install handoffkit --overlay-ports=packages/cpp/vcpkg-overlay/ports
```

## Minimal runtime example

```cpp
#include <handoffkit/handoffkit.hpp>
using namespace handoffkit;

int main() {
    std::vector<Agent> agents;
    agents.emplace_back("Architect", "Designs", EchoProvider().as_any());
    agents.emplace_back("Coder", "Implements", EchoProvider().as_any());

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto result = team.run("Ship the feature");
    if (!result) return 1;

    auto trace = build_run_trace("run-1", "demo", result.value());
    write_report_files("runs/latest", "report", trace);
}
```

## Layout

```
include/handoffkit/
  handoffkit.hpp
  error.hpp / version.hpp / handoff.hpp
  core/          # validation, quality
  runtime/       # agent, team, tools, protocol, memory, trace, http
  io/            # reports
src/
tests/
examples/
cmake/           # Config package + package_source_tarball
conanfile.py / conandata.yml / test_package/
vcpkg.json / vcpkg-overlay/ports/handoffkit/
scripts/package_release.ps1
RELEASE.md
```

## CMake options

| Option | Default | Meaning |
|--------|---------|---------|
| `HANDOFFKIT_BUILD_TESTS` | ON | CTest targets |
| `HANDOFFKIT_BUILD_EXAMPLES` | ON | Examples |
| `HANDOFFKIT_FETCH_JSON` | ON | Fetch nlohmann_json if missing |
| `HANDOFFKIT_WITH_HTTP` | OFF | Live HTTP client (cpp-httplib) for remote providers |

### Providers

```powershell
.\packages\cpp\build\handoffkit-cli.exe providers list
.\packages\cpp\build\handoffkit-cli.exe providers show nvidia
.\packages\cpp\build\handoffkit-cli.exe providers resolve groq --allow-missing-key
```

```cpp
#include <handoffkit/runtime/providers.hpp>

// Offline:
auto echo = handoffkit::make_provider("echo");

// Live (needs -DHANDOFFKIT_WITH_HTTP=ON and e.g. NVIDIA_API_KEY):
auto nim = handoffkit::make_provider("nvidia");  // model from NVIDIA_MODEL or default
auto groq = handoffkit::make_provider("groq", {.model = "llama-3.1-8b-instant"});
```

Catalog (aligned with Python natives): `echo`, `openai`, `nvidia`, `openrouter`, `groq`, `grok`,
`together`, `fireworks`, `deepinfra`, `perplexity`, `mistral`, `cerebras`, `sambanova`, `zai`,
`ollama`, `opencode-go`, `opencode-zen`.

Offline OpenAI response parsing is always available via `parse_openai_chat_completion` (tested without network).

## Version

`1.14.1` — keep `CMakeLists.txt`, `version.hpp`, and `conanfile.py` in sync.

## Publishing / Trusted path

See **[RELEASE.md](RELEASE.md)**.
