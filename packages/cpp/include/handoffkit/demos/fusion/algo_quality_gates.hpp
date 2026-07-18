#pragma once
#include <handoffkit/demos/fusion/types.hpp>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>
namespace handoffkit { namespace demos { namespace fusion {
struct QualityGateResult {
  bool passed = false;
  std::string name;
  std::string message;
  double score = 0;
  nlohmann::json details = nlohmann::json::object();
  nlohmann::json to_json() const;
};
QualityGateResult gate_min_output_length(const FusionRunResult& run);
QualityGateResult gate_has_structure(const FusionRunResult& run);
QualityGateResult gate_not_empty_branches(const FusionRunResult& run);
QualityGateResult gate_llm_calls_positive(const FusionRunResult& run);
QualityGateResult gate_cache_stats_sane(const FusionRunResult& run);
QualityGateResult gate_no_error_on_success(const FusionRunResult& run);
QualityGateResult gate_task_nonempty(const FusionRunResult& run);
QualityGateResult gate_diagnostic_no_shipping(const FusionRunResult& run);
QualityGateResult gate_shipping_has_build_terms(const FusionRunResult& run);
QualityGateResult gate_branch_divergence(const FusionRunResult& run);
QualityGateResult gate_alignment_similarity_band(const FusionRunResult& run);
QualityGateResult gate_rubric_normalized_band(const FusionRunResult& run);
QualityGateResult gate_text_pipeline_tokens(const FusionRunResult& run);
QualityGateResult gate_call_records_match(const FusionRunResult& run);
QualityGateResult gate_wall_ms_nonneg(const FusionRunResult& run);
QualityGateResult gate_handoff_count_band(const FusionRunResult& run);
QualityGateResult gate_merge_nonempty(const FusionRunResult& run);
QualityGateResult gate_profile_mode_strings(const FusionRunResult& run);
QualityGateResult gate_prefer_specificity_defined(const FusionRunResult& run);
QualityGateResult gate_ultra_call_count(const FusionRunResult& run);
std::vector<QualityGateResult> run_all_quality_gates(const FusionRunResult& run);
bool all_quality_gates_passed(const FusionRunResult& run);
nlohmann::json quality_gates_report(const FusionRunResult& run);
}}}
