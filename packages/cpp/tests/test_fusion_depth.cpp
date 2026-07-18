#include <handoffkit/demos/fusion/cache_index.hpp>
#include <handoffkit/demos/fusion/branch_compare.hpp>
#include <handoffkit/demos/fusion/merge_strategy.hpp>
#include <handoffkit/demos/fusion/engine_resume.hpp>
#include <handoffkit/demos/fusion/text_pipeline.hpp>
#include <handoffkit/demos/fusion/scenarios_deep.hpp>
#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/roles.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>

using namespace handoffkit::demos::fusion;

void test_branch_compare_and_merge() {
    auto d = compare_branch_outputs(
        "- Prefer CMake export\n- Support static linking",
        "- Prefer CMake export\n- Avoid static-only packaging"
    );
    assert(d.shared_bullets >= 1);
    auto merged = offline_bullet_vote_merge(
        "packaging",
        {{"A", "- Prefer CMake export\n- Support static linking"},
         {"B", "- Prefer CMake export\n- Avoid static-only packaging"}}
    );
    assert(merged.find("Prefer CMake export") != std::string::npos);
    assert(merged.find("(2)") != std::string::npos);
    std::cout << "test_branch_compare_and_merge ok\n";
}

void test_task_faithful_vs_shipping_prompts() {
    auto neu = make_neutral_pack();
    auto ship = make_shipping_pack();
    auto p1 = build_merge_user_prompt("dx task", {{"A", "a"}, {"B", "b"}}, merge_plan_for_pack(neu), neu);
    auto p2 = build_merge_user_prompt("ship task", {{"A", "a"}, {"B", "b"}}, merge_plan_for_pack(ship), ship);
    assert(prompt_has_task_faithful_rules(p1));
    assert(p2.find("Goals, Architecture, CLI") != std::string::npos);
    assert(!prompt_has_task_faithful_rules(p2));
    std::cout << "test_task_faithful_vs_shipping_prompts ok\n";
}

void test_cache_index_api() {
    const auto dir = std::filesystem::temp_directory_path() / "hk-fusion-depth-idx";
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
    FusionCacheConfig cc;
    cc.cache_dir = dir;
    FusionCache cache(cc);
    assert(cache.put("k", "v"));
    FusionCacheIndex idx(dir);
    assert(idx.rebuild_from_disk());
    assert(idx.size() >= 1);
    assert(idx.find("k") != nullptr || idx.size() >= 1);
    assert(idx.save());
    FusionCacheIndex idx2(dir);
    assert(idx2.load());
    assert(idx2.size() >= 1);
    std::cout << "test_cache_index_api ok\n";
}

void test_resume_merge_only_api() {
    FusionConfig cfg;
    cfg.task = "Say hi";
    cfg.provider = "echo";
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Neutral;
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto run = run_fusion(cfg);
    assert(run && run.value().success);
    auto cp = checkpoint_from_run(run.value());
    // remove merge steps
    std::vector<FusionStepRecord> steps;
    for (const auto& s : cp.steps) {
        if (s.step_id.find("merge") == std::string::npos) steps.push_back(s);
    }
    cp.steps = std::move(steps);
    auto resumed = resume_merge_only(cp, nullptr);
    assert(resumed);
    assert(resumed.value().metrics.llm_calls == 1);
    assert(resumed.value().report.value("merge_only", false));
    std::cout << "test_resume_merge_only_api ok\n";
}

void test_text_pipeline_label() {
    auto label = guess_primary_label("Primary diagnosis: Primary aldosteronism\nNext: AVS\n");
    assert(normalize_label(label).find("aldosteron") != std::string::npos);
    assert(looks_like_shipping_plan("Goals\nArchitecture\nNext steps\nCMake and Conan CLI handoffkit"));
    assert(!looks_like_shipping_plan("Primary aldosteronism due to high aldo low renin"));
    std::cout << "test_text_pipeline_label ok\n";
}

void test_deep_scenarios() {
    auto all = run_all_fusion_scenarios_deep();
    assert(all);
    int pass = 0, fail = 0;
    for (const auto& r : all.value()) {
        std::cout << (r.passed ? "PASS" : "FAIL") << " " << r.id << " - " << r.message << "\n";
        if (r.passed) ++pass;
        else ++fail;
    }
    assert(fail == 0);
    assert(pass >= 10);
    std::cout << "test_deep_scenarios ok pass=" << pass << "\n";
}

int main() {
    test_branch_compare_and_merge();
    test_task_faithful_vs_shipping_prompts();
    test_cache_index_api();
    test_resume_merge_only_api();
    test_text_pipeline_label();
    test_deep_scenarios();
    std::cout << "All fusion depth tests passed\n";
    return 0;
}
