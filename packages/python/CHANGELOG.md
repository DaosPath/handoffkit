# Changelog

> This file preserves published Python package history. New monorepo-wide and
> unreleased changes are recorded in the root [`CHANGELOG.md`](../../CHANGELOG.md).

## 1.14.2

### Patch — aligned trusted release and cross-runtime hardening

- Published Python metadata and CLI version as 1.14.2 with no breaking API
  changes.
- Revalidated Ruff, the complete Python test suite, wheel/sdist construction,
  and Twine metadata before Trusted Publishing.
- Aligned the Python distribution with the 1.14.2 C++ provider/runtime
  hardening, native DRACO runner, and pnpm package safety/release gates.

## 1.14.1

### Patch — native C++ core packaging + cross-runtime safety demos

- **C++:** `handoffkit_core` vs demos/fusion split, `handoffkit::core` install consumer
  (`examples/consumer_core`), FallbackProvider + usage metrics, default safe tools
  (no shell), CI install/consumer smoke, release tarball path for GitHub assets.
- **Python:** mini demo `examples/demos/core_runtime_safety_demo.py` (FallbackProvider +
  offline text tools + Team hybrid_state).
- **JS:** `FallbackProvider` / `FailingProvider` in `@handoffkit/core` +
  `examples/core_runtime_safety_demo.js`.
- **Rust:** `examples/core_runtime_safety.rs` (HandoffState wire round-trip).
- Version bump across Python / JS / C++ / Rust package metadata.

## 1.14.0

### P0 — security & quality gates

- Terminal tools run **without** `shell=True` (argv list only; shell metacharacters blocked).
- Mandatory **tool sandbox**: workspace FS root (`HANDOFFKIT_WORKSPACE` or cwd).
- Filesystem tools (`read_file` / `write_file` / `list_files` / `file_exists`) cannot escape the workspace.
- **Approvals default on** for mutating tools (`run_command`, `write_file`, …).
- CI runs **Ruff before tests**; Publish workflow has a blocking `quality-gate` (Ruff + tests + coverage).
- Coverage gate (≥80%) for `tools`, `tool_execution`, `safety`, `sandbox`, `validation`.
- Tests that need monorepo-only paths skip cleanly in bare sdist layouts.

### P1 — stabilization

- CLI implementation split into `handoffkit/_cli/` (demos, media, project, main).
- Doctor benchmark cases moved to packaged JSON (`benchmarks/data/*.json`).
- Public API tiers + `DEPRECATION.md` (Stable / Extended / Experimental, cadence).
- Studio foundation: workspace store, auth stub, DB adapter interfaces (file-backed).
- Rust and C++ READMEs rewritten (clear construction status).
- JS `@handoffkit/core` modular split (`utils`, `contracts`, `tools`, `agent`, …).

### P2 — credibility foundations

- `handoffkit.benchmarks.metrics` (latency, cost, context-loss, recovery).
- `docs/python/THREAT_MODEL.md`, root `CONTRIBUTING.md`, `docs/python/EXTERNAL_BENCHMARK.md`.
- Studio MAI runs stamp `workspaceId`/`userId` via `saveStoredRunWithStudio`.
- **Independent protocol benchmark published:** `handoffkit-protocol-v1`
  (`build_independent_benchmark` / `run_independent_benchmark` /
  `methodology_manifest`, CLI `benchmark-independent`, Studio
  `GET /api/demos/benchmark/methodology`). Explicitly **not** a public
  leaderboard.

## 1.13.0

- Media **context handoffs** for multi-stage workflows: `MediaContext`,
  `MediaEditionOp`, `MediaOperationSpec`.
- Built-in media **-ion operations**: creation, generation, edition,
  transcription, translation, localization, adaptation, composition,
  inspection, validation, publication, production.
- Named pipelines: `from_scratch`, `video_dubbing`, `audiobook`,
  `subtitle_localization`, `edit_existing`.
- Helpers: `build_media_context`, `handoff_media_context`,
  `plan_media_pipeline`, `build_creation_context`, `build_generation_context`,
  `build_edition_context`, `apply_transcript_editions`,
  `media_context_to_workflow_report`, `to_handoff_state` / `from_handoff_state`.
- CLI: `handoffkit media ops`, `handoffkit media pipeline`,
  `handoffkit demo-media-context`.
- Docs: expanded `MEDIA_WORKFLOWS.md` for 1.13 context-passing model.
- **JS parity:** same media context / -ion API in `@handoffkit/recipes`
  (camelCase DX, snake_case wire JSON matching Python).
- Workspace rule: Python ↔ JS public surface must ship 1:1 (see `AGENTS.md`).
- Bumped aligned package versions to 1.13.0 (Python, JS, Rust, C++).

## 1.12.0

- Added dynamic extension scaffolding demos and CLI helpers for complex audit
  style extensions (Python + JS).
