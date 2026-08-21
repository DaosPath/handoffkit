# Changelog

All notable changes to the HandoffKit monorepo are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
HandoffKit uses semantic versioning for published releases. Subsystem changelogs
contain deeper engineering history; this root file remains the concise public
release summary.

## [1.19.5] - 2026-08-21

Repository reorganization and mass release alignment. This is the 1.19.5 train
that completes the repository convergence before the Browser Platform.

### Changed

- Repository layout now language-first: `python/packages/handoffkit`,
  `python/packages/handoffkit-localize`, `js/packages/*`, `rust/`,
  `go/handoffkit`, `cpp/packages/handoffkit`, `cpp/packages/handoffkit-ml`,
  `shared/contracts`, `apps/studio-web`, `validation/benchmarks`. History-preserving
  `git mv`, pnpm workspace `js/packages/*`, Cargo `rust/`, Go `go/handoffkit`,
  CMake `cpp/packages/handoffkit`, Python `python/packages/handoffkit`, and CI/docs/scripts
  updated. Public package names (`handoffkit`, `@handoffkit/*`, Rust crates, Go import
  path, C++ `handoffkit::*`, HK-CSP `1.0` wire) and `snake_case` canonical JSON remain unchanged.
- Aligned participating products to **1.19.5**: Python `handoffkit==1.19.5`,
  JS `@handoffkit/core@1.19.5`, `@handoffkit/csp@1.19.5`, `@handoffkit/providers@1.19.5`,
  `@handoffkit/node@1.19.5`, `@handoffkit/recipes@1.19.5`, `@handoffkit/templates@1.19.5`,
  `@handoffkit/cli@1.19.5`, `@handoffkit/browser@1.19.5` (Lite facade), Rust workspace `1.19.5`,
  C++ `1.19.5`. Browser `Core/Lite/Real` split and `clinical` remain at `1.20` and are not part of the 1.19.5 train.
- `pnpm-workspace.yaml`, `scripts/js/tsconfig.json`, `scripts/js/validate-workspace.mjs`,
  `scripts/validate-repository-path-map.mjs` (`wave-5-validation`), `package.json` scripts
  (`js:check`, `python:*`, `rust:test`, `cpp:test`, `web:*`), and JS package `repository.directory`
  fields updated for the new layout. Contracts moved `packages/contracts` → `shared/contracts`.

### Validation

- `pnpm workspace:validate` (8 JS pkgs + studio-web), `workspace:paths` (13 paths),
  `js:pack:check` (8 tarballs), `js:test` (all packages), `check` (workspace + studio + media)
  pass on the reorg tree. Python Ruff, Rust `cargo fmt --check` / `clippy -D warnings`,
  and Go `gofmt -l` gates pass; `shared/contracts` parity restored.

## [Unreleased]

The current 1.19 development branch is a security contract and hardening
baseline. It is not yet a complete or publishable 1.19 release.

### Added

- Added real TLS 1.3 client/server transports for Python, Node, Go, and Rust,
  including configured/system roots, hostname verification, mTLS, structured
  failures, timeouts, and real-socket positive and negative tests. C++ TLS is
  unavailable.
- Added certificate-derived peer identity for those four secure transports.
  URI SAN claims and locally calculated fingerprints are checked against every
  declared identity field; capabilities come from local fingerprint policy.
- Integrated peer/session-scoped nonce, sequence, and timestamp replay checks
  and local capability authorization into secure receive paths before
  dispatch. Cryptographic replay state remains process-local.
- Added maintained-provider Ed25519 artifact signing and verification in
  Python, Node, Go, Rust, and optional C++ Crypto, with one canonical shared
  vector and negative trust/tamper/expiry/revocation tests.
- Added provider-detected, fail-closed `X25519MLKEM768` TLS in compatible Node
  and Go environments, including a Node 24 to Go 1.26 mTLS interoperability
  gate that checks the negotiated curve and certificate-bound client identity.
  Python, Rust, C++, browser-safe JS, and incompatible providers report it
  unavailable; no fallback to `standard` occurs.
- Added a C++20 bounded native worker using `std::jthread`/`std::stop_token`,
  backpressure, cancellation, deadlines, progress, artifact results,
  ACK/NACK adaptation, and graceful shutdown.
- Added real local cpp-ml `TrainingJob` and `EvaluationJob` execution through
  the native worker, including progress, checkpoint/report artifacts,
  cancellation, deadlines, failures, and CPU/CUDA metadata.
- Added shared five-runtime security conformance vectors and live security
  benchmarks for TLS/reconnect/throughput/signatures and C++ workers.
