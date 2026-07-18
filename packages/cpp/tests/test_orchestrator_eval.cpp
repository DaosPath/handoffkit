#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/orchestrator.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <cassert>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

Agent A(const char* n, const char* r) {
    return Agent(n, r, EchoProvider().as_any());
}

void test_support_orchestrator_plan() {
    std::vector<Agent> agents = {
        A("L1_Support", "triage"),
        A("L2_Support", "deep"),
        A("Incident_Commander", "ic"),
    };
    Orchestrator orch(std::move(agents));
    auto run = orch.run(Orchestrator::support_escalation_plan(), "Escalate P0 auth outage offline");
    assert(run);
    assert(run.value().success);
    assert(!run.value().final_output.empty());
    assert(run.value().to_json().contains("task"));
    assert(run.value().to_json().contains("final_output"));
    assert(run.value().to_json().contains("handoffs"));
    assert(run.value().stages.size() >= 2);
    std::cout << "test_support_orchestrator_plan passed\n";
}

void test_coding_orchestrator_and_catalog() {
    auto catalog = Orchestrator::catalog();
    assert(catalog.size() >= 5);
    std::vector<Agent> agents = {
        A("Author", "a"), A("Reviewer", "r"), A("Maintainer", "m"),
    };
    Orchestrator orch(std::move(agents));
    auto run = orch.run(Orchestrator::coding_ship_plan(), "Ship divide-by-zero fix");
    assert(run);
    assert(run.value().success);
    assert(!run.value().trace.steps.empty());
    std::cout << "test_coding_orchestrator_and_catalog passed\n";
}

void test_workflow_evaluator_team_and_trace() {
    std::vector<Agent> agents = {
        A("Architect", "design"), A("Coder", "code"), A("Reviewer", "review"),
    };
    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto tr = team.run("Evaluate this sequential handoff workflow");
    assert(tr);
    auto trace = build_run_trace("t1", "eval", tr.value(), "hybrid_state");
    WorkflowEvaluator eval(0.5);
    auto team_eval = eval.evaluate_team(tr.value());
    auto trace_eval = eval.evaluate_trace(trace);
    auto combined = eval.evaluate_combined(tr.value(), trace);
    assert(team_eval.to_json().contains("checks"));
    assert(trace_eval.to_json().contains("score"));
    assert(combined.to_json().contains("grade"));
    assert(!team_eval.checks.empty());
    // Wire keys check should pass on team JSON
    bool saw_wire = false;
    for (const auto& c : team_eval.checks) {
        if (c.name == "wire_keys") {
            saw_wire = true;
            assert(c.passed);
        }
    }
    assert(saw_wire);
    assert(tr.value().to_json().at("task").is_string());
    assert(tr.value().to_json().at("final_output").is_string());
    std::cout << "test_workflow_evaluator_team_and_trace passed scores team="
              << team_eval.score << " trace=" << trace_eval.score << "\n";
}

void test_incident_rescue_plan_runs() {
    std::vector<Agent> agents = {
        A("Oncall", "o"), A("Comms", "c"), A("Scribe", "s"),
    };
    Orchestrator orch(std::move(agents));
    auto run = orch.run(Orchestrator::incident_with_rescue_plan(), "SEV-1 auth mitigation");
    assert(run);
    assert(!run.value().final_output.empty());
    assert(run.value().to_json().contains("stages"));
    std::cout << "test_incident_rescue_plan_runs passed\n";
}

}  // namespace

int main() {
    test_support_orchestrator_plan();
    test_coding_orchestrator_and_catalog();
    test_workflow_evaluator_team_and_trace();
    test_incident_rescue_plan_runs();
    std::cout << "All orchestrator/eval tests passed\n";
    return 0;
}