- Expanded fusion-style and media demo entry points in the JS CLI.
- Added `project-report` command, CLI aliases, and programmatic export helpers.
- Shipped Studio MAI panel (web) with dual providers and run history docs.
- Added public monorepo package `packages/localize` (`handoffkit-localize` /
  `hk-localize`) with PG sample *The Ballot and the Bridge* — separate PyPI
  name; not part of the `handoffkit` wheel.
- Bumped aligned package versions to 1.12.0 (Python, JS, Rust, C++).

## 1.11.0

- Refactored Python package layout; expanded benchmarks (doctor, MAI).
- Ported memory, extension registry, fusion, and media helpers to JavaScript.
- Added JS doctor and MAI benchmark tooling under `@handoffkit/cli`.
- Expanded recipes package surface and cross-runtime tests.
- Bumped aligned package versions to 1.11.0.

## 1.10.0

- Release train aligned with GitHub Release `v1.10.0` / PyPI `1.10.0`.
- Prior features from the 1.10 line shipped on that tag (see git history and
  release notes for `v1.10.0`).

## 1.9.0

- Reorganized JavaScript packages under `packages/js/core` and
  `packages/js/node`.
- Kept npm package names stable as `@handoffkit/core` and `@handoffkit/node`.
- Updated pnpm workspace, CI, publishing, and docs for the nested JavaScript
  package layout.

## 1.8.9

- Split JavaScript filesystem utilities into `@handoffkit/node`.
- Kept `@handoffkit/core` browser-safe with no Node.js builtin imports.
- Added Node package tests for trace files, reports, project indexing, and
  contract inventory inspection.
- Updated npm publishing to release both `@handoffkit/core` and
  `@handoffkit/node`.

## 1.8.8

- Added embedded contract inventory fallback so `ContractParityReport` works
  from installed PyPI/npm packages outside the monorepo.
- Kept the 1.8.x cross-runtime contract parity feature stable after install.

## 1.8.7

- Added cross-runtime contract parity reports.
- Expanded Rust contracts with validation reports, quality reports, tool calls,
  and tool results.
- Expanded C++ contracts with validation reports, quality reports, tool calls,
  and tool results.
- Added Rust and C++ shared fixture roundtrip tests.
- Added Rust and C++ jobs to CI.
- Updated package versions across Python, JavaScript, Rust, and C++.

## 1.7.0

- Added shared language-neutral contracts under `packages/contracts`.
- Canonicalized cross-runtime JSON wire format on snake_case keys.
- Added shared `HandoffState` and `RunTrace` fixtures used by both Python and
  JavaScript tests.
- Updated `@handoffkit/core` to read/write the same canonical contracts as the
  Python package while keeping JS-friendly camelCase properties in memory.
- Added cross-runtime contract tests so Python and JavaScript stay aligned.
- Updated docs to describe HandoffKit as a unified Python + JavaScript
  monorepo.

## 1.6.0

- Expanded the monorepo JavaScript package `@handoffkit/core`.
- Added JS async Agent and Team runtime helpers.
- Added JS tool registry, tool calls, tool results, and provider tool adapters
  for HandoffKit, OpenAI, and Anthropic-style formats.
- Added JS FileTraceStore plus report read/write utilities.
- Added retry policy helpers for provider/router packages to build on.
- Kept Python runtime API stable while preparing the cross-language contract
  layer.

## 1.5.0

- Added lightweight media workflow contracts for transcript, speaker, dubbing,
  audiobook, and translated video workflows.
- Added SRT and transcript JSON helpers.
- Added optional ffmpeg wrappers for audio extraction and video/audio muxing.
- Added offline media dubbing demo and `handoffkit demo-media`.
- Added `handoffkit media inspect` and `handoffkit media plan`.
- Kept transcription, TTS, diarization, source separation, and real video
  processing opt-in with no new runtime dependencies.

## 1.4.5

- Added native OpenAI-compatible provider wrappers for NVIDIA NIM, OpenRouter,
  Groq, xAI Grok, Together AI, Fireworks AI, DeepInfra, Perplexity, Mistral AI,
  Cerebras, SambaNova Cloud, and Z.ai / GLM.
- Added provider-specific environment variables and model defaults without
  adding provider SDK dependencies.
- Added `/models` discovery for native providers through the existing
  opt-in `handoffkit providers ... --real` workflow.
- Added a Fusion-style offline panel demo and `handoffkit demo-fusion`.

## 1.4.0

- Added experimental provider registry, model candidates, selector, probe
  results, and provider router.
- Added provider CLI commands for offline provider/model inspection and
  real opt-in probing.
- Improved OpenCode Go/Zen model routing with explicit model catalogs,
  retry/backoff, and updated provider diagnostics.
- Added provider documentation focused on OpenCode-first workflows.
- Kept clinical benchmark tooling research-only and opt-in.

## 1.3.0

