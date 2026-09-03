#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/runtime/consensus.hpp>
#include <handoffkit/runtime/echo_provider.hpp>

#include <cassert>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

void test_majority_weighted_borda() {
    ConsensusEngine engine;
    std::vector<Vote> votes = {
        {"a", "rollback_deploy", 0.9, "safer"},
        {"b", "rollback_deploy", 0.7, "agree"},
        {"c", "scale_out", 0.6, "capacity"},
        {"d", "fail_closed_auth", 0.5, "secure"},
    };
    auto maj = engine.majority(votes);
    assert(maj.success);
    assert(maj.winner == "rollback_deploy");
    auto w = engine.weighted(votes);
    assert(w.success);
    assert(!w.winner.empty());

    std::vector<std::vector<std::string>> rankings = {
        {"rollback_deploy", "scale_out", "fail_closed_auth"},
        {"scale_out", "rollback_deploy", "fail_closed_auth"},
        {"rollback_deploy", "fail_closed_auth", "scale_out"},
    };
    auto b = engine.borda(rankings);
    assert(b.success);
    assert(!b.winner.empty());
    assert(b.to_json().contains("method"));
    std::cout << "test_majority_weighted_borda passed winner_maj=" << maj.winner
              << " borda=" << b.winner << "\n";
}

void test_collect_echo_votes_and_panel() {
    std::vector<Agent> agents = {
        Agent("A1", "r", EchoProvider().as_any()),
        Agent("A2", "r", EchoProvider().as_any()),
        Agent("A3", "r", EchoProvider().as_any()),
    };
    ConsensusEngine engine;
    std::vector<std::string> choices = {"alpha", "beta", "gamma"};
    auto votes = engine.collect_echo_votes(agents, "Pick a strategy", choices);
    assert(votes);
    assert(votes.value().size() == 3);
    auto panel = engine.run_panel(agents, "Pick a strategy", choices);
    assert(panel);
    assert(panel.value().contains("majority"));
    assert(panel.value().contains("weighted"));
    assert(panel.value().contains("borda"));
    assert(panel.value().contains("votes"));
    std::cout << "test_collect_echo_votes_and_panel passed\n";
}

void test_consensus_and_benchmark_demos() {
    demos::DemoOptions opt;
    opt.write_files = false;
    for (const char* id : {"consensus_panel", "benchmark_suite", "stress_orchestrator_matrix"}) {
        auto r = demos::run_demo_by_id(id, opt);
        assert(r);
        assert(r.value().success);
        auto wire = r.value().to_json();
        assert(wire.contains("task"));
        assert(wire.contains("final_output"));
        assert(!wire.at("final_output").get<std::string>().empty());
        std::cout << "  demo ok: " << id << "\n";
    }
    std::cout << "test_consensus_and_benchmark_demos passed\n";
}

}  // namespace

int main() {
    test_majority_weighted_borda();
    test_collect_echo_votes_and_panel();
    test_consensus_and_benchmark_demos();
    std::cout << "All consensus/benchmark tests passed\n";
    return 0;
}
