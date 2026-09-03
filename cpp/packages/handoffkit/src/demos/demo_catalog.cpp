#include <handoffkit/demos/demo_types.hpp>

#include <sstream>

namespace handoffkit {
namespace demos {

std::vector<DemoSpec> all_demos() {
    return {
        {"team_handoff", "Sequential team handoff", "core",
         "Architect→Coder→Reviewer with structured handoffs", run_team_handoff_demo},
        {"tools", "Built-in tools", "core",
         "Calculator, tickets, SLA, checklist offline tools", run_tools_demo},
        {"protocol_matrix", "Protocol matrix", "core",
         "natural/compressed/hybrid_min/hybrid_state comparison", run_protocol_matrix_demo},
        {"validation_quality", "Validation & quality", "core",
         "Pass/fail validation and quality scores", run_validation_quality_demo},
        {"trace_report", "Trace & reports", "core",
         "RunTrace plus JSON/MD/HTML artifacts", run_trace_report_demo},
        {"support_escalation", "Support escalation", "showcase",
         "L1→L2→IC with ticket and SLA tools", run_support_escalation_demo},
        {"coding_review", "Coding review", "showcase",
         "Author→Reviewer→Maintainer with lint/diff tools", run_coding_review_demo},
        {"research_workflow", "Research workflow", "showcase",
         "Librarian→Analyst→Editor with keyword extract", run_research_workflow_demo},
        {"doctor_panel", "Doctor panel", "showcase",
         "Multi-specialist offline clinical-style panel", run_doctor_panel_demo},
        {"fusion_style", "Fusion-style merge", "showcase",
         "Two branches explored then merged", run_fusion_style_demo},
        {"recipe_pipeline", "Recipe pipeline", "workflow",
         "Named multi-step recipe runner", run_recipe_pipeline_demo},
        {"memory_continuity", "Memory continuity", "core",
         "Multi-turn agent memory recording", run_memory_continuity_demo},
        {"tool_registry_stress", "Tool stress", "core",
         "Many deterministic tool calls", run_tool_registry_stress_demo},
        {"multi_case_batch", "Multi-case batch", "corpus",
         "Sample of offline case corpus through short teams", run_multi_case_batch_demo},
        {"replay_from_trace", "Replay from trace", "core",
         "Reload RunTrace wire and render timeline", run_replay_from_trace_demo},
        {"quality_gate_pipeline", "Quality gate pipeline", "core",
         "Team run then quality evaluation gates", run_quality_gate_pipeline_demo},
        {"incident_response", "Incident response", "showcase",
         "Oncall→Comms→Scribe incident handoffs", run_incident_response_demo},
        {"product_spec_handoff", "Product spec handoff", "showcase",
         "PM→Designer→TechLead product handoff", run_product_spec_handoff_demo},
        {"orchestrator_support", "Orchestrator support", "deep",
         "Multi-stage support plan with quality gate/rescue", run_orchestrator_support_demo},
        {"orchestrator_coding", "Orchestrator coding", "deep",
         "Coding ship plan + lint + structured verdict", run_orchestrator_coding_demo},
        {"template_gallery", "Template gallery", "deep",
         "Execute all workflow templates offline", run_template_gallery_demo},
        {"eval_harness", "Eval harness", "deep",
         "Team+trace WorkflowEvaluator scoring", run_eval_harness_demo},
        {"structured_outputs", "Structured outputs", "deep",
         "JSON extract/repair/schema validation", run_structured_outputs_demo},
        {"replay_quality", "Replay quality", "deep",
         "Reexecute trace steps and rescore quality", run_replay_quality_demo},
        {"corpus_domain_sweep", "Corpus domain sweep", "deep",
         "One unique case per domain through short teams", run_corpus_domain_sweep_demo},
        {"text_metrics", "Text metrics", "deep",
         "Term frequency/jaccard/actionability on handoffs", run_text_metrics_demo},
        {"multi_orchestrator_compare", "Orchestrator compare", "deep",
         "Compare support/coding/incident orchestrator plans", run_multi_orchestrator_compare_demo},
        {"scenario_engine", "Scenario engine", "deep",
         "Multi-phase scenarios (tools/orch/eval/gallery/policy)", run_scenario_engine_demo},
        {"policy_guard", "Policy guard", "deep",
         "Approval + workspace path policy on tools", run_policy_guard_demo},
        {"report_gallery", "Report gallery", "deep",
         "JSON/MD/HTML multi-artifact report gallery", run_report_gallery_demo},
        {"release_readiness", "Release readiness", "deep",
         "Release readiness scenario + checklist", run_release_readiness_demo},
        {"consensus_panel", "Consensus panel", "deep",
         "Majority/weighted/borda consensus + team handoffs", run_consensus_panel_demo},
        {"benchmark_suite", "Benchmark suite", "deep",
         "Offline suite scoring many demos", run_benchmark_suite_demo},
        {"stress_orchestrator_matrix", "Orchestrator stress matrix", "deep",
         "Every orchestrator plan × 2 passes", run_stress_orchestrator_matrix_demo},
        {"job_scheduler", "Job scheduler", "deep",
         "Priority offline multi-agent job batch", run_job_scheduler_demo},
        {"dag_release", "DAG release pipeline", "deep",
         "Topological release graph execution", run_dag_release_demo},
        {"dag_support", "DAG support pipeline", "deep",
         "Support dependency graph with joins", run_dag_support_demo},
        {"diff_regression", "Diff regression", "deep",
         "Compare two offline runs field-by-field", run_diff_regression_demo},
        {"scorecard_batch", "Scorecard batch", "deep",
         "Scorecards across a fixed offline demo set", run_scorecard_batch_demo},
        {"fusion_style_router", "Fusion-style via FusionEngine", "live",
         "Dual branch + merger; lean=3 / ultra=5; profiles+cache (demos/fusion/)",
         run_fusion_style_router_demo},
        {"fusion_cache_lab", "Fusion cache lab", "live",
         "Memory+disk cache put/get/evict offline lab",
         run_fusion_cache_lab_demo},
        {"fusion_neutral_ultra", "Fusion neutral ULTRA", "live",
         "Task-faithful ultra profile (echo by default)",
         run_fusion_neutral_ultra_demo},
    };
}

std::vector<std::string> demo_ids() {
    std::vector<std::string> ids;
    for (const auto& d : all_demos()) {
        ids.push_back(d.id);
    }
    return ids;
}

Result<DemoResult> run_demo_by_id(std::string_view id, const DemoOptions& options) {
    for (const auto& d : all_demos()) {
        if (d.id == id) {
            return d.run(options);
        }
    }
    return Error::invalid_argument(std::string("Unknown demo id: ") + std::string(id), "demo");
}

std::string list_demos_text() {
    std::ostringstream ss;
    ss << "Available demos:\n";
    for (const auto& d : all_demos()) {
        ss << "  - " << d.id << " [" << d.category << "] " << d.title << "\n"
           << "      " << d.description << "\n";
    }
    return ss.str();
}

}  // namespace demos
}  // namespace handoffkit
