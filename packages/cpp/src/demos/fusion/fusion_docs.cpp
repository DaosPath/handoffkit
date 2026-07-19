#include <handoffkit/demos/fusion/fusion_docs.hpp>
#include <sstream>
namespace handoffkit { namespace demos { namespace fusion {
std::string fusion_suite_readme_markdown() {
  std::ostringstream ss;
  ss << "## Overview\n\n";
  ss << "HandoffKit C++ fusion-style demo suite provides dual-branch multi-agent ";
  ss << "orchestration with lean/ultra/dag modes, profiles, cache, bench corpus, ";
  ss << "and offline quality tools.\n\n";
  ss << "## Profiles\n\n";
  ss << "shipping (legacy C++ packaging), neutral (task-faithful), dialectic, ";
  ss << "diagnostic, coding, research.\n\n";
  ss << "## Modes\n\n";
  ss << "lean=3 LLM calls (A,B,merge), ultra=5 (A,B,skA,skB,merge), dag=N ";
  ss << "architects + merge.\n\n";
  ss << "## Cache\n\n";
  ss << "Memory LRU + disk content-addressed entries with checksums, index ";
  ss << "rebuild/compact, hit_rate stats.\n\n";
  ss << "## Bench\n\n";
  ss << "Embedded MedCaseReasoning fixtures (research only) with gold labels for ";
  ss << "offline scoring heuristics.\n\n";
  ss << "## Quality\n\n";
  ss << "Rubrics (diagnostic/shipping/task-faithful), quality gates, branch ";
  ss << "alignment (NW/SW), DAG analysis.\n\n";
  ss << "## CLI\n\n";
  ss << "fusion --profile --mode --provider; fusion roles; fusion explain; ";
  ss << "fusion cache; fusion bench; fusion scenarios run-all; fusion audit-loc.\n\n";
  ss << "## Roles\n\n";
  ss << "Built-in packs: shipping, neutral, dialectic, diagnostic, coding, research, ";
  ss << "plus incident/product helpers. Load custom packs via load_role_pack_file JSON. ";
  ss << "CLI: fusion roles --profile neutral | --pack incident | ";
  ss << "--file packages/cpp/examples/fusion/role_packs/custom_review.json\n\n";
  ss << "## Explain\n\n";
  ss << "fusion explain --tier medium prints planned_llm_calls and call_plan offline.\n\n";
  ss << "## Engine layout\n\n";
  ss << "engine_run (dispatch/call_llm), engine_lean_ultra, engine_dag_run, ";
  ss << "engine_panel_run, engine_internal helpers.\n\n";
  ss << "## Observability\n\n";
  ss << "FusionRunResult.report includes call_steps (step_id/role_id/agent_name) and ";
  ss << "cache_stats when cache is enabled.\n\n";
  ss << "## Safety\n\n";
  ss << "Medical fixtures are research/benchmark only and not clinical advice.\n\n";
  ss << "## Non-goals\n\n";
  ss << "Does not replace core runtime APIs; demo-layer only under demos/fusion.\n\n";
  ss << "## Wire\n\n";
  ss << "Reports and configs use snake_case JSON keys for cross-runtime ";
  ss << "familiarity.\n\n";
  ss << "## FAQ\n\n";
  ss << "### Why echo provider in tests?\n\n";
  ss << "Deterministic offline runs without network or API keys.\n\n";
  ss << "### Why task-faithful merge?\n\n";
  ss << "Prevents ultra fusion from ignoring the user task and inventing product ";
  ss << "plans.\n\n";
  ss << "### Why embed MedCase fixtures?\n\n";
  ss << "Real open-access vignettes power offline bench and validation without ";
  ss << "live LLM.\n\n";
  ss << "### How is LOC counted?\n\n";
  ss << "audit_fusion_suite_loc walks demos/fusion headers/sources and ";
  ss << "test_fusion_*.cpp, excluding build/_deps.\n\n";
  ss << "### Is 30k a pad target?\n\n";
  ss << "No: volume must be reachable APIs, fixtures, algorithms, and tests that ";
  ss << "exercise shipped code.\n\n";
  ss << "### Can I use live NIM?\n\n";
  ss << "Yes via --provider nvidia when HANDOFFKIT_WITH_HTTP=ON and ";
  ss << "NVIDIA_API_KEY is set.\n\n";
  ss << "### What is resume_merge_only?\n\n";
  ss << "Reuses checkpointed branch outputs and performs a single merge call.\n\n";
  ss << "### What is offline_bullet_vote_merge?\n\n";
  ss << "A no-LLM merger that votes bullet lines across branches and lists ";
  ss << "conflicts.\n\n";
  ss << "## Module inventory\n\n";
  ss << "1. types/config/metrics wire types\n";
  ss << "2. hash/prompt sanitize builders\n";
  ss << "3. cache memory disk index stats\n";
  ss << "4. roles and six profiles\n";
  ss << "5. engine lean ultra dag\n";
  ss << "6. provider caching wrap\n";
  ss << "7. policy budget validation\n";
  ss << "8. persist reports\n";
  ss << "9. branch compare LCS bullets\n";
  ss << "10. merge strategies\n";
  ss << "11. engine resume checkpoints\n";
  ss << "12. text pipeline detectors\n";
  ss << "13. sequence alignment NW SW\n";
  ss << "14. DAG topology critical path\n";
  ss << "15. rate limit token bucket\n";
  ss << "16. rubrics and quality gates\n";
  ss << "17. stats library\n";
  ss << "18. handoff simulation\n";
  ss << "19. rich HTML/MD reports\n";
  ss << "20. medcase corpus + validators\n";
  ss << "21. scenarios catalog + deep\n";
  ss << "22. bench batch scoring\n";
  ss << "\n";
  return ss.str();
}
std::string fusion_suite_quickstart_text() {
  return R"QS(
handoffkit-cli fusion --provider echo --profile neutral --mode lean --prompt "..."
handoffkit-cli fusion roles --profile neutral
handoffkit-cli fusion roles --pack incident
handoffkit-cli fusion roles --file packages/cpp/examples/fusion/role_packs/custom_review.json
handoffkit-cli fusion explain --tier medium --mode ultra
handoffkit-cli fusion --provider echo --profile diagnostic --mode ultra --prompt "..."
handoffkit-cli fusion bench --provider echo
handoffkit-cli fusion scenarios run-all
handoffkit-cli fusion cache clear --cache-dir runs/fusion-cache
handoffkit-cli fusion audit-loc --root packages/cpp
handoffkit-cli demo fusion_cache_lab
handoffkit-cli demo fusion_neutral_ultra
)QS";
}
std::string fusion_improvements_notes() {
  return "Fusion improvements: loadable role packs (JSON), incident/product packs, "
         "CLI roles/explain, engine split (lean/dag/panel), report call_steps + cache_stats.\n";
}
}}}
