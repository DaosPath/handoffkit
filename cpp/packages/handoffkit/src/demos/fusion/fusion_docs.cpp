#include <handoffkit/demos/fusion/fusion_docs.hpp>

namespace handoffkit {
namespace demos {
namespace fusion {

std::string fusion_suite_readme_markdown() {
    return R"FUSION_DOC(
## Overview

HandoffKit C++ Fusion is the native advanced orchestration implementation. It
supports product tiers, lean/ultra/DAG/panel modes, structured handoffs,
configurable prompts and roles, deterministic analysis, optional meta-judge
refinement, web research, caching, persistence, resume, benchmarks, scenarios,
and report generation.

## Tiers

Lite=2 architects+merge (3); Medium=2 architects+analysis+merge (3);
Pro=2 architects+2 skeptics+merge (5); Ultra=4-branch DAG+merge (5);
Genius=6-branch DAG+merge+meta-judge (8). Higher tiers use cumulative quality
contracts, not only more calls.

## Profiles

shipping, neutral, dialectic, diagnostic, coding, research. Incident and product
packs are also available through helpers or JSON role packs.

## Modes

lean, ultra, dag, panel. Product tiers select defaults, while an explicit mode
can override the tier graph for advanced use.

## Configuration

`fusion --config FILE`, `--prompt-config FILE`, and `--role-file FILE` load
JSON without recompilation. Explicit CLI flags override loaded values. Prompt
packs can replace branch, skeptic, merge, and multi-merge templates.

## Parallel DAG

Independent DAG architect branches can execute concurrently with bounded
parallelism. Shared FusionCache is intentionally disabled on the parallel path
because the cache is not a concurrent-writer abstraction.

## Cache

Memory LRU plus optional content-addressed disk entries, TTL, checksums, index
rebuild/compact, and hit-rate statistics. Cache keys include prompt, provider,
model, role, mode/profile, token/sampling settings, and provider extra_body.

## Engine layout

engine_run (dispatch/call_llm), engine_lean_ultra, engine_dag_run,
engine_panel_run, engine_resume, and engine_internal helpers.

## Roles

Built-in packs plus JSON loading and validation. CLI: `fusion roles`,
`fusion explain`, and `fusion roles --file .../custom_review.json`.

## Prompt and handoff flow

Tier quality gates and output contracts are injected into prompts. Architect and
skeptic results become structured HandoffState records before successor steps.
Anti-dilution protects concrete branch leads from being erased by synthesis.

## Panel and judge

The deterministic panel judge extracts consensus, contradictions, gaps, unique
insights, blind spots, and rubric results. An optional LLM meta-judge can replace
the draft final answer.

## Web research

Opt-in native explorer tools fetch/search pages, convert HTML to Markdown, and
inject bounded research context. Offline map/fixture transports remain available
for deterministic tests.

## Observability

FusionRunResult.report includes `call_steps`, `cache_stats`, per-call errors,
latencies, prompt hashes, panel analysis, branch overlap, parallel execution
state, web metrics, handoffs, and artifact paths.

## Bench and quality

MedCaseReasoning fixtures are research-only. Offline metrics, rubrics, quality
gates, alignment, branch comparison, DAG analysis, rate limits, statistics,
scenarios, war-room comparison, and LOC auditing are included.

## CLI

`fusion`, `fusion tiers`, `fusion profiles`, `fusion modes`, `fusion roles`,
`fusion explain`, `fusion cache`, `fusion bench`, `fusion scenarios`,
`fusion war-room`, and `fusion audit-loc`.

## Safety and scope

Fusion lives in the optional demo target, not `handoffkit_core`. Diagnostic
fixtures and outputs are research/benchmark only and are not clinical advice.
Python and JavaScript currently provide smaller panel demos, not feature parity
with the native C++ engine.
)FUSION_DOC";
}

std::string fusion_suite_quickstart_text() {
    return R"FUSION_QS(handoffkit-cli fusion tiers
handoffkit-cli fusion explain --tier genius --profile research
handoffkit-cli fusion --provider echo --tier medium --profile neutral --prompt "..."
handoffkit-cli fusion --config packages/cpp/examples/fusion/configs/fusion_research_genius.json --prompt "..."
handoffkit-cli fusion --prompt-config packages/cpp/examples/fusion/configs/prompt_pack_example.json --prompt "..."
handoffkit-cli fusion roles --profile neutral
handoffkit-cli fusion roles --pack incident
handoffkit-cli fusion roles --file packages/cpp/examples/fusion/role_packs/custom_review.json
handoffkit-cli fusion scenarios run-all
handoffkit-cli fusion cache clear --cache-dir runs/fusion-cache
handoffkit-cli fusion audit-loc --root packages/cpp
)FUSION_QS";
}

std::string fusion_improvements_notes() {
    return "Fusion improvements: cumulative tier quality contracts, configurable prompts and generation, "
           "loadable role packs, bounded parallel DAG execution, Genius 8-call meta-judge, "
           "reasoning-only response rejection, structured handoffs, call_steps, cache_stats, and "
           "config precedence fixes.\n";
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
