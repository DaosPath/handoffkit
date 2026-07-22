# HandoffKit Fusion — Native C++ Architecture and Complete File Audit

This document is the source of truth for the advanced Fusion implementation in
HandoffKit. It describes the executable architecture, configuration precedence,
quality behavior, limitations, tests, and every file connected to Fusion in the
current monorepo audit.

- **Audited scope:** 107 files.
- **Primary implementation:** native C++ under `packages/cpp`.
- **Package location:** optional `handoffkit_demos` target; it is not part of the
  minimal `handoffkit_core` target.
- **Wire convention:** `snake_case` JSON.
- **Offline default:** `echo`; real providers require an HTTP-enabled build and
  the provider's environment credentials.
- **Subsystem history:** [`FUSION_CHANGELOG.md`](CHANGELOG.md).

## What Fusion is

Fusion is an orchestration layer that asks independent roles or models to solve
one task, transfers their state explicitly, compares or critiques the candidates,
and synthesizes a final answer. Higher product tiers change both the call graph
and the quality contract: depth, skills, tool slots, required evidence, merge
behavior, audits, and final-output structure.

Fusion is not merely “call the same model more times.” The current tier system
injects cumulative behavioral requirements and uses different graph structures.

## Product tiers

| Tier | Graph | Planned LLM calls | Distinct quality behavior |
|---|---:|---:|---|
| **Lite** | 2 architects → merge | 3 | Direct answer first, compact support, minimal scope checks. |
| **Medium** | 2 architects → deterministic pre-analysis → merge | 3 | Explicit assumptions, decomposition, trade-offs, structured support, anti-dilution. |
| **Pro** | 2 architects → 2 skeptics → merge | 5, or 3 when overlap skips skeptics | Evidence checks, repairs, counterargument, falsifier, rollback/reversal trigger, residual risk, confidence. |
| **Ultra** | 4 architect DAG → merge | 5 | Multi-angle breadth, counter-evidence, source hygiene, constraint ledger, uncertainty synthesis. |
| **Genius** | 6 architect DAG → merge → meta-judge | 8 | Exhaustive/adversarial audit, numeric-constraint preservation, risk register, decision audit, final meta-judge replacement. |

Default generation budgets are applied by `apply_fusion_tier`:

| Tier | Branch | Skeptic | Merge | Meta-judge |
|---|---:|---:|---:|---:|
| Lite | 768 | 512 | 1024 | 1200 |
| Medium | 1000 | 600 | 1400 | 1600 |
| Pro | 1300 | 800 | 2400 | 2600 |
| Ultra | 1400 | 800 | 2800 | 3000 |
| Genius | 1600 | 900 | 3000 | 3400 |

The token values are output ceilings, not guaranteed usage.

## Modes versus tiers

Tiers are product presets. Modes are lower-level execution graphs:

- `lean`: two architects and one merge.
- `ultra`: two architects, one skeptic per branch, then merge.
- `dag`: two to eight architects, then merge; optional meta-judge.
- `panel`: one call per configured provider/model role, followed by the
  deterministic panel judge and optional meta-judge.

A tier selects its default mode, branch count, call budget, generation budget,
and quality pack. An explicitly supplied CLI `--mode` overrides the tier-derived
mode. Advanced overrides can therefore create nonstandard combinations; the
report always records the effective tier, mode, branch count, planned calls, and
actual calls.

## Execution pipelines

### Lean and Pro-style dual path

1. Resolve built-in profile or external role pack.
2. Optionally gather bounded web research.
3. Run architect A and architect B.
4. Emit structured `HandoffState` records through `HybridState` protocol.
5. In `ultra` mode, calculate branch overlap and optionally run both skeptics.
6. Build merge-ready handoffs.
7. Run deterministic pre-merge panel analysis and inject it into the merge
   prompt when enabled.
8. Run merger.
9. Apply anti-dilution when enabled.
10. Optionally run a meta-judge that replaces the draft final answer.
11. Persist reports/artifacts and attach call/cache observability.

### DAG path

1. Clamp branch count to 2–8.
2. Expand a two-branch role pack with distinct generated focuses when necessary.
3. Run architect branches sequentially, or in bounded `std::async` batches.
4. Build one structured handoff per branch.
5. Inject deterministic cross-branch analysis into a multi-merge prompt.
6. Merge all candidates.
7. For Genius/default meta mode, run the final adversarial meta-judge and replace
   the merge draft.

Parallel branches are used only when `parallel_branches=true`, branch count is
above one, and Fusion cache is disabled. This is deliberate: `FusionCache` is a
single-writer-oriented LRU/disk abstraction, not a concurrent cache.

### Panel path

