#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/scheduler.hpp>

#include <cassert>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

void test_job_scheduler_priority_order_and_run() {
    JobScheduler sched;
    for (auto& j : JobScheduler::demo_batch("t")) sched.enqueue(std::move(j));
    Job high;
    high.id = "high";
    high.name = "high";
    high.priority = 999;
    high.kind = JobKind::Agent;
    high.task = "Urgent agent task";
    high.payload = {{"agent", "Architect"}};
    sched.enqueue(std::move(high));

    std::vector<Agent> agents = {
        Agent("Architect", "d", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
        Agent("Reviewer", "r", EchoProvider().as_any()),
    };
    auto results = sched.run_all(std::move(agents));
    assert(results);
    assert(results.value().size() >= 5);
    // First result should be highest priority job
    assert(results.value().front().id == "high");
    int ok = 0;
    for (const auto& r : results.value()) if (r.success) ++ok;
    assert(ok >= 4);
    assert(results.value().front().to_json().contains("final_output"));
    std::cout << "test_job_scheduler_priority_order_and_run passed ok=" << ok << "\n";
}

void test_dag_topological_release_and_support() {
    std::vector<Agent> agents = {
        Agent("Planner", "p", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
        Agent("Verifier", "v", EchoProvider().as_any()),
        Agent("Releaser", "r", EchoProvider().as_any()),
        Agent("Editor", "e", EchoProvider().as_any()),
    };
    DagExecutor release(DagExecutor::release_pipeline_graph());
    auto rr = release.run(agents, "Ship C++ release offline");
    assert(rr);
    assert(rr.value().success);
    assert(rr.value().order.front() == "plan");
    assert(rr.value().order.back() == "docs");
    assert(rr.value().to_json().contains("node_results"));

    std::vector<Agent> support = {
        Agent("L1_Support", "l1", EchoProvider().as_any()),
        Agent("L2_Support", "l2", EchoProvider().as_any()),
        Agent("Oncall", "o", EchoProvider().as_any()),
        Agent("Comms", "c", EchoProvider().as_any()),
        Agent("Scribe", "s", EchoProvider().as_any()),
    };
    DagExecutor sup(DagExecutor::support_pipeline_graph());
    auto sr = sup.run(support, "Support graph");
    assert(sr);
    assert(sr.value().success);
    // close depends on comms and mitigate — must be last
    assert(sr.value().order.back() == "close");
    std::cout << "test_dag_topological_release_and_support passed\n";
}

void test_scheduler_demos() {
    demos::DemoOptions opt;
    opt.write_files = false;
    for (const char* id : {"job_scheduler", "dag_release", "dag_support"}) {
        auto r = demos::run_demo_by_id(id, opt);
        assert(r);
        assert(r.value().success);
        assert(r.value().to_json().contains("final_output"));
        std::cout << "  demo ok: " << id << "\n";
    }
    std::cout << "test_scheduler_demos passed\n";
}

void test_cycle_detection() {
    std::vector<DagNode> cycle = {
        {"a", {"b"}, "Architect", "A"},
        {"b", {"a"}, "Coder", "B"},
    };
    DagExecutor dag(std::move(cycle));
    std::vector<Agent> agents = {
        Agent("Architect", "a", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
    };
    auto r = dag.run(agents, "cycle");
    assert(!r);  // should fail on cycle
    std::cout << "test_cycle_detection passed\n";
}

}  // namespace

int main() {
    test_job_scheduler_priority_order_and_run();
    test_dag_topological_release_and_support();
    test_scheduler_demos();
    test_cycle_detection();
    std::cout << "All scheduler/DAG tests passed\n";
    return 0;
}
