#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/scheduler.hpp>
#include <handoffkit/util/text.hpp>

namespace handoffkit {
namespace demos {
namespace {
Agent mk(const char* n, const char* r) { return make_echo_agent(n, r); }
}

Result<DemoResult> run_job_scheduler_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "job_scheduler";
    result.title = "Priority job scheduler batch";
    result.task = "Run offline scheduled multi-agent jobs by priority";

    JobScheduler sched;
    for (auto& j : JobScheduler::demo_batch("batch")) {
        sched.enqueue(std::move(j));
    }
    // extra high-priority incident
    Job urgent;
    urgent.id = "batch-urgent";
    urgent.name = "Urgent incident notes";
    urgent.kind = JobKind::Team;
    urgent.priority = 100;
    urgent.task = "Draft SEV-1 mitigation handoff offline";
    sched.enqueue(std::move(urgent));

    std::vector<Agent> agents = {
        mk("Architect", "design"),
        mk("Coder", "code"),
        mk("Reviewer", "review"),
        mk("Oncall", "ops"),
    };
    auto runs = sched.run_all(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    if (!runs) return runs.error();

    nlohmann::json rows = nlohmann::json::array();
    int ok = 0;
    for (const auto& r : runs.value()) {
        rows.push_back(r.to_json());
        if (r.success) ++ok;
        if (!r.final_output.empty()) result.final_output = r.final_output;
    }
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"jobs", rows},
        {"ok", ok},
        {"total", rows.size()},
    };
    result.success = ok >= 3 && !result.final_output.empty();
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_dag_release_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "dag_release";
    result.title = "DAG release pipeline";
    result.task = "Execute dependency-ordered release pipeline offline";

    std::vector<Agent> agents = {
        mk("Planner", "plan"),
        mk("Coder", "code"),
        mk("Verifier", "verify"),
        mk("Releaser", "release"),
        mk("Editor", "docs"),
    };
    DagExecutor dag(DagExecutor::release_pipeline_graph());
    auto run = dag.run(agents, result.task);
    if (!run) return run.error();
    result.final_output = run.value().to_json().dump(2);
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"dag", run.value().to_json()},
    };
    result.success = run.value().success && run.value().order.size() >= 5;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_dag_support_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "dag_support";
    result.title = "DAG support pipeline";
    result.task = "Execute support dependency graph offline";

    std::vector<Agent> agents = {
        mk("L1_Support", "l1"),
        mk("L2_Support", "l2"),
        mk("Oncall", "oncall"),
        mk("Comms", "comms"),
        mk("Scribe", "scribe"),
    };
    DagExecutor dag(DagExecutor::support_pipeline_graph());
    auto run = dag.run(agents, result.task);
    if (!run) return run.error();
    result.final_output = run.value().node_results.empty()
        ? ""
        : run.value().node_results.back().final_output;
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"dag", run.value().to_json()},
        {"order", run.value().order},
    };
    result.success = run.value().success && !result.final_output.empty();
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

}  // namespace demos
}  // namespace handoffkit