Panel mode resolves `provider:model` or bare model specifications, assigns
profile-aware roles, calls each slot, and creates deterministic consensus,
contradiction, gap, unique-insight, blind-spot, rubric, and final-answer fields.
With `echo`, role-keyed deterministic responses replace raw echoes for useful
offline tests. Panel mode is a panel/judge workflow; it does not currently emit
the same per-branch `HandoffState` chain as lean/ultra/DAG.

## Configuration and precedence

### Full config

```bash
handoffkit-cli fusion \
  --config packages/cpp/examples/fusion/configs/fusion_research_genius.json \
  --prompt "Your task"
```

Precedence is:

1. C++ defaults.
2. JSON `--config` values; `tier` is applied first inside JSON, then explicit
   JSON `mode`, `branch_count`, generation, policy, and other fields override it.
3. Explicit CLI flags override loaded values.
4. CLI defaults are inserted only when no config file supplied that value.

In particular, a config file's `output_dir`, `write_files`, and `cache.cache_dir`
remain authoritative unless `--out`, `--no-write`, or `--cache-dir` is explicitly
passed.

Main config groups:

- selection: `task`, `tier`, `mode`, `profile`, `provider`, `model`;
- routing: `model_a`, `model_b`, `model_merge`, `panel_models`, `panel_roles`;
- behavior: `attach_panel_judge`, `enable_meta_judge`,
  `early_stop_on_overlap`, `overlap_skip_skeptic_threshold`, `anti_dilution`;
- extensibility: `role_pack_file`, `prompts`;
- generation: phase token limits, `temperature`, `top_p`, `extra_body`;
- execution: `branch_count`, `parallel_branches`, `max_parallel_branches`;
- policy/cache/persistence;
- web research settings;
- arbitrary `extra` report metadata.

### Prompt packs

```bash
handoffkit-cli fusion \
  --prompt-config packages/cpp/examples/fusion/configs/prompt_pack_example.json \
  --tier pro --prompt "Your task"
```

A prompt pack can supply complete templates or additive preambles and
requirements for branch, skeptic, dual merge, and multi-merge phases. Supported
built-in placeholders include:

`{task}`, `{branch_label}`, `{focus}`, `{proposal}`, `{angle}`,
`{branch_a_label}`, `{branch_a}`, `{branch_b_label}`, `{branch_b}`,
`{branches}`, `{handoffs}`, `{handoff_a}`, `{handoff_b}`,
`{quality_contract}`, `{skills}`, `{tool_slots}`, `{prior_handoff}`,
`{web_research}`, `{panel_analysis}`, phase requirement blocks, and
`{depth_guidance}`. User-defined `variables` are added to the same namespace.

A full custom template replaces the corresponding built-in frame, so it must
include every context block it needs. Additive preambles/requirements preserve
the built-in safety and quality structure.

### Role packs

```bash
handoffkit-cli fusion roles --profile research
handoffkit-cli fusion roles --pack incident
handoffkit-cli fusion roles \
  --file packages/cpp/examples/fusion/role_packs/custom_review.json
```

Built-in product profiles are `shipping`, `neutral`, `dialectic`, `diagnostic`,
`coding`, and `research`. `incident` and `product` are helper packs. JSON role
packs require at least two architect branches and a valid merger. Skeptic roles
are required only when an execution graph uses them.

## Providers, models, and reasoning controls

```bash
handoffkit-cli fusion \
  --provider opencode-go \
  --model deepseek-v4-flash \
  --tier genius --profile research \
  --thinking disabled \
  --parallel-branches --max-parallel 4 \
  --prompt "Your task"
```

`model_a`, `model_b`, and `model_merge` can route dual phases independently.
Panel entries may be `provider:model`, allowing mixed-provider panels. Native
OpenAI-compatible requests forward phase `max_tokens`, `temperature`, `top_p`,
and `generation.extra_body`.

Thinking/reasoning controls are provider-specific and are passed through, for
example:

```json
{
  "generation": {
    "extra_body": {
      "thinking": {"type": "disabled"},
      "reasoning_effort": "high"
    }
  }
}
```

The HTTP parser treats a response with non-empty `reasoning_content` but empty
final `content` as an error. This prevents a thinking model that exhausted its
budget from being reported as a successful empty answer.

## Cache

Fusion cache combines:

- memory LRU with entry/byte limits;
- optional disk shards;
- TTL expiration;
- checksums and corrupt-entry rejection;
- index rebuild, pruning, and compaction;
- hit/miss/put/eviction/read/write/corruption metrics.

The cache key includes provider, model, agent/role, task, full prompt, profile,
mode, max tokens, temperature, top-p, and `extra_body`. Changing thinking or
reasoning settings therefore cannot reuse an incompatible response.

## Web research