- Added development file-backed credential stores in Python and Node with
  lifecycle/path/POSIX private-key permission checks.
- Added experimental isolated Crypto Lab (`packages/python/handoffkit/crypto_research`) for education, fuzzing, and research, strictly forbidden from production runtime fallbacks.

### Security

- Public security status is now classified as stable, experimental,
  provider-dependent, local-only, partially integrated, planned, or
  unavailable in `HK_CSP_SECURITY.md`.
- Algorithm names, signature fields, JSON identity claims, and profile enums no
  longer count as support. Runtime capability reports are provider-derived and
  unsupported profile selection fails closed.
- Secure Python and Node sockets must originate from their validated transport
  factories; Go verifies the negotiated group when a TLS socket is wrapped as
  `hybrid-pq`. External contexts cannot silently bypass profile requirements.
- CRL/OCSP, trust-store live reload, certificate rotation/reconnect lifecycle,
  OS keystores, zeroization guarantees, durable secure recovery, ARM64/edge
  qualification, and Studio security visibility remain unavailable.
- TLS integration certificates and private keys are generated into temporary
  directories for each test process. No reusable TLS or artifact-signing
  private key is committed as a test fixture.

### Compatibility

- HK-CSP wire version remains `1.0`. Shared snake_case security conformance now
  covers Python, JavaScript, Go, Rust, and C++; TLS implementations use the
  same ephemeral certificate-generation profile, not pairwise interoperability
  across every runtime.
- Python package metadata marks this development baseline as Beta rather than
  Production/Stable.
- Rust dependency resolution is locked to the declared Rust 1.82 MSRV and CI
  checks the complete workspace with that toolchain.

## [1.18.0] - 2026-07-28

### Added

- Added HK-CSP distributed runtime scheduler, worker registry with load/capability routing, heartbeat monitoring, lease deadlines, and persistent deduplication log compaction in Rust, Python, JavaScript, and Go.
- Added native Go runtime module (`github.com/DaosPath/handoffkit/go`) implementing HK-CSP 1.0 contracts, framing, bounded channels, sessions, ACK/NACK, retries, file dedup store, worker CLI, TCP/Unix transports, and cross-runtime stdio/process interop.
- Added comprehensive reliability baseline across Python, JavaScript, Rust, Go, C++, and cpp-ml, including Hypothesis, fast-check, proptest, Go generative tests, Loom state models, state-machine generators, differential validation corpus, stress profiles, and cargo-fuzz targets.
- Added length-delimited TCP framing with reconnect backoff, Unix domain socket transports, subprocess worker execution with stderr draining, and distributed job assignment/progress contracts.
- Added C++ and cpp-ml CSP adapters for training/evaluation jobs, job progress, and artifact references.

### Security

- Enforced framing byte limits before memory allocation, JSON depth validation, connection attempt limits, secret sanitization in error tracebacks, and non-shell subprocess execution.
- Formally documented that cryptography, TLS, mTLS, post-quantum signatures, and key management remain reserved for HandoffKit 1.19.0.

### Compatibility

- Wire version remains `1.0`. Canonical snake_case contracts remain 100% interoperable across Python, JavaScript, Rust, Go, C++, and cpp-ml.


### Added

- Added independent `handoffkit-runtime`, `handoffkit-transport`, and
  `handoffkit-cli` Rust crates plus the expanded `handoffkit` facade.
- Added Tokio HK-CSP sessions, bounded FIFO channels, blocking backpressure,
  cancellation, deadlines, ACK/NACK, bounded retries, idempotency-key
  deduplication, local processes, progress events, and artifact references.
- Added native Rust Agent, Team, Recipe, and RecipeRunner execution with classic
  and additive session modes.
- Added native asynchronous tool registration/execution plus Team/Recipe trace
  construction and side-effect-free replay summaries.
- Added bounded NDJSON stdio and local subprocess transports with protocol
  negotiation, correlation, structured errors, graceful shutdown, and orphan
  protection.
- Added Rust CLI commands `csp doctor`, `inspect`, `run`, `worker`, and `demo`.
- Added real-process Rust to Python/JavaScript and Python/JavaScript to Rust
  interoperability demos and CI coverage.

### Security

- Added message-size and nesting-depth limits, timestamp/config validation,
  bounded process and pending-ACK counts, retry limits, malformed NDJSON
  rejection, unknown-message NACKs, and secret-redacted errors.

### Compatibility

- HK-CSP wire version remains `1.0`; canonical snake_case contracts are
  unchanged.
