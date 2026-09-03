#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/workflows/recipe.hpp>

#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {

struct DemoOptions {
    std::filesystem::path output_dir{"runs/cpp-demos"};
    std::string case_id;
    bool write_files = true;
    ProtocolMode protocol = ProtocolMode::HybridState;
    nlohmann::json extra = nlohmann::json::object();
};

struct DemoResult {
    bool success = false;
    std::string name;
    std::string title;
    std::string task;
    std::string final_output;
    std::string summary_markdown;
    std::vector<HandoffState> handoffs;
    RunTrace trace;
    nlohmann::json report = nlohmann::json::object();
    std::vector<std::string> artifact_paths;

    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

using DemoFn = std::function<Result<DemoResult>(const DemoOptions&)>;

struct DemoSpec {
    std::string id;
    std::string title;
    std::string category;
    std::string description;
    DemoFn run;
};

[[nodiscard]] std::vector<DemoSpec> all_demos();
[[nodiscard]] std::vector<std::string> demo_ids();
[[nodiscard]] Result<DemoResult> run_demo_by_id(std::string_view id, const DemoOptions& options = {});
[[nodiscard]] std::string list_demos_text();

// Individual demos (also callable directly / from tests)
Result<DemoResult> run_team_handoff_demo(const DemoOptions& options = {});
Result<DemoResult> run_tools_demo(const DemoOptions& options = {});
Result<DemoResult> run_protocol_matrix_demo(const DemoOptions& options = {});
Result<DemoResult> run_validation_quality_demo(const DemoOptions& options = {});
Result<DemoResult> run_trace_report_demo(const DemoOptions& options = {});
Result<DemoResult> run_support_escalation_demo(const DemoOptions& options = {});
Result<DemoResult> run_coding_review_demo(const DemoOptions& options = {});
Result<DemoResult> run_research_workflow_demo(const DemoOptions& options = {});
Result<DemoResult> run_doctor_panel_demo(const DemoOptions& options = {});
Result<DemoResult> run_recipe_pipeline_demo(const DemoOptions& options = {});
Result<DemoResult> run_memory_continuity_demo(const DemoOptions& options = {});
Result<DemoResult> run_tool_registry_stress_demo(const DemoOptions& options = {});
Result<DemoResult> run_multi_case_batch_demo(const DemoOptions& options = {});
Result<DemoResult> run_replay_from_trace_demo(const DemoOptions& options = {});
Result<DemoResult> run_quality_gate_pipeline_demo(const DemoOptions& options = {});
Result<DemoResult> run_incident_response_demo(const DemoOptions& options = {});
Result<DemoResult> run_product_spec_handoff_demo(const DemoOptions& options = {});

// Deep multi-step pipelines (orchestrator/eval/replay/templates)
Result<DemoResult> run_orchestrator_support_demo(const DemoOptions& options = {});
Result<DemoResult> run_orchestrator_coding_demo(const DemoOptions& options = {});
Result<DemoResult> run_template_gallery_demo(const DemoOptions& options = {});
Result<DemoResult> run_eval_harness_demo(const DemoOptions& options = {});
Result<DemoResult> run_structured_outputs_demo(const DemoOptions& options = {});
Result<DemoResult> run_replay_quality_demo(const DemoOptions& options = {});
Result<DemoResult> run_corpus_domain_sweep_demo(const DemoOptions& options = {});
Result<DemoResult> run_text_metrics_demo(const DemoOptions& options = {});
Result<DemoResult> run_multi_orchestrator_compare_demo(const DemoOptions& options = {});
Result<DemoResult> run_scenario_engine_demo(const DemoOptions& options = {});
Result<DemoResult> run_policy_guard_demo(const DemoOptions& options = {});
Result<DemoResult> run_report_gallery_demo(const DemoOptions& options = {});
Result<DemoResult> run_release_readiness_demo(const DemoOptions& options = {});
Result<DemoResult> run_consensus_panel_demo(const DemoOptions& options = {});
Result<DemoResult> run_benchmark_suite_demo(const DemoOptions& options = {});
Result<DemoResult> run_stress_orchestrator_matrix_demo(const DemoOptions& options = {});
Result<DemoResult> run_job_scheduler_demo(const DemoOptions& options = {});
Result<DemoResult> run_dag_release_demo(const DemoOptions& options = {});
Result<DemoResult> run_dag_support_demo(const DemoOptions& options = {});
Result<DemoResult> run_diff_regression_demo(const DemoOptions& options = {});
Result<DemoResult> run_scorecard_batch_demo(const DemoOptions& options = {});

// Helpers shared by demos
[[nodiscard]] Result<std::string> write_demo_artifacts(
    const DemoOptions& options,
    DemoResult& result
);

[[nodiscard]] Agent make_echo_agent(std::string name, std::string role);

}  // namespace demos
}  // namespace handoffkit

// Fusion-style demo family (live + offline). Declares run_fusion_style_* APIs.
// Guard avoids re-entry when fusion_style.hpp includes this header first.
#ifndef HANDOFFKIT_DEMOS_FUSION_STYLE_HPP_INCLUDED
#include <handoffkit/demos/fusion/fusion_style.hpp>
#endif