`--web` enables native explorer preparation before LLM phases. Fusion can derive
a query from the task, run bounded search/fetch/explore operations, convert HTML
to Markdown, and inject the result into branch/merge prompts. Controls include
transport, seed URLs, auto-search, query, page/depth limits, context characters,
timeout, and explore preference. Map/fixture transports keep tests offline.

Tool slots listed by a capability pack are reasoning scaffolds unless live tools
were actually executed; prompts explicitly distinguish those states.

## Structured handoffs

Architect, skeptic, and merge-ready state is represented with `HandoffState`:

- task/from/to/summary;
- decisions naming branch, step, capability pack, depth, and skills;
- next steps appropriate to architect/skeptic/merge-ready state;
- context refs for branches, skills, tools, and steps;
- metadata for pack/depth/step/label.

Summaries are truncated according to tier, from 700 characters in Lite to 2000
in Genius. The protocol layer re-emits draft state through `HybridState` before
successor prompts consume it.

## Judge, anti-dilution, and early stop

The deterministic judge is an analysis aid, not a factual oracle. It computes
consensus, contradictions, gaps, unique insights, blind spots, overlap, and
rubric fields. Its pre-merge section is injected into Medium+ graphs by default.

Anti-dilution checks whether the merge lost a concrete leading answer from a
branch and can prefix the strongest lead. Pro can skip both skeptic calls when
architect overlap meets the configured threshold; actual calls can therefore be
lower than the planned five.

## Persistence and resume

A written run can include:

- manifest;
- effective config;
- metrics and call records;
- JSON, Markdown, and HTML report;
- branch artifacts;
- handoff artifacts.

Checkpoint support serializes call step ids, roles, prompt hashes, outputs,
cache origin, and latency. `resume_merge_only` reuses completed dual architect
outputs and performs one merge call using the configured merge generation
settings. The current resume discovery logic is dual-branch oriented; generic
N-branch DAG resume is not yet complete.

## Observability

Each call record contains step id, role id, agent name, effective model, cache
hit, latency, input/output characters, prompt hash, and error. Reports also carry
actual/planned calls, handoff count, cache statistics, capability pack, panel
analysis, branch overlap and skeptic skip state, web metrics, parallel request
and usage state, and artifact paths.

## CLI reference

```text
fusion
  --config FILE --prompt-config FILE --role-file FILE
  --tier lite|medium|pro|ultra|genius
  --mode lean|ultra|dag|panel
  --profile shipping|neutral|dialectic|diagnostic|coding|research
  --provider P --model M --model-a A --model-b B --model-merge M
  --models provider:model,...
  --branches N --parallel-branches --no-parallel-branches --max-parallel N
  --max-calls N --overlap-threshold X
  --branch-tokens N --skeptic-tokens N --merge-tokens N --meta-tokens N
  --temperature X --top-p X
  --thinking enabled|disabled --reasoning-effort high|max
  --no-panel-judge --meta-judge --no-meta-judge
  --no-early-stop --no-anti-dilution
  --web --web-transport http|map|fixture --seed-url URL --web-query Q
  --web-max-pages N --no-web-search
  --cache-dir DIR --no-cache --out DIR --no-write

fusion tiers | profiles | modes
fusion roles [--profile P | --pack incident|product | --file FILE]
fusion explain [--tier T] [--mode M] [--profile P]
fusion cache stats|clear [--cache-dir DIR]
fusion bench [--provider P] [--case ID]
fusion scenarios [run-all]
fusion war-room [--tiers CSV] [--provider P] [--json]
fusion audit-loc [--root packages/cpp]
```

## Build and tests

Fusion is compiled when demos are enabled:

```bash
cmake -S packages/cpp -B packages/cpp/build \
  -DHANDOFFKIT_BUILD_DEMOS=ON \
  -DHANDOFFKIT_BUILD_CLI=ON \
  -DHANDOFFKIT_WITH_HTTP=OFF
cmake --build packages/cpp/build --config Release
ctest --test-dir packages/cpp/build -C Release --output-on-failure
```

Enable `HANDOFFKIT_WITH_HTTP=ON` for live OpenAI-compatible providers. The
important dedicated test executables are listed in the file audit below.

## Local engineering validation

A controlled local OpenCode Go / DeepSeek V4 Flash run used the same constrained
architecture task for every tier, with thinking disabled and cache disabled:

| Tier | Calls | Wall time | Structural items |
|---|---:|---:|---:|
| Lite | 3 | 33.95 s | 17/18 |
| Medium | 3 | 41.96 s | 18/18 |
| Pro | 5 | 86.86 s | 18/18 |
| Ultra, parallel | 5 | 44.73 s | 18/18 |
| Genius, parallel | 8 | 85.76 s | 18/18 |