- Added declarative tool creation helpers with `ToolSpec`, `ToolFactory`,
  `DeclarativeTool`, and `HttpJsonTool`.
- Added built-in public medical evidence lookup tools for PubMed,
  ClinicalTrials.gov, and DailyMed.
- Added clinical MAI-style MiMo benchmark runner with multi-stage diagnostic
  handoffs, label normalization, and report generation.
- Kept medical tools educational/research-only; no patient-care automation.

## 1.2.0

- Added `handoffkit demos` to list real-world offline showcases.
- Added `handoffkit showcase <slug>` to run a showcase and write `runs/latest`.
- Improved showcase template output with next commands after `handoffkit init`.
- Added report gallery documentation and SVG assets for README/PyPI.
- Added offline Pydantic AI integration example.
- Expanded integration docs with copy/paste adapter snippets.

## 1.1.0

- Added real-world coding, support escalation, and research workflow showcases.
- Added `handoffkit report` for rendering generated run reports.
- Added direct `handoffkit init coding-review`, `support-escalation`, and `research-workflow` templates.
- Added example scripts and deterministic reports for the new showcases.
- Improved README with a 5-minute adoption path.

## 1.0.1

- Added Trusted Publishing workflow for TestPyPI and PyPI releases.
- Added release process documentation for GitHub Actions OIDC publishing.
- Added security policy documentation.
- Improved README package trust documentation.
- Kept the 1.x public API unchanged.

## 1.0.0

- Promoted package maturity classifier to production/stable.
- Added offline workflow evaluation reports.
- Added async Agent, Team, and RecipeRunner runtime helpers.
- Added built-in project templates and CLI scaffolding.
- Added 1.0 public API and migration documentation.
- Added tests for evaluation, async runtime, templates, stable metadata, and CLI.

## 0.9.0

- Promoted package maturity classifier to beta.
- Added final pre-1.0 public API, migration, and compatibility documentation.
- Added public API export and signature compatibility tests.
- Added local wheel install smoke coverage.
- Hardened provider tool adapter validation for malformed payloads.
- Improved README and road-to-1.0 documentation.

## 0.8.0

- Added run tracing and replay summaries.
- Added FileTraceStore.
- Added report file utilities.
- Added CLI doctor, api, trace, replay and report validation commands.
- Added stable API documentation for the road to 1.0.
- Added JSON schema helpers for core contracts.
- Improved handoff quality evaluator configuration.
- Hardened provider tool adapter validation.

## 0.7.0

- Added reusable validation reports and contract validators.
- Added deterministic handoff quality metrics and reports.
- Added provider-native tool formats for HandoffKit, OpenAI, and Anthropic shapes.
- Added provider_adapter support to Agent.run_with_tools().
- Added quality, validator, and provider-format CLI demos.
- Added offline examples and Markdown/JSON reports for 0.7.0 workflows.
- Expanded tests for validators, quality scoring, provider adapters, and CLI demos.

## 0.6.0

- Added StructuredOutputSchema and StructuredOutputResult.
- Added JsonOutputParser and OutputRepairer.
- Added Agent.run_structured().
- Added ProviderCapabilities and ProviderToolAdapter.
- Added ToolCallParser for provider-style tool calls.
- Added provider_json mode to Agent.run_with_tools().
- Added structured output and provider tool adapter demos.
- Added tests for structured outputs and provider tool call normalization.

## 0.5.0

- Added RecipeStep, Recipe, RecipeRunner and RecipeRunResult.
- Added WorkflowTemplate for reusable agent workflow patterns.
- Added Extension and ExtensionRegistry.
- Added built-in recipe factories.
- Added recipe and extension demos.
- Added Markdown/JSON recipe reports.
- Added tests for recipes, templates and extensions.

## 0.4.0

- Added MemoryItem, MemoryStore, and JsonMemoryStore.
- Added project context indexing and retrieval.
- Added ContextPack for packaging retrieved files and memories.
- Added Agent.run_with_context().
- Added context_refs to HandoffState.
- Added memory and project-context examples.
- Added context handoff demo.
- Expanded README for memory and context workflows.

## 0.3.0

- Added ToolCall and ToolResult.
- Added ToolRegistry.
- Added Agent.run_with_tools().
- Added deterministic local tool execution.
- Added provider JSON tool-call loop.
- Added basic safety layer for shell/write operations.
- Added tool execution reports.
- Added examples for local and fake-provider tool execution.
- Added tests for tool execution flow.

## 0.2.0

- Added JSON-schema-style tool metadata with `Tool.to_schema()`
- Strengthened `HandoffState` contract validation
- Improved protocol-difference tests and examples
- Added a tool schema demo example
- Expanded README for package consumers
- Added basic Ruff lint configuration

## 0.1.1

- Added GitHub Actions CI
- Added badges
- Added Ollama example
- Added multi-agent coding team example
- Improved README
- Improved package validation
