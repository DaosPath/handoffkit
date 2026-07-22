# Fusion Changelog

All notable changes to the native HandoffKit Fusion subsystem are documented in
this file.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The root [`CHANGELOG.md`](../../../CHANGELOG.md) contains the concise monorepo and
release-level summary; this file preserves Fusion-specific engineering detail.
Current architecture and usage belong in the [Fusion architecture guide](README.md), not here.

## [Unreleased]

### Added

- Added differentiated Fusion tiers with cumulative quality contracts:
  Lite, Medium, Pro, Ultra, and Genius.
- Added complete JSON configuration for task, tier, mode, profile, provider,
  model routing, branch count, policies, persistence, cache, web research,
  prompts, role packs, and generation settings.
- Added configurable prompt packs for branch, skeptic, dual-merge,
  multi-branch merge, and meta-judge phases.
- Added phase-specific generation controls for `max_tokens`, `temperature`,
  `top_p`, thinking configuration, reasoning effort, and arbitrary
  OpenAI-compatible `extra_body` fields.
- Added external JSON role packs for architect, skeptic, and merger roles.
- Added bounded parallel execution for independent Ultra and Genius DAG
  architect branches.
- Added CLI controls for config files, prompt packs, role packs, branch count,
  call budgets, overlap thresholds, token ceilings, reasoning, sampling,
  parallelism, and concurrency.
- Added shipped configuration examples under
  `packages/cpp/examples/fusion/configs/`.
- Added the complete architecture and file audit in `docs/cpp/fusion/README.md`.
- Added tests for tier contracts, configurable prompts, request generation,
  parallel DAG execution, config precedence, cache isolation, and
  reasoning-only provider responses.

### Changed

- Centralized language documentation under `docs/<runtime>/`, including a
  dedicated `docs/cpp/fusion/` home for all Fusion guides.
- Genius now uses an eight-call default graph: six architect branches, one
  merge, and one final meta-judge refinement.
- Genius meta-judge output now replaces the draft merge output instead of being
  stored only as report metadata.
- Higher tiers now explicitly require progressively stronger assumptions,
  trade-off, evidence, counter-evidence, falsifier, rollback, residual-risk,
  numerical-constraint, and next-step checks.
- Explicit CLI flags now override loaded JSON values, while unspecified CLI
  defaults no longer overwrite config-owned values.
- Fusion failures now preserve the underlying provider or policy error in the
  run result, report, and CLI output.
- The subsystem documentation is now separated into:
  `docs/cpp/fusion/README.md` for current behavior and `docs/cpp/fusion/CHANGELOG.md` for history.

### Performance

- Ultra and Genius can execute independent DAG branches concurrently with a
  configurable concurrency limit.
- The engine falls back to sequential execution when shared cache behavior
  requires a single-writer path.
- A local OpenCode Go / DeepSeek V4 Flash engineering comparison measured Ultra
  at 76.68 seconds sequentially and 44.73 seconds with parallel branches.
  Genius completed in 85.76 seconds after previously exceeding 115 seconds.
  These are local measurements, not official benchmark results.

### Fixed

- Fixed stale documentation and help text that described Genius as seven calls
  instead of eight.
- Fixed JSON/CLI precedence where defaults could turn a configured Genius DAG
  into a Lean or Neutral run.
- Fixed an `opt.extra` reset that erased explicit `--out` and `--no-write`
  markers.
- Fixed output and cache paths so config-owned values remain authoritative when
  their corresponding CLI flags are absent.
- Fixed explicit `--mode` precedence over the tier-derived execution graph.
- Fixed cache keys so provider `extra_body`, thinking, and reasoning settings
  cannot reuse incompatible completions.
- Fixed merge-only resume so it forwards merge token limits, sampling values,
  and `extra_body`.
- Fixed role-pack resolution in resumed runs.
- Fixed OpenAI-compatible parsing so non-empty `reasoning_content` with empty
  final `content` is reported as a failed/truncated completion.
- Fixed the external MedCase loader to add the research-only vignette and output
  wrapper expected by corpus validation.
- Fixed stale Debug expectations for the current 30-case MedCase corpus.
- Fixed Ultra tests and scenarios that expected the full five-call graph without
  disabling the legitimate overlap early-stop.
- Fixed missing Debug include coverage for label normalization.
- Removed a dead DAG critical-path temporary and cleaned misleading indentation
  in the statistics implementation.

### Validation

- All 11 dedicated Fusion/HTTP Debug test executables pass with assertions
  enabled.
- All 15 base scenarios and 12 deep scenarios pass: 27/27 combined.
- CLI/config precedence checks pass for `--no-write`, config-owned output paths,
  explicit `--out`, explicit `--mode`, and meta-judge overrides.
- The native Fusion source audit reports 90 native files, 12,576 counted lines,
  zero padding files, and zero pure filler islands.
- The current audited Fusion-related inventory contains 107 files, including
  native code, tests, examples, package integration, cross-runtime demos, and
  this subsystem changelog.
- A local five-tier DeepSeek V4 Flash run completed successfully. Medium, Pro,
  Ultra, and Genius satisfied all 18 structural rubric items; Lite intentionally
  omitted the explicit-assumptions item under its compact contract. This is a
  local structural check, not an official capability benchmark.

## Maintenance rules

- Record every Fusion-visible feature, behavior change, performance change,
  compatibility change, deprecation, removal, security change, and meaningful
  bug fix under `Unreleased` in this file.
- Keep the root `CHANGELOG.md` concise: summarize release impact there and link
  to this file for subsystem detail.
- Describe observable behavior and user impact, not only filenames or internal
  implementation steps.
- State provider, model, conditions, and whether a measurement is local or
  official whenever recording benchmark numbers.
- At release time, move `Unreleased` entries under a versioned heading with an
  ISO date and create a new empty `Unreleased` section.