Ultra measured 76.68 s sequentially and 44.73 s with parallel branches in that
run. These numbers are local engineering observations against a deterministic
18-item structural checklist. They are not an official benchmark, an
independent judge, or proof that a higher tier is universally better.

## Known limitations found in this audit

- The full advanced engine exists only in C++; Python and JavaScript expose
  smaller panel demos.
- `FusionCache` is not a concurrent-writer cache, so parallel DAG disables it.
- `max_wall_ms` is not yet a strict end-to-end run deadline because the budget
  object is reconstructed around individual calls.
- Base config validation has explicit minimum-call checks for lean/ultra; unusual
  DAG/panel overrides may fail later at the runtime call gate instead of at parse
  time.
- Generic N-branch checkpoint resume is incomplete; merge-only resume currently
  expects dual architect step ids.
- Deterministic rubrics, gates, overlap, and panel analysis measure structure and
  consistency, not factual truth.
- Live web search quality and availability depend on transport/endpoints and
  should be treated as external evidence input, not guaranteed ground truth.

## Complete file-by-file audit

The following inventory contains every file selected by the current Fusion audit:
all native headers/sources/tests/examples, its CMake/CLI/provider support, and the
Python/JavaScript Fusion implementations. Generated build artifacts and local run
outputs are intentionally excluded.

### Native public/internal headers (37)