- Python, JavaScript, C++, Browser, ML, and Fusion product versions remain at
  their existing releases. Rust runtime packages alone advance to 1.17.0.
- Distributed execution, Unix sockets, TCP, WebSocket, daemon and Tauri adapters
  remain unimplemented and are not claimed by this release.

## [1.16.0] - 2026-07-27

### Added

- Published the HK-CSP 1.0 specification, security model, canonical JSON
  schemas, and deterministic fixtures for sessions, channels, envelopes,
  delivery results, process errors, worker capabilities, jobs, progress, and
  artifact references.
- Added Python asyncio CSP sessions with bounded FIFO channels, blocking
  backpressure, ACK/NACK, retries, in-memory deduplication, deadlines,
  cancellation, in-process execution, and NDJSON stdio transport.
- Added browser-safe `@handoffkit/csp` and Node stdio/subprocess transports.
- Added additive CSP session execution for Python and JavaScript Team/Recipe
  runtimes while preserving classic defaults.
- Converted the Rust package into lightweight `handoffkit-contracts`,
  `handoffkit-protocol`, and `handoffkit` workspace crates.
- Added C++20 HK-CSP codecs and cpp-ml adapters for training/evaluation jobs,
  progress, capabilities, and artifacts without changing training math.
- Added offline Python-to-JavaScript stdio interoperability coverage and CLI
  commands `handoffkit csp doctor`, `demo`, and `inspect`.

### Changed

- Aligned Python, JavaScript, Rust, and C++ metadata to 1.16.0.
- Extended CI/release gates with Rust fmt/clippy/tests, cpp-ml CSP adapters,
  cross-runtime stdio testing, `@handoffkit/csp`, and prepared crates.io OIDC
  publishing.

### Compatibility

- Existing classic Agent, Team, RecipeRunner, and HandoffState behavior remains
  unchanged by default. Distributed mode remains unavailable until 1.18 and
  fails with an explicit error.

## [1.15.0] - 2026-07-26

### Added

- **Browser runtime (cross-language):** first-party web search, fetch/explore,
  HTML→Markdown, research packs, ranking, soft-block detection, and optional
  disk cache — no Chrome, Cheerio, or paid search SDKs.
- Published new npm package **`@handoffkit/browser`** (tools +
  `createBrowserAgentKit`, CLI `handoffkit-js browse`).
- Python **`handoffkit.browser`** modular package + CLI `handoffkit browse` +
  recipe `run_web_grounded_answer`.
- C++ **`handoffkit::browser`** library split from core (`handoffkit_browser`),
  with explore headers kept as compatibility aliases.
- npm Trusted Publishing matrix and docs now include `@handoffkit/browser`.

### Changed

- JS recipes optionally peer on `@handoffkit/browser` for
  `runWebGroundedAnswer`.
- Aligned Python / JS / C++ package metadata to **1.15.0**.

### Fixed

- Made npm Trusted Publishing idempotent and independently retryable per package;
  existing versions are skipped and a manual npm-only retry accepts an explicit
  release version.
- Documented that every `@handoffkit/*` package requires its own npm Trusted
  Publisher configuration even though all packages share the same scope and
  workflow.

## [1.14.2] - 2026-07-23

### Added

- Added a fully native C++ DRACO benchmark runner with JSONL loading, direct
  baseline generation, all five Fusion tiers, resumable per-task artifacts,
  batched MET/UNMET judging, official weighted aggregation, manifests, and
  JSON/Markdown summaries.
- Added native OpenAI-compatible `GET /models` discovery through
  `providers models <name>`, including OpenCode Go model enumeration.
- Added the native C++ Fusion tier system: Lite, Medium, Pro, Ultra, and Genius,
  with configurable prompts, role packs, generation policy, structured
  handoffs, persistence, cache, panels, web context, and bounded DAG
  parallelism.
- Added complete Fusion documentation and a dedicated subsystem history:
  [Fusion architecture](docs/cpp/fusion/README.md) and
  [Fusion changelog](docs/cpp/fusion/CHANGELOG.md).

### Changed

- Hardened all six pnpm packages and the private web workspace with recursive
  syntax checks, strict cross-package TypeScript validation, atomic filesystem
  writes, safer scaffolding and extension loading, and consistent package
  metadata.
- Provider requests now compose caller cancellation with timeouts, avoid
  retrying user cancellations, bound and redact HTTP errors, and keep transport
  options out of model payloads.
- Real JavaScript Fusion now uses the public `@handoffkit/providers` API and
  runs panel calls concurrently with configurable cancellation and timeout.
