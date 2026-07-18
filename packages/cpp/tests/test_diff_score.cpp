#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/runtime/diff_score.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>

#include <cassert>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

void test_diff_identical_handoffs() {
    HandoffState a;
    a.task = "t";
    a.from_agent = "A";
    a.to_agent = "B";
    a.summary = "enough words for a stable summary comparison";
    a.decisions = {"Use offline tools"};
    a.next_steps = {"Implement tests", "Run ctest"};
    auto d = diff_handoffs(a, a);
    assert(d.comparable);
    assert(d.overall_similarity >= 0.99);
    assert(d.to_json().contains("fields"));
    std::cout << "test_diff_identical_handoffs passed sim=" << d.overall_similarity << "\n";
}

void test_diff_team_and_scorecard() {
    Team team({
        Agent("Architect", "d", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
        Agent("Reviewer", "r", EchoProvider().as_any()),
    }, HandoffProtocol{});
    auto r1 = team.run("Diff baseline packaging");
    assert(r1);
    Team team2({
        Agent("Architect", "d", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
        Agent("Reviewer", "r", EchoProvider().as_any()),
    }, HandoffProtocol{});
    auto r2 = team2.run("Diff candidate packaging");
    assert(r2);
    auto delta = diff_team_runs(r1.value(), r2.value());
    assert(delta.comparable);
    assert(delta.to_json().contains("final_output_similarity"));
    auto tr = build_run_trace("d1", "diff", r2.value(), "hybrid_state");
    auto eval = WorkflowEvaluator{}.evaluate_trace(tr);
    auto card = build_scorecard(r2.value(), tr, eval.score);
    assert(card.contains("task"));
    assert(card.contains("final_output_chars"));
    assert(card.contains("handoff_count"));
    assert(card.contains("eval_score"));
    auto reg = regression_report(r1.value().handoffs, r2.value().handoffs);
    assert(reg.contains("average_similarity"));
    std::cout << "test_diff_team_and_scorecard passed\n";
}

void test_diff_demos() {
    demos::DemoOptions opt;
    opt.write_files = false;
    for (const char* id : {"diff_regression", "scorecard_batch"}) {
        auto r = demos::run_demo_by_id(id, opt);
        assert(r);
        assert(r.value().success);
        assert(r.value().to_json().contains("final_output"));
        assert(!r.value().to_json().at("final_output").get<std::string>().empty());
        std::cout << "  demo ok: " << id << "\n";
    }
    std::cout << "test_diff_demos passed\n";
}

}  // namespace

int main() {
    test_diff_identical_handoffs();
    test_diff_team_and_scorecard();
    test_diff_demos();
    std::cout << "All diff_score tests passed\n";
    return 0;
}