| File | Responsibility | Audit finding / status |
|---|---|---|
| `packages/cpp/include/handoffkit/demos/fusion/algo_align.hpp` | Sequence-alignment API for token and branch similarity. | Declares Needleman-Wunsch, Smith-Waterman, and normalized branch similarity. |
| `packages/cpp/include/handoffkit/demos/fusion/algo_dag.hpp` | DAG data model and topology analysis API. | Declares graph builders, cycle/topological analysis, critical path, and expected call count. |
| `packages/cpp/include/handoffkit/demos/fusion/algo_handoff_sim.hpp` | Offline handoff simulation contracts. | Builds synthetic linear/Fusion HandoffState traces and metrics without providers. |
| `packages/cpp/include/handoffkit/demos/fusion/algo_quality_gates.hpp` | Deterministic run-quality gate API. | Declares structural, cache, branch, rubric, timing, and call-count checks. |
| `packages/cpp/include/handoffkit/demos/fusion/algo_rate_limit.hpp` | Rate/budget primitives. | Declares token bucket, sliding window limiter, and Fusion call admission decisions. |
| `packages/cpp/include/handoffkit/demos/fusion/algo_report.hpp` | Rich report composition API. | Combines run, branch diff, rubric, Markdown, HTML, and wire JSON. |
| `packages/cpp/include/handoffkit/demos/fusion/algo_rubric.hpp` | Offline rubric types and scoring API. | Provides diagnostic, shipping, and task-faithful rubric definitions. |
| `packages/cpp/include/handoffkit/demos/fusion/algo_stats.hpp` | Small numeric/statistics library. | Mean, percentiles, correlations, errors, normalization, histograms, and entropy. |
| `packages/cpp/include/handoffkit/demos/fusion/audit_loc.hpp` | Fusion source-volume audit contracts. | Defines per-file LOC stats and anti-padding audit output. |
| `packages/cpp/include/handoffkit/demos/fusion/bench.hpp` | Benchmark case and batch contracts. | Defines case execution, batch aggregation, Markdown, and JSON reports. |
| `packages/cpp/include/handoffkit/demos/fusion/bench_corpus_eval.hpp` | Offline corpus-evaluation entry point. | Exposes deterministic MedCase corpus evaluation. |
| `packages/cpp/include/handoffkit/demos/fusion/branch_compare.hpp` | Branch-difference contracts. | Captures shared bullets, unique claims, conflicts, overlap, and preferred branch. |
| `packages/cpp/include/handoffkit/demos/fusion/cache.hpp` | Memory/disk cache public API. | LRU, TTL, checksums, statistics, invalidation, compaction; not concurrent-writer safe. |
| `packages/cpp/include/handoffkit/demos/fusion/cache_index.hpp` | Persistent cache-index API. | Loads, saves, rebuilds, prunes, and compacts disk shard metadata. |
| `packages/cpp/include/handoffkit/demos/fusion/cases_medcase.hpp` | MedCase benchmark loader API. | Loads JSON cases and exposes built-in corpus lookup helpers. |
| `packages/cpp/include/handoffkit/demos/fusion/cases_validate.hpp` | Benchmark corpus validation API. | Checks ids, prompts, labels, disclaimers, leakage heuristics, and text bounds. |
| `packages/cpp/include/handoffkit/demos/fusion/engine.hpp` | Public native FusionEngine API. | Dispatches lean, ultra, DAG, and panel execution with optional cache/provider injection. |
| `packages/cpp/include/handoffkit/demos/fusion/engine_internal.hpp` | Shared engine implementation helpers. | Builds frame options, resolves custom roles/models/web context, and emits protocol handoffs. |
| `packages/cpp/include/handoffkit/demos/fusion/engine_resume.hpp` | Checkpoint and resume API. | Supports step serialization and merge-only resume; current resume path is dual-branch oriented. |
| `packages/cpp/include/handoffkit/demos/fusion/fusion_docs.hpp` | In-binary documentation API. | Exposes generated overview, quickstart, and improvements notes used by tests/tools. |
| `packages/cpp/include/handoffkit/demos/fusion/fusion_style.hpp` | Demo-catalog adapters. | Bridges FusionRunResult into generic DemoResult and exposes router/cache/offline demos. |
| `packages/cpp/include/handoffkit/demos/fusion/hash.hpp` | Hashing API. | FNV/content hashes, SHA-256 when available, and cache-key composition. |
| `packages/cpp/include/handoffkit/demos/fusion/merge_strategy.hpp` | Merge strategy API. | Task-faithful, shipping sections, bullet-vote, and conflict-annotated strategies. |
| `packages/cpp/include/handoffkit/demos/fusion/metrics.hpp` | Text and batch metric contracts. | Token/label scoring and aggregation for benchmark runs. |
| `packages/cpp/include/handoffkit/demos/fusion/panel.hpp` | Panel/judge public API. | Model slots, deterministic analysis, overlap, direct-answer extraction, and anti-dilution. |
| `packages/cpp/include/handoffkit/demos/fusion/persist.hpp` | Run persistence API. | Defines artifact layout, write/load operations, and HTML rendering. |
| `packages/cpp/include/handoffkit/demos/fusion/policy.hpp` | Execution policy and budget API. | Call count, prompt size, wall limit, cache allowances, and config validation. |
| `packages/cpp/include/handoffkit/demos/fusion/prompt.hpp` | Prompt construction public API. | Sanitization, templating, structured handoffs, and tier-aware branch/skeptic/merge frames. |
| `packages/cpp/include/handoffkit/demos/fusion/prompt_sanitize_tables.hpp` | Punctuation-map helper API. | Declares named Windows punctuation mappings used by prompt sanitation. |
| `packages/cpp/include/handoffkit/demos/fusion/provider_wrap.hpp` | Fusion provider/cache wrapper API. | Wraps AnyProvider with content-addressed response caching. |
| `packages/cpp/include/handoffkit/demos/fusion/roles.hpp` | Role-pack public API. | Built-in profiles, JSON loading/validation, text dump, and execution-plan explanation. |
| `packages/cpp/include/handoffkit/demos/fusion/scenarios.hpp` | Base scenario-test API. | Catalogs deterministic end-to-end Fusion behavior checks. |
| `packages/cpp/include/handoffkit/demos/fusion/scenarios_deep.hpp` | Deep scenario-test API. | Adds cache-index, resume, merge, text, policy, and benchmark scenarios. |
| `packages/cpp/include/handoffkit/demos/fusion/text_pipeline.hpp` | Text-analysis pipeline API. | Sentence/paragraph/token/style stats and task/domain heuristics. |
| `packages/cpp/include/handoffkit/demos/fusion/types.hpp` | Canonical Fusion wire/config/result types. | Defines tiers, modes, capability packs, prompts, generation, policy, cache, metrics, and results. |
| `packages/cpp/include/handoffkit/demos/fusion/war_room.hpp` | Multi-tier comparison API. | Runs selected tiers against one task and reports latency, calls, judge data, and previews. |
| `packages/cpp/include/handoffkit/demos/fusion/web_research.hpp` | Fusion web-research API. | Search/fetch/explore registry and bounded Markdown context result. |

### Native implementations (43)

