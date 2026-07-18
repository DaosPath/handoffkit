#include <handoffkit/demos/fusion/fusion_style.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

namespace handoffkit {
namespace demos {

Result<DemoResult> run_fusion_style_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "fusion_style";
    result.title = "Fusion-style multi-branch then merge";
    result.task = "Explore two solution branches offline then merge recommendations";

    // Branch A
    std::vector<Agent> branch_a;
    branch_a.push_back(make_echo_agent("BranchA_Architect", "Proposes library-first design"));
    branch_a.push_back(make_echo_agent("BranchA_Skeptic", "Stress-tests packaging risks"));
    Team team_a(std::move(branch_a), HandoffProtocol(ProtocolMode::HybridMin));
    auto run_a = team_a.run(result.task + " [branch=A]");
    if (!run_a) return run_a.error();

    // Branch B
    std::vector<Agent> branch_b;
    branch_b.push_back(make_echo_agent("BranchB_Architect", "Proposes CLI-first design"));
    branch_b.push_back(make_echo_agent("BranchB_Skeptic", "Stress-tests UX risks"));
    Team team_b(std::move(branch_b), HandoffProtocol(ProtocolMode::HybridMin));
    auto run_b = team_b.run(result.task + " [branch=B]");
    if (!run_b) return run_b.error();

    Agent merger = make_echo_agent("Merger", "Merges branch recommendations into one plan");
    auto merged = merger.run(
        result.task + "\nA:\n" + run_a.value().final_output + "\nB:\n" + run_b.value().final_output
    );
    if (!merged) return merged.error();

    result.final_output = merged.value();
    result.handoffs = run_a.value().handoffs;
    for (const auto& h : run_b.value().handoffs) result.handoffs.push_back(h);
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"branch_a", run_a.value().to_json()},
        {"branch_b", run_b.value().to_json()},
        {"handoffs", nlohmann::json::array()},
    };
    for (const auto& h : result.handoffs) result.report["handoffs"].push_back(h.to_json());
    TeamRunResult fake;
    fake.task = result.task;
    fake.final_output = result.final_output;
    fake.success = true;
    fake.agent_outputs = {
        {"BranchA", run_a.value().final_output},
        {"BranchB", run_b.value().final_output},
        {"Merger", result.final_output},
    };
    fake.handoffs = result.handoffs;
    result.trace = build_run_trace("demo-fusion", "fusion_style", fake, "hybrid_min");
    result.success = !result.final_output.empty();
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

}  // namespace demos
}  // namespace handoffkit
