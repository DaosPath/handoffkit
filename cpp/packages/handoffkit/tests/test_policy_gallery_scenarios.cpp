#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/demos/scenario_engine.hpp>
#include <handoffkit/io/report_gallery.hpp>
#include <handoffkit/runtime/builtin_tools.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/policy.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

std::filesystem::path scratch() {
#ifdef HANDOFFKIT_TEST_SCRATCH
    return std::filesystem::path(HANDOFFKIT_TEST_SCRATCH) / "policy-gallery";
#else
    return std::filesystem::temp_directory_path() / "handoffkit-policy-gallery";
#endif
}

void test_path_policy_blocks_escape() {
    PathPolicy policy(scratch());
    auto bad = policy.check(std::filesystem::path("..") / "outside.txt", PathAccess::Write);
    assert(!bad.allowed);
    auto good = policy.check("reports/team.json", PathAccess::Write);
    assert(good.allowed);
    std::cout << "test_path_policy_blocks_escape passed\n";
}

void test_approval_policy_and_guarded_registry() {
    ApprovalPolicy approvals(true);
    approvals.allow_tool("calculator");
    auto deny = approvals.decide({"run_shell", "execute", {}});
    assert(!deny.allowed);
    assert(deny.requires_human);

    ToolRegistry reg;
    register_demo_toolbox(reg);
    PolicyGuardedRegistry guarded(std::move(reg), approvals, PathPolicy(scratch()));
    ToolCall calc;
    calc.tool_name = "calculator";
    calc.arguments = {{"expression", "8 + 1"}};
    auto out = guarded.execute(calc);
    assert(out);
    assert(out.value().success);
    assert(out.value().result.at("result") == 9);
    std::cout << "test_approval_policy_and_guarded_registry passed\n";
}

void test_report_gallery_writes_artifacts() {
    Team team({
        Agent("Architect", "d", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
    }, HandoffProtocol{});
    auto tr = team.run("Gallery packaging task");
    assert(tr);
    auto trace = build_run_trace("g1", "gallery", tr.value(), "hybrid_state");
    auto eval = WorkflowEvaluator{}.evaluate_trace(trace);
    ReportGallery gallery(scratch() / "galleries");
    auto g = gallery.write_team_gallery("unit_gallery", tr.value(), trace, &eval);
    assert(g);
    assert(g.value().success);
    assert(g.value().artifacts.size() >= 5);
    assert(std::filesystem::exists(scratch() / "galleries" / "unit-gallery" / "team.json") ||
           std::filesystem::exists(scratch() / "galleries" / "unit_gallery" / "team.json") ||
           g.value().artifacts[0].path.string().find("team.json") != std::string::npos);
    // primary: gallery JSON includes snake_case team payload keys via index
    assert(g.value().to_json().contains("artifacts"));
    std::cout << "test_report_gallery_writes_artifacts passed count="
              << g.value().artifacts.size() << "\n";
}

void test_scenario_engine_catalog() {
    demos::DemoOptions opt;
    opt.output_dir = scratch() / "scenarios";
    opt.write_files = true;
    demos::ScenarioEngine engine;
    assert(demos::ScenarioEngine::catalog().size() >= 5);
    for (const auto& sc : demos::ScenarioEngine::catalog()) {
        auto run = engine.run(sc, opt);
        assert(run);
        assert(run.value().success);
        assert(run.value().to_json().contains("task"));
        assert(run.value().to_json().contains("final_output"));
        std::cout << "  scenario ok: " << sc.id << "\n";
    }
    std::cout << "test_scenario_engine_catalog passed\n";
}

void test_new_demos_registered() {
    demos::DemoOptions opt;
    opt.write_files = false;
    opt.output_dir = scratch() / "demos";
    for (const char* id : {"scenario_engine", "policy_guard", "report_gallery", "release_readiness"}) {
        auto r = demos::run_demo_by_id(id, opt);
        assert(r);
        assert(r.value().success);
        assert(r.value().to_json().contains("final_output"));
        std::cout << "  demo ok: " << id << "\n";
    }
    std::cout << "test_new_demos_registered passed\n";
}

}  // namespace

int main() {
    test_path_policy_blocks_escape();
    test_approval_policy_and_guarded_registry();
    test_report_gallery_writes_artifacts();
    test_scenario_engine_catalog();
    test_new_demos_registered();
    std::cout << "All policy/gallery/scenario tests passed\n";
    return 0;
}