| File | Responsibility | Audit finding / status |
|---|---|---|
| `packages/cpp/src/demos/fusion/algo_align.cpp` | Implements global/local dynamic-programming alignment and branch similarity. | Used by quality analysis; deterministic and offline. |
| `packages/cpp/src/demos/fusion/algo_dag.cpp` | Implements DAG topology, cycle detection, critical path, and standard graph builders. | Dead critical-path temporary removed; Debug tests now assert lean/ultra/multi critical costs. |
| `packages/cpp/src/demos/fusion/algo_handoff_sim.cpp` | Implements synthetic protocol handoff traces and summary metrics. | Useful for offline validation, not the live engine path. |
| `packages/cpp/src/demos/fusion/algo_quality_gates.cpp` | Implements the deterministic run-quality checks. | Validates shape and heuristics; it is not an independent LLM judge. |
| `packages/cpp/src/demos/fusion/algo_rate_limit.cpp` | Implements token bucket, sliding-window, and call-gate admission. | Separate utility; main engine policy uses FusionBudget. |
| `packages/cpp/src/demos/fusion/algo_report.cpp` | Builds rich Markdown/HTML/JSON analysis reports. | Combines branch comparison, rubric, and text-pipeline details. |
| `packages/cpp/src/demos/fusion/algo_rubric.cpp` | Implements keyword/structure-based offline rubric scoring. | Contains heuristic scoring and one remaining TODO; not a public benchmark authority. |
| `packages/cpp/src/demos/fusion/algo_stats.cpp` | Implements numeric/statistical helpers. | Reformatted during the audit to remove misleading-indentation warnings without changing formulas. |
| `packages/cpp/src/demos/fusion/audit_loc.cpp` | Walks Fusion code/tests and flags suspicious padding patterns. | Excludes build dependencies and reports productive/source LOC. |
| `packages/cpp/src/demos/fusion/bench_case.cpp` | Runs individual and batch Fusion benchmark cases. | Uses FusionEngine and aggregates deterministic text metrics. |
| `packages/cpp/src/demos/fusion/bench_corpus_eval.cpp` | Evaluates the MedCase corpus offline. | Combines validation, label metrics, rubric, text analysis, and statistics. |
| `packages/cpp/src/demos/fusion/branch_compare.cpp` | Extracts bullets and computes LCS/overlap, unique claims, and conflicts. | Feeds merge analysis and branch preference heuristics. |
| `packages/cpp/src/demos/fusion/cache_disk.cpp` | Implements disk shard read/write/remove and checksum verification. | Corrupt entries are rejected rather than returned. |
| `packages/cpp/src/demos/fusion/cache_index.cpp` | Implements persistent cache index lifecycle. | Supports rebuild from shards, pruning, and compaction. |
| `packages/cpp/src/demos/fusion/cache_memory.cpp` | Implements LRU memory cache, TTL, eviction, serialization, and stats. | The class intentionally assumes non-concurrent writers. |
| `packages/cpp/src/demos/fusion/cache_stats.cpp` | Formats cache health/statistics and computes deltas. | Used by CLI reports and cache lab. |
| `packages/cpp/src/demos/fusion/cases_medcase_loader.cpp` | Loads built-in or external MedCaseReasoning cases. | Adds the research-only vignette/output wrapper required by validation, then exposes fallback and lookup helpers. |
| `packages/cpp/src/demos/fusion/cases_validate.cpp` | Implements corpus integrity and leakage-oriented heuristics. | Validation is structural/research-oriented, not clinical validation. |
| `packages/cpp/src/demos/fusion/engine_dag_run.cpp` | Executes N architect branches, merge, and optional meta-judge. | Bounded parallelism is active only with cache disabled; Genius final output is replaced by meta-judge. |
| `packages/cpp/src/demos/fusion/engine_lean_ultra.cpp` | Executes dual architects, optional skeptics, merge, and optional meta-judge. | Includes overlap early-stop, structured handoffs, pre-merge analysis, and anti-dilution. |
| `packages/cpp/src/demos/fusion/engine_panel_run.cpp` | Executes multi-model panel slots and deterministic judge. | Echo mode substitutes deterministic role answers; panel mode does not build the same handoff chain as branch modes. |
| `packages/cpp/src/demos/fusion/engine_resume.cpp` | Serializes checkpoints and performs a merge-only resumed call. | Now forwards merge token/sampling/extra_body settings; current discovery expects dual branch step ids. |
| `packages/cpp/src/demos/fusion/engine_run.cpp` | Central call wrapper, validation, dispatch, observability, and persistence. | Records errors, latency, chars, hash, cache hit, and generation options per phase. |
| `packages/cpp/src/demos/fusion/fusion_docs.cpp` | Stores generated Fusion overview/quickstart text in the binary. | Updated with current 3/3/5/5/8 tiers and advanced features. |
| `packages/cpp/src/demos/fusion/fusion_style_offline.cpp` | Legacy deterministic two-team Fusion-style demo. | Kept as a simpler catalog demonstration, separate from the advanced engine. |
| `packages/cpp/src/demos/fusion/fusion_style_router.cpp` | Maps DemoOptions/CLI/config JSON into FusionConfig and reports. | Explicit CLI values now override config while unspecified output/cache settings remain file-authoritative. |
| `packages/cpp/src/demos/fusion/hash.cpp` | Implements content/SHA/cache-key hashing. | Cache-key inputs distinguish provider/model/role/prompts and generation controls. |
| `packages/cpp/src/demos/fusion/merge_strategy.cpp` | Implements merge-plan selection, prompts, and offline bullet voting. | Resume uses this strategy layer; live main engine uses tier-aware prompt frames. |
| `packages/cpp/src/demos/fusion/metrics.cpp` | Implements tokenizer, label normalization, text-vs-gold, and batch metrics. | Metrics are proxy/structural and must not be presented as clinical capability. |
| `packages/cpp/src/demos/fusion/panel.cpp` | Implements roles, model-spec parsing, deterministic judge, overlap, and anti-dilution. | Judge is heuristic; optional meta-judge is the LLM refinement layer. |
| `packages/cpp/src/demos/fusion/persist.cpp` | Writes/loads manifests, config, metrics, reports, branches, and handoffs. | Persistence is per-run and produces JSON, Markdown, and HTML artifacts. |
| `packages/cpp/src/demos/fusion/policy.cpp` | Implements FusionBudget and base config validation. | Call count/prompt size are enforced; max_wall_ms is not yet a strict whole-run deadline. |
| `packages/cpp/src/demos/fusion/prompt_builder.cpp` | Builds tier-aware branch, skeptic, dual-merge, and multi-merge prompts. | Injects custom templates, requirements, quality/output contracts, web, panel analysis, and handoffs. |
| `packages/cpp/src/demos/fusion/prompt_sanitize.cpp` | Implements BOM/punctuation sanitation, truncation, and {{variable}} rendering. | Unknown template keys can be retained or removed according to caller choice. |
| `packages/cpp/src/demos/fusion/prompt_sanitize_tables.cpp` | Implements named Windows punctuation mapping tables. | Complements the main sanitizer for deterministic ASCII-safe prompts. |
| `packages/cpp/src/demos/fusion/provider_wrap.cpp` | Implements cached AnyProvider wrapping and model override construction. | Cache key now includes extra_body so thinking/reasoning settings cannot alias. |
| `packages/cpp/src/demos/fusion/roles.cpp` | Implements six profiles, incident/product helpers, JSON packs, and plan explanation. | DAG synthesizes additional branch variants when a pack has fewer roles than requested. |
| `packages/cpp/src/demos/fusion/scenarios_catalog.cpp` | Implements base deterministic scenario catalog. | Full-call Ultra scenarios explicitly disable overlap early-stop; other scenarios cover cache, policy, sanitation, profiles, templates, and toy bench. |
| `packages/cpp/src/demos/fusion/scenarios_deep.cpp` | Implements deeper integration scenarios. | Full-call Ultra checks disable early-stop; the catalog also covers merge, conflicts, cache index, resume, text, policy, and MedCase echo. |
| `packages/cpp/src/demos/fusion/text_pipeline.cpp` | Implements text segmentation, normalization, label and shipping-plan heuristics. | Supports reports/gates; does not semantically verify factual correctness. |
| `packages/cpp/src/demos/fusion/types.cpp` | Implements serialization, tier contracts/defaults, config parsing, and result rendering. | Canonical source of current tier behavior and 3/3/5/5/8 call plans. |
| `packages/cpp/src/demos/fusion/war_room.cpp` | Runs the same task across multiple tiers and formats comparison output. | Useful for engineering comparisons; defaults exclude Genius for speed. |
| `packages/cpp/src/demos/fusion/web_research.cpp` | Implements query derivation, Wikipedia/DDG search, fetch/explore, and Markdown assembly. | Network is opt-in and bounded by page/depth/context/timeout controls. |

