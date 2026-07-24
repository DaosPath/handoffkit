# Changelog

All notable changes to the HandoffKit monorepo are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
HandoffKit uses semantic versioning for published releases. Subsystem changelogs
contain deeper engineering history; this root file remains the concise public
release summary.

## [Unreleased]

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
