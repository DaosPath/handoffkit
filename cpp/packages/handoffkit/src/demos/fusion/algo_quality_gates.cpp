#include <handoffkit/demos/fusion/algo_quality_gates.hpp>
#include <handoffkit/demos/fusion/text_pipeline.hpp>
#include <handoffkit/demos/fusion/branch_compare.hpp>
#include <handoffkit/demos/fusion/algo_align.hpp>
#include <handoffkit/demos/fusion/algo_rubric.hpp>
#include <cmath>
namespace handoffkit { namespace demos { namespace fusion {

nlohmann::json QualityGateResult::to_json() const {
  return nlohmann::json{{"passed",passed},{"name",name},{"message",message},{"score",score},{"details",details}};
}

QualityGateResult gate_min_output_length(const FusionRunResult& run) {
  QualityGateResult r; r.name="min_output_length"; r.score=double(run.final_output.size());
  r.passed = run.final_output.size() >= 20; r.message = r.passed?"ok":"short"; return r;
}
QualityGateResult gate_has_structure(const FusionRunResult& run) {
  QualityGateResult r; r.name="has_structure";
  bool b = run.final_output.find("- ")!=std::string::npos || run.final_output.find("1)")!=std::string::npos
        || run.final_output.find("1.")!=std::string::npos || run.final_output.size()>100;
  r.passed=b; r.score=b?1:0; r.message=b?"structured":"flat"; return r;
}
QualityGateResult gate_not_empty_branches(const FusionRunResult& run) {
  QualityGateResult r; r.name="not_empty_branches"; bool ok=!run.branches.empty();
  for (const auto& br: run.branches) if (br.combined.empty() && br.architect_output.empty()) ok=false;
  r.passed=ok; r.score=ok?1:0; r.message=ok?"ok":"empty"; return r;
}
QualityGateResult gate_llm_calls_positive(const FusionRunResult& run) {
  QualityGateResult r; r.name="llm_calls_positive"; r.score=run.metrics.llm_calls;
  r.passed=run.metrics.llm_calls>0; r.message=r.passed?"ok":"zero"; return r;
}
QualityGateResult gate_cache_stats_sane(const FusionRunResult& run) {
  QualityGateResult r; r.name="cache_stats_sane"; double hr=run.metrics.cache.hit_rate();
  r.score=hr; r.passed=hr>=0.0 && hr<=1.0; r.message=r.passed?"ok":"bad"; return r;
}
QualityGateResult gate_no_error_on_success(const FusionRunResult& run) {
  QualityGateResult r; r.name="no_error_on_success";
  r.passed = !(run.success && !run.error.empty()); r.score=run.success?1:0; r.message=r.passed?"ok":"err"; return r;
}
QualityGateResult gate_task_nonempty(const FusionRunResult& run) {
  QualityGateResult r; r.name="task_nonempty"; r.passed=!run.config.task.empty();
  r.score=double(run.config.task.size()); r.message=r.passed?"ok":"empty"; return r;
}
QualityGateResult gate_diagnostic_no_shipping(const FusionRunResult& run) {
  QualityGateResult r; r.name="diagnostic_no_shipping";
  if (run.config.profile != FusionProfileId::Diagnostic) { r.passed=true; r.score=1; r.message="n/a"; return r; }
  bool ship = looks_like_shipping_plan(run.final_output);
  r.passed=!ship; r.score=ship?0:1; r.message=ship?"leak":"ok"; return r;
}
QualityGateResult gate_shipping_has_build_terms(const FusionRunResult& run) {
  QualityGateResult r; r.name="shipping_has_build_terms";
  if (run.config.profile != FusionProfileId::Shipping) { r.passed=true; r.score=1; r.message="n/a"; return r; }
  std::string low=run.final_output; for(char& c:low) if(c>='A'&&c<='Z') c=char(c-'A'+'a');
  bool ok = low.find("cmake")!=std::string::npos || low.find("conan")!=std::string::npos
         || low.find("cli")!=std::string::npos || low.size()>80;
  r.passed=ok; r.score=ok?1:0; r.message=ok?"ok":"missing"; return r;
}
QualityGateResult gate_branch_divergence(const FusionRunResult& run) {
  QualityGateResult r; r.name="branch_divergence";
  if (run.branches.size()<2) { r.passed=true; r.score=1; r.message="<2"; return r; }
  auto d = compare_branch_outputs(run.branches[0].combined, run.branches[1].combined);
  r.details=d.to_json(); r.passed=d.token_jaccard < 0.999; r.score=1.0-d.token_jaccard; r.message="div"; return r;
}
QualityGateResult gate_alignment_similarity_band(const FusionRunResult& run) {
  QualityGateResult r; r.name="alignment_similarity_band";
  if (run.branches.size()<2) { r.passed=true; r.score=0; return r; }
  double s = branch_alignment_similarity(run.branches[0].combined, run.branches[1].combined);
  r.score=s; r.passed=std::isfinite(s) && s>=0 && s<=1.0001; r.message="align"; return r;
}
QualityGateResult gate_rubric_normalized_band(const FusionRunResult& run) {
  QualityGateResult r; r.name="rubric_normalized_band";
  auto rub = score_with_rubric(run.final_output, task_faithful_rubric());
  r.score=rub.normalized; r.passed=rub.normalized>=0 && rub.normalized<=1.0001;
  r.details=rub.to_json(); r.message="rubric"; return r;
}
QualityGateResult gate_text_pipeline_tokens(const FusionRunResult& run) {
  QualityGateResult r; r.name="text_pipeline_tokens";
  auto st = analyze_text_pipeline(run.final_output, true);
  r.score=double(st.tokens); r.passed=st.tokens>0 || run.final_output.empty();
  r.details=st.to_json(); r.message="tokens"; return r;
}
QualityGateResult gate_call_records_match(const FusionRunResult& run) {
  QualityGateResult r; r.name="call_records_match";
  r.passed = (int)run.metrics.calls.size()==run.metrics.llm_calls || run.metrics.calls.empty();
  r.score=double(run.metrics.calls.size()); r.message=r.passed?"ok":"mismatch"; return r;
}
QualityGateResult gate_wall_ms_nonneg(const FusionRunResult& run) {
  QualityGateResult r; r.name="wall_ms_nonneg"; r.passed=run.metrics.wall_ms>=0;
  r.score=run.metrics.wall_ms; r.message="wall"; return r;
}
QualityGateResult gate_handoff_count_band(const FusionRunResult& run) {
  QualityGateResult r; r.name="handoff_count_band";
  r.passed=run.handoffs.size()<=16; r.score=double(run.handoffs.size()); r.message="handoffs"; return r;
}
QualityGateResult gate_merge_nonempty(const FusionRunResult& run) {
  QualityGateResult r; r.name="merge_nonempty";
  r.passed=!run.merge_output.empty() || !run.final_output.empty();
  r.score=double(run.merge_output.size()); r.message=r.passed?"ok":"empty"; return r;
}
QualityGateResult gate_profile_mode_strings(const FusionRunResult& run) {
  QualityGateResult r; r.name="profile_mode_strings";
  auto p=fusion_profile_to_string(run.config.profile);
  auto m=fusion_mode_to_string(run.config.mode);
  r.passed=!p.empty()&&!m.empty(); r.details=nlohmann::json{{"profile",p},{"mode",m}};
  r.score=1; r.message=p+"/"+m; return r;
}
QualityGateResult gate_prefer_specificity_defined(const FusionRunResult& run) {
  QualityGateResult r; r.name="prefer_specificity_defined";
  std::vector<std::string> outs;
  for (const auto& b: run.branches) outs.push_back(b.combined);
  int idx = prefer_branch_index(outs);
  r.passed = outs.empty() || (idx>=0 && idx<(int)outs.size());
  r.score=idx; r.message="prefer"; return r;
}
QualityGateResult gate_ultra_call_count(const FusionRunResult& run) {
  QualityGateResult r; r.name="ultra_call_count";
  if (run.config.mode != FusionMode::Ultra) { r.passed=true; r.score=run.metrics.llm_calls; r.message="n/a"; return r; }
  r.passed = run.metrics.llm_calls==5 || !run.success; // allow fail paths
  if (run.success) r.passed = run.metrics.llm_calls==5;
  r.score=run.metrics.llm_calls; r.message=r.passed?"ok":"expected 5"; return r;
}

std::vector<QualityGateResult> run_all_quality_gates(const FusionRunResult& run) {
  return {
    gate_min_output_length(run), gate_has_structure(run), gate_not_empty_branches(run),
    gate_llm_calls_positive(run), gate_cache_stats_sane(run), gate_no_error_on_success(run),
    gate_task_nonempty(run), gate_diagnostic_no_shipping(run), gate_shipping_has_build_terms(run),
    gate_branch_divergence(run), gate_alignment_similarity_band(run), gate_rubric_normalized_band(run),
    gate_text_pipeline_tokens(run), gate_call_records_match(run), gate_wall_ms_nonneg(run),
    gate_handoff_count_band(run), gate_merge_nonempty(run), gate_profile_mode_strings(run),
    gate_prefer_specificity_defined(run), gate_ultra_call_count(run),
  };
}
bool all_quality_gates_passed(const FusionRunResult& run) {
  for (const auto& g: run_all_quality_gates(run)) if (!g.passed) return false;
  return true;
}
nlohmann::json quality_gates_report(const FusionRunResult& run) {
  nlohmann::json arr=nlohmann::json::array(); int pass=0;
  auto gates = run_all_quality_gates(run);
  for (const auto& g: gates) { arr.push_back(g.to_json()); if (g.passed) ++pass; }
  return nlohmann::json{{"pass",pass},{"total",(int)gates.size()},{"gates",std::move(arr)}};
}

}}}