### Tests (11)

| File | Responsibility | Audit finding / status |
|---|---|---|
| `packages/cpp/tests/test_fusion_algo.cpp` | Algorithms, DAG, rate limits, rubrics, reports, corpus, generated docs, and quality gates. | Primary broad offline algorithm regression suite. |
| `packages/cpp/tests/test_fusion_cache.cpp` | Hash, sanitation, memory/disk round-trip, LRU eviction, and provider cache-key isolation. | Verifies that changing `extra_body`/thinking settings cannot reuse an incompatible cached completion. |
| `packages/cpp/tests/test_fusion_depth.cpp` | Branch comparison, merge strategies, cache index, resume, text pipeline, and deep scenarios. | Covers advanced support modules; the audit added the direct metrics include required by Debug builds. |
| `packages/cpp/tests/test_fusion_engine_echo.cpp` | Profiles, tiers, capability differentiation, handoffs, prompt templates, parallel reports, and persistence. | Verifies current 3/3/5/5/8 tier architecture; full-call assertions explicitly disable overlap early-stop. |
| `packages/cpp/tests/test_fusion_loc_audit.cpp` | Repository discovery and anti-padding LOC audit. | Ensures the audit can locate packages/cpp and produce a valid report. |
| `packages/cpp/tests/test_fusion_panel.cpp` | Panel roles/specs/judge, routing, meta-judge, anti-dilution, overlap, and war-room fields. | Covers deterministic panel behavior and model routing. |
| `packages/cpp/tests/test_fusion_roles.cpp` | Built-in and JSON role packs plus validation. | Protects role schema and all shipped profiles. |
| `packages/cpp/tests/test_fusion_scenarios.cpp` | Base scenario catalog execution. | Small wrapper asserting all catalog scenarios pass. |
| `packages/cpp/tests/test_fusion_war_room.cpp` | Multi-tier war-room report. | Checks tier rows, calls, cache/provider fields, and Markdown. |
| `packages/cpp/tests/test_fusion_web_research.cpp` | URL extraction, query generation, fixture research, prompt injection, and tool registry. | No live network is required. |
| `packages/cpp/tests/test_http_parse.cpp` | OpenAI-compatible parse/request support used by Fusion. | Rejects reasoning-only empty completions and checks generation request fields. |

