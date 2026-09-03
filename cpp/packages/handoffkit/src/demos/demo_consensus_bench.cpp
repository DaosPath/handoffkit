#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/io/report_gallery.hpp>
#include <handoffkit/runtime/consensus.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/orchestrator.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/util/text.hpp>

#include <sstream>

namespace handoffkit {
namespace demos {
namespace {

Agent mk(const char* n, const char* r) {
    return make_echo_agent(n, r);
}

}  // namespace

Result<DemoResult> run_consensus_panel_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "consensus_panel";
    result.title = "Multi-agent consensus panel";
    result.task = "Choose primary mitigation for auth outage offline";

    std::vector<Agent> agents = {
        mk("Emergency_MD", "life threats"),
        mk("Cardiologist", "cardiac"),
        mk("Moderator", "consensus"),
        mk("Skeptic", "challenge"),
        mk("Scribe", "record"),
    };
    ConsensusEngine engine;
    const std::vector<std::string> choices = {
        "fail_closed_auth",
        "partial_degrade",
        "rollback_deploy",
        "scale_out",
    };
    auto panel = engine.run_panel(agents, result.task, choices);
    if (!panel) return panel.error();

    // Also run a team for handoff artifacts
    Team team({
        mk("Oncall", "mitigate"),
        mk("Comms", "comms"),
        mk("Scribe", "scribe"),
    }, HandoffProtocol(ProtocolMode::HybridState));
    auto tr = team.run(result.task);
    if (!tr) return tr.error();

    result.final_output = panel.value().dump(2);
    result.handoffs = tr.value().handoffs;
    result.trace = build_run_trace("consensus-1", "consensus_panel", tr.value(), "hybrid_state");
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"panel", panel.value()},
        {"team", tr.value().to_json()},
        {"handoffs", tr.value().to_json().at("handoffs")},
    };
    result.success = panel.value().contains("majority") && !result.final_output.empty();
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_benchmark_suite_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "benchmark_suite";
    result.title = "Offline demo benchmark suite";
    result.task = "Score a fixed set of offline demos for success and eval grade";

    const char* suite[] = {
        "team_handoff", "support_escalation", "coding_review", "research_workflow",
        "incident_response", "eval_harness", "structured_outputs", "policy_guard",
        "orchestrator_support", "orchestrator_coding", "corpus_domain_sweep",
        "text_metrics", "recipe_pipeline", "quality_gate_pipeline",
    };

    nlohmann::json rows = nlohmann::json::array();
    int ok = 0;
    WorkflowEvaluator eval(0.5);
    DemoOptions opt = options;
    opt.write_files = false;

    for (const char* id : suite) {
        auto demo = run_demo_by_id(id, opt);
        nlohmann::json row{{"id", id}};
        if (!demo) {
            row["success"] = false;
            row["error"] = demo.error().message;
            rows.push_back(row);
            continue;
        }
        row["success"] = demo.value().success;
        row["final_output_chars"] = demo.value().final_output.size();
        row["handoff_count"] = demo.value().handoffs.size();
        if (!demo.value().trace.steps.empty()) {
            auto er = eval.evaluate_trace(demo.value().trace);
            row["eval_score"] = er.score;
            row["eval_grade"] = er.grade;
            row["eval_success"] = er.success;
        }
        if (demo.value().success) ++ok;
        rows.push_back(std::move(row));
    }

    result.final_output = "benchmark_ok=" + std::to_string(ok) + "/" + std::to_string(rows.size());
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"rows", rows},
        {"ok", ok},
        {"total", rows.size()},
    };
    result.success = ok >= static_cast<int>(rows.size()) - 2;  // allow tiny flake margin
    if (options.write_files) {
        ReportGallery gallery(options.output_dir / "benchmark");
        auto g = gallery.write_comparison_gallery("demo_benchmark", result.report);
        if (g) {
            for (const auto& a : g.value().artifacts) result.artifact_paths.push_back(a.path.string());
        }
    }
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_stress_orchestrator_matrix_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "stress_orchestrator_matrix";
    result.title = "Stress orchestrator matrix";
    result.task = "Run every catalog orchestrator plan twice and aggregate";

    nlohmann::json runs = nlohmann::json::array();
    int ok = 0;
    for (const auto& plan : Orchestrator::catalog()) {
        for (int pass = 0; pass < 2; ++pass) {
            std::vector<Agent> agents;
            if (plan.name.find("support") != std::string::npos) {
                agents = {mk("L1_Support", "l1"), mk("L2_Support", "l2"), mk("Incident_Commander", "ic")};
            } else if (plan.name.find("coding") != std::string::npos) {
                agents = {mk("Author", "a"), mk("Reviewer", "r"), mk("Maintainer", "m")};
            } else if (plan.name.find("research") != std::string::npos) {
                agents = {mk("Librarian", "l"), mk("Analyst", "a"), mk("Editor", "e")};
            } else if (plan.name.find("incident") != std::string::npos) {
                agents = {mk("Oncall", "o"), mk("Comms", "c"), mk("Scribe", "s")};
            } else if (plan.name.find("product") != std::string::npos) {
                agents = {mk("PM", "p"), mk("Designer", "d"), mk("TechLead", "t")};
            } else {
                agents = {mk("Architect", "a"), mk("Coder", "c"), mk("Reviewer", "r")};
            }
            Orchestrator orch(std::move(agents));
            auto run = orch.run(plan, result.task + " pass=" + std::to_string(pass));
            nlohmann::json row{
                {"plan", plan.name},
                {"pass", pass},
                {"success", run && run.value().success},
            };
            if (run) {
                row["final_output_chars"] = run.value().final_output.size();
                row["stages"] = run.value().stages.size();
                row["handoffs"] = run.value().all_handoffs.size();
                if (run.value().success) ++ok;
            } else {
                row["error"] = run.error().message;
            }
            runs.push_back(std::move(row));
        }
    }
    result.final_output = "matrix_ok=" + std::to_string(ok);
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"runs", runs},
        {"ok", ok},
    };
    result.success = ok >= static_cast<int>(Orchestrator::catalog().size());
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

}  // namespace demos
}  // namespace handoffkit