- Release automation now validates actual pnpm tarballs and publishes npm and
  PyPI packages through GitHub Actions Trusted Publishing/OIDC.
- DRACO resume now freezes dataset content, provider/model, judge, tier, range,
  token budgets, retries, and parallelism so incompatible runs cannot silently
  reuse prior answers. `--no-resume` explicitly clears task artifacts first.
- Redesigned the monorepo README around the current 1.14.1 runtime status,
  contract model, evidence-producing demos, trace/replay workflow, and native
  C++ Fusion. The shared README SVG suite now uses one consistent visual system
  with larger type, reduced density, and improved dark-theme readability.
- Corrected the root runtime matrix so Rust is described as an unpublished
  contract layer rather than an installable crates.io package, and C++ is
  described as a native C++20 runtime.
- Centralized long-form runtime documentation under `docs/cpp`, `docs/python`,
  `docs/js`, and `docs/rust`, with a demo index for every runtime.
- Fusion Genius now uses six architect branches, merge, and final meta-judge
  refinement for eight planned calls.
- Loaded Fusion configuration remains authoritative unless the corresponding
  CLI option is explicitly supplied.

### Performance

- Ultra and Genius can execute independent DAG branches concurrently with a
  configurable limit. Local engineering measurements and conditions are
  recorded in the Fusion-specific changelog.

### Fixed

- Made C++ provider metrics and fallback state safe under concurrent calls,
  added configurable HTTP timeouts, and bounded/sanitized HTTP error bodies.
- Prevented malformed npm tarballs caused by incorrect Windows hard-link
  deduplication by packing with pnpm and inspecting archive entries before
  publication.
- DRACO criterion judging now disables provider-side hidden thinking when
  supported, preventing reasoning-only truncation before the required JSON
  verdicts are emitted.
- Corrected Fusion configuration precedence, output-path overrides, reasoning
  cache isolation, merge-only generation settings, and truncated
  reasoning-only OpenAI-compatible responses.
- Corrected stale Debug assumptions in Fusion corpus, scenario, tier, and
  request-shape tests.

### Validation

- The full JavaScript release gate passes 94 package/web tests, strict
  TypeScript 6 checking, ESLint, recursive source checks, and archive inspection
  for all six public npm packages.
- Python Ruff, tests, wheel/sdist build, and Twine metadata checks pass for the
  aligned 1.14.2 release.
- C++ core-only and HTTP builds pass their deterministic test suites, including
  provider concurrency, HTTP parsing, DRACO loader/scorer, and resume guards.
- A local DRACO-compatible baseline over tasks 0–19 generated with
  `opencode-go/qwen3.7-plus` and judged with
  `opencode-go/deepseek-v4-pro` (thinking disabled) completed 20/20 tasks and
  783/783 criteria with no missing verdicts. Mean normalized score was 37.194%
  and median 34.5248%. This is a local reproducible engineering run, not an
  official leaderboard submission.
- The native DRACO parser validates the local original dataset as 100 tasks,
  3,934 weighted criteria, and 10 domains. HTTP and offline C++ builds pass the
  deterministic loader/scorer/baseline/resume test with Echo.
- The dedicated Fusion Debug suites, base/deep scenarios, and CLI precedence
  checks pass. Detailed counts and local measurements are recorded in
  [Fusion changelog](docs/cpp/fusion/CHANGELOG.md).

## Changelog rules

- Add every user-visible feature, behavior change, performance improvement,
  compatibility change, deprecation, removal, security change, and meaningful
  bug fix to **Unreleased** in the same change that implements it.
- Keep this root changelog concise and release-oriented. Put subsystem-specific
  implementation history in that subsystem's changelog and link it here when
  the change affects users or releases.
- Use the sections `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
  `Security`, `Performance`, and `Validation` as applicable.
- Describe user impact and observable behavior, not only internal file changes.
- Include benchmark numbers only with the provider, model, conditions, and a
  clear statement of whether the result is local, reproducible, or official.
- At release time, move Unreleased entries under a versioned heading with an
  ISO date, then create a fresh Unreleased section.

## Subsystem and historical changelogs

- Fusion subsystem history: [`docs/cpp/fusion/CHANGELOG.md`](docs/cpp/fusion/CHANGELOG.md)
- Python package release history: [`packages/python/CHANGELOG.md`](packages/python/CHANGELOG.md)
- C++ release process and packaging notes: [`packages/cpp/RELEASE.md`](packages/cpp/RELEASE.md)