### Configuration and role-pack examples (3)

| File | Responsibility | Audit finding / status |
|---|---|---|
| `packages/cpp/examples/fusion/configs/fusion_research_genius.json` | Complete Genius/research/OpenCode Go configuration. | Shows 8-call policy, prompt requirements, token budgets, cache-off parallel DAG. |
| `packages/cpp/examples/fusion/configs/prompt_pack_example.json` | Reusable prompt-pack fragment. | Demonstrates phase preambles, custom requirements, variables, and tier-contract inclusion. |
| `packages/cpp/examples/fusion/role_packs/custom_review.json` | Custom correctness-vs-operability role pack. | Executable example for external architect/skeptic/merger definitions. |

### Build, CLI, provider, and package support (5)

| File | Responsibility | Audit finding / status |
|---|---|---|
| `packages/cpp/CMakeLists.txt` | Build graph for Fusion sources/tests/targets. | Fusion belongs to optional demos; live HTTP is controlled by HANDOFFKIT_WITH_HTTP. |
| `packages/cpp/src/cli/cli_app.cpp` | Complete Fusion CLI surface and precedence layer. | Routes all Fusion commands; the audit fixed an `extra` reset that erased explicit `--out` and `--no-write` markers. |
| `packages/cpp/include/handoffkit/runtime/provider.hpp` | Shared GenerateOptions/AnyProvider contract. | Fusion depends on max_tokens, sampling, extra_body, usage, and type-erased provider calls. |
| `packages/cpp/src/runtime/http_provider.cpp` | OpenAI-compatible request/response implementation. | Merges extra_body and rejects reasoning_content without final content. |
| `packages/cpp/README.md` | C++ package overview and concise Fusion entry point. | Links to the centralized Fusion guide, changelog, and example documentation. |

### Fusion documentation (4)

| File | Responsibility | Audit finding / status |
|---|---|---|
| `docs/cpp/fusion/README.md` | Canonical Fusion architecture and complete audit. | Source of truth for current behavior, configuration, limitations, tests, and inventory. |
| `docs/cpp/fusion/CHANGELOG.md` | Fusion-specific engineering history. | Keeps detailed subsystem changes out of the concise monorepo changelog. |
| `docs/cpp/fusion/CONFIGURATION.md` | Configuration and prompt-pack guide. | Documents shipped JSON examples, CLI overrides, generation fields, and placeholders. |
| `docs/cpp/fusion/ROLE_PACKS.md` | External role-pack guide. | Documents schema, validation expectations, and the shipped custom role example. |

### Cross-runtime Fusion files (4)

| File | Responsibility | Audit finding / status |
|---|---|---|
| `packages/python/handoffkit/recipes/fusion.py` | Python deterministic/real-provider panel recipe. | Smaller panel+judge implementation; no native C++ tier/DAG/cache/prompt parity. |
| `packages/python/examples/demos/fusion_style_demo.py` | Python CLI/example wrapper. | Runs the Python recipe and writes JSON/Markdown reports. |
| `packages/python/tests/test_fusion_style_demo.py` | Python offline Fusion smoke test. | Validates the smaller deterministic recipe. |
| `packages/js/cli/src/benchmarks/fusion_demo.js` | JavaScript offline Echo panel and judge demo. | Deterministic demonstration only; real providers and advanced native engine are not wired. |

**Audited total: 107 files.**

## Maintenance rule

When Fusion behavior changes, update the relevant files in the same change:

1. `docs/cpp/fusion/README.md` for architecture, flags, limitations, tests, and inventory.
2. `docs/cpp/fusion/CHANGELOG.md` for detailed Fusion history.
3. `docs/cpp/fusion/CONFIGURATION.md` or `ROLE_PACKS.md` when those schemas change.
4. `packages/cpp/README.md` only for the concise package entry point.
5. `packages/cpp/src/demos/fusion/fusion_docs.cpp` for in-binary docs.
6. Root `CHANGELOG.md` only when the change has monorepo or release-level impact.
7. Tests that encode tier call counts, request shapes, configuration, or report fields.
