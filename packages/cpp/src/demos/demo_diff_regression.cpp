#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/runtime/diff_score.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

namespace handoffkit {
namespace demos {
namespace {
Agent mk(const char* n, const char* r) { return make_echo_agent(n, r); }
}

Result<DemoResult> run_diff_regression_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "diff_regression";
    result.title = "Handoff/run regression diff";
    result.task = "Compare two offline team runs for regression scoring";

    auto make_team = [] {
        return Team({
            mk("Architect", "design"),
            mk("Coder", "code"),
            mk("Reviewer", "review"),
        }, HandoffProtocol(ProtocolMode::HybridState));
    };

    auto t1 = make_team().run(result.task + " baseline");
    if (!t1) return t1.error();
    auto t2 = make_team().run(result.task + " candidate");
    if (!t2) return t2.error();

    auto tr1 = build_run_trace("base-1", "baseline", t1.value(), "hybrid_state");
    auto tr2 = build_run_trace("cand-1", "candidate", t2.value(), "hybrid_state");
    auto team_delta = diff_team_runs(t1.value(), t2.value());
    auto trace_delta = diff_traces(tr1, tr2);
    auto reg = regression_report(t1.value().handoffs, t2.value().handoffs);
    auto eval = WorkflowEvaluator{}.evaluate_trace(tr2);
    auto scorecard = build_scorecard(t2.value(), tr2, eval.score);

    result.final_output = team_delta.to_markdown();
    result.handoffs = t2.value().handoffs;
    result.trace = tr2;
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"team_delta", team_delta.to_json()},
        {"trace_delta", trace_delta.to_json()},
        {"regression", reg},
        {"scorecard", scorecard},
        {"handoffs", t2.value().to_json().at("handoffs")},
    };
    result.success = team_delta.comparable && reg.value("pass", false);
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_scorecard_batch_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "scorecard_batch";
    result.title = "Scorecard batch across demos";
    result.task = "Build scorecards for a fixed offline demo set";

    const char* ids[] = {
        "team_handoff", "support_escalation", "coding_review", "dag_release", "policy_guard",
    };
    nlohmann::json rows = nlohmann::json::array();
    DemoOptions opt = options;
    opt.write_files = false;
    int ok = 0;
    for (const char* id : ids) {
        auto demo = run_demo_by_id(id, opt);
        nlohmann::json row{{"id", id}};
        if (!demo) {
            row["success"] = false;
            row["error"] = demo.error().message;
            rows.push_back(row);
            continue;
        }
        TeamRunResult team;
        team.task = demo.value().task;
        team.final_output = demo.value().final_output;
        team.handoffs = demo.value().handoffs;
        team.success = demo.value().success;
        auto eval = WorkflowEvaluator{}.evaluate_trace(demo.value().trace);
        row["scorecard"] = build_scorecard(team, demo.value().trace, eval.score);
        row["success"] = demo.value().success;
        if (demo.value().success) ++ok;
        rows.push_back(std::move(row));
        result.final_output = demo.value().final_output;
    }
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"rows", rows},
        {"ok", ok},
        {"total", rows.size()},
    };
    result.success = ok >= 4;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

}  // namespace demos
}  // namespace handoffkit
