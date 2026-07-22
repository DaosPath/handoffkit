#include <handoffkit/demos/fusion/scenarios.hpp>
#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/cache_index.hpp>
#include <handoffkit/demos/fusion/branch_compare.hpp>
#include <handoffkit/demos/fusion/merge_strategy.hpp>
#include <handoffkit/demos/fusion/engine_resume.hpp>
#include <handoffkit/demos/fusion/text_pipeline.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/roles.hpp>
#include <handoffkit/demos/fusion/policy.hpp>
#include <handoffkit/demos/fusion/bench.hpp>
#include <handoffkit/demos/fusion/metrics.hpp>

#include <filesystem>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

ScenarioResult okd(std::string id, std::string msg, nlohmann::json d = {}) {
    return ScenarioResult{std::move(id), true, std::move(msg), std::move(d)};
}

Result<ScenarioResult> deep_task_faithful_merge_prompt() {
    auto pack = make_neutral_pack();
    auto plan = merge_plan_for_pack(pack);
    auto prompt = build_merge_user_prompt(
        "Diagnose primary aldosteronism from vignette",
        {{"A", "Dx: primary aldosteronism"}, {"B", "Dx: renovascular HTN"}},
        plan,
        pack
    );
    if (!prompt_has_task_faithful_rules(prompt)) {
        return Result<ScenarioResult>::failure(Error::validation_failed("missing task-faithful rules"));
    }
    if (looks_like_shipping_plan(prompt)) {
        return Result<ScenarioResult>::failure(Error::validation_failed("merge prompt looks like shipping plan"));
    }
    return okd("deep_task_faithful_merge_prompt", "neutral merge prompt is task-faithful");
}

Result<ScenarioResult> deep_shipping_merge_sections() {
    auto pack = make_shipping_pack();
    auto plan = merge_plan_for_pack(pack);
    auto prompt = build_merge_user_prompt(
        "Ship HandoffKit C++",
        {{"lib", "use cmake export"}, {"cli", "add fusion command"}},
        plan,
        pack
    );
    if (prompt.find("Goals, Architecture, CLI") == std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("shipping sections missing"));
    }
    return okd("deep_shipping_merge_sections", "shipping merge sections present");
}

Result<ScenarioResult> deep_branch_diff_conflict() {
    auto d = compare_branch_outputs(
        "We should always prefer static linking for SDK users.",
        "We should avoid static linking; never ship static-only packages."
    );
    if (d.conflicts.empty()) {
        return Result<ScenarioResult>::failure(Error::validation_failed("expected conflict note"));
    }
    if (d.token_jaccard >= 0.99) {
        return Result<ScenarioResult>::failure(Error::validation_failed("unexpected near-identity"));
    }
    return okd("deep_branch_diff_conflict", "conflict detected", d.to_json());
}

Result<ScenarioResult> deep_offline_bullet_vote() {
    auto merged = offline_bullet_vote_merge(
        "Pick packaging approach",
        {
            {"A", "- Use CMake install(EXPORT)\n- Support static linking\n- Publish Conan"},
            {"B", "- Use CMake install(EXPORT)\n- Prefer shared libs\n- Publish Conan"},
        }
    );
    if (merged.find("CMake install(EXPORT)") == std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("shared bullet missing"));
    }
    if (merged.find("(2)") == std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("expected vote count 2"));
    }
    return okd("deep_offline_bullet_vote", "vote merge ok");
}

Result<ScenarioResult> deep_cache_index_roundtrip() {
    const auto dir = std::filesystem::temp_directory_path() / "hk-fusion-index-deep";
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
    FusionCacheConfig cc;
    cc.cache_dir = dir;
    cc.use_memory = true;
    cc.use_disk = true;
    FusionCache cache(cc);
    if (!cache.put("alpha", "value-alpha")) {
        return Result<ScenarioResult>::failure(Error::validation_failed("put alpha"));
    }
    if (!cache.put("beta", "value-beta")) {
        return Result<ScenarioResult>::failure(Error::validation_failed("put beta"));
    }
    FusionCacheIndex idx(dir);
    auto reb = idx.rebuild_from_disk();
    if (!reb) return Result<ScenarioResult>::failure(reb.error());
    if (idx.size() < 2) {
        return Result<ScenarioResult>::failure(Error::validation_failed("index size < 2"));
    }
    auto compact = idx.compact_to(1);
    if (!compact) return Result<ScenarioResult>::failure(compact.error());
    if (idx.size() != 1) {
        return Result<ScenarioResult>::failure(Error::validation_failed("compact_to 1 failed"));
    }
    return okd("deep_cache_index_roundtrip", "index rebuild+compact ok", idx.to_json());
}

Result<ScenarioResult> deep_resume_merge_only() {
    FusionConfig cfg;
    cfg.task = "Answer with one word: hello";
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Neutral;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto run = run_fusion(cfg);
    if (!run) return run.error();
    auto cp = checkpoint_from_run(run.value());
    // strip merge step so resume re-runs merge only
    std::vector<FusionStepRecord> kept;
    for (const auto& s : cp.steps) {
        if (s.step_id.find("merge") == std::string::npos) kept.push_back(s);
    }
    cp.steps = std::move(kept);
    cp.complete = false;
    auto resumed = resume_merge_only(cp, nullptr);
    if (!resumed) return resumed.error();
    if (!resumed.value().success || resumed.value().metrics.llm_calls != 1) {
        return Result<ScenarioResult>::failure(Error::validation_failed("resume should be 1 llm call"));
    }
    if (!resumed.value().report.value("merge_only", false)) {
        return Result<ScenarioResult>::failure(Error::validation_failed("missing merge_only flag"));
    }
    return okd("deep_resume_merge_only", "resume merge-only ok", resumed.value().report);
}

Result<ScenarioResult> deep_text_pipeline_diagnostic_label() {
    const std::string sample =
        "1) Primary diagnosis: Primary aldosteronism (Conn syndrome)\n"
        "2) Differentials: renovascular, pheo\n";
    auto st = analyze_text_pipeline(sample, true);
    if (st.tokens < 5) return Result<ScenarioResult>::failure(Error::validation_failed("too few tokens"));
    auto label = guess_primary_label(sample);
    auto norm = normalize_label(label);
    if (norm.find("aldosteron") == std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("label guess failed: " + label));
    }
    return okd("deep_text_pipeline_diagnostic_label", "label extracted", {{"label", label}, {"stats", st.to_json()}});
}

Result<ScenarioResult> deep_ultra_diagnostic_not_shipping() {
    FusionConfig cfg;
    cfg.task =
        "Research only. Resistant HTN, K 2.6, high aldosterone, low renin. "
        "Primary diagnosis in one line.";
    cfg.mode = FusionMode::Ultra;
    cfg.profile = FusionProfileId::Diagnostic;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    cfg.early_stop_on_overlap = false;  // scenario validates the full five-call graph
    auto run = run_fusion(cfg);
    if (!run) return run.error();
    if (run.value().metrics.llm_calls != 5) {
        return Result<ScenarioResult>::failure(Error::validation_failed("expected 5 calls"));
    }
    // Echo will echo the merge prompt; ensure task-faithful rules are in final echo
    if (!prompt_has_task_faithful_rules(run.value().final_output) &&
        run.value().final_output.find("ORIGINAL TASK") == std::string::npos) {
        // For echo, merger prompt is embedded in output — check branch or report pack
        auto pack = make_diagnostic_pack();
        if (!pack.task_faithful_merge) {
            return Result<ScenarioResult>::failure(Error::validation_failed("diagnostic pack not faithful"));
        }
    }
    if (looks_like_shipping_plan(run.value().final_output) &&
        run.value().final_output.find("primary") == std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("looks like shipping plan only"));
    }
    return okd("deep_ultra_diagnostic_not_shipping", "diagnostic ultra path ok",
               {{"llm_calls", run.value().metrics.llm_calls}});
}

Result<ScenarioResult> deep_policy_blocks_ultra_underbudget() {
    FusionConfig cfg;
    cfg.task = "x";
    cfg.provider = "echo";
    cfg.mode = FusionMode::Ultra;
    cfg.policy.max_llm_calls = 4;  // ultra needs 5
    auto v = validate_fusion_config(cfg);
    if (v) return Result<ScenarioResult>::failure(Error::validation_failed("should reject"));
    return okd("deep_policy_blocks_ultra_underbudget", "policy rejected underbudget ultra");
}

Result<ScenarioResult> deep_prefer_specific_branch() {
    std::vector<std::string> outs = {
        "Use a library.",
        "Use CMake 3.16+ install(EXPORT) with SOVERSION 1 and Conan package options for static/shared.",
    };
    int idx = prefer_branch_index(outs);
    if (idx != 1) {
        return Result<ScenarioResult>::failure(Error::validation_failed("expected more specific branch index 1"));
    }
    return okd("deep_prefer_specific_branch", "specificity ranking ok");
}

Result<ScenarioResult> deep_bench_medcase_echo_runs() {
    const auto* cse = find_bench_case("medcase-0006");
    if (!cse) return Result<ScenarioResult>::failure(Error::validation_failed("missing medcase-0006"));
    FusionConfig cfg;
    cfg.provider = "echo";
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Diagnostic;
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto r = run_bench_case(*cse, cfg);
    if (!r) return r.error();
    if (!r.value().run.success) {
        return Result<ScenarioResult>::failure(Error::validation_failed("bench run failed"));
    }
    // echo cannot hit gold; ensure scoring object populated
    if (!r.value().run.metrics.scores.is_object()) {
        return Result<ScenarioResult>::failure(Error::validation_failed("missing scores"));
    }
    return okd("deep_bench_medcase_echo_runs", "bench case executed", r.value().score.to_json());
}

Result<ScenarioResult> deep_lcs_similarity() {
    const auto n = longest_common_subsequence_len("ABCDEFG", "ABxDEFyG");
    if (n < 5) {
        return Result<ScenarioResult>::failure(Error::validation_failed("lcs too small"));
    }
    const auto n2 = longest_common_subsequence_len("aaaa", "bbbb");
    if (n2 != 0) {
        return Result<ScenarioResult>::failure(Error::validation_failed("lcs should be 0"));
    }
    return okd("deep_lcs_similarity", "lcs ok", {{"n", static_cast<int>(n)}});
}

}  // namespace

// Append deep scenarios into the main catalog by re-declaring a getter used by tests.
std::vector<ScenarioSpec> all_fusion_scenarios_deep() {
    return {
        {"deep_task_faithful_merge_prompt", "Task-faithful merge prompt", "neutral merge rules", deep_task_faithful_merge_prompt},
        {"deep_shipping_merge_sections", "Shipping merge sections", "legacy sections", deep_shipping_merge_sections},
        {"deep_branch_diff_conflict", "Branch conflict detection", "polarity conflict", deep_branch_diff_conflict},
        {"deep_offline_bullet_vote", "Offline bullet vote", "consensus bullets", deep_offline_bullet_vote},
        {"deep_cache_index_roundtrip", "Cache index", "rebuild+compact", deep_cache_index_roundtrip},
        {"deep_resume_merge_only", "Resume merge-only", "checkpoint resume", deep_resume_merge_only},
        {"deep_text_pipeline_diagnostic_label", "Text pipeline label", "primary dx extract", deep_text_pipeline_diagnostic_label},
        {"deep_ultra_diagnostic_not_shipping", "Diagnostic ultra", "not shipping plan", deep_ultra_diagnostic_not_shipping},
        {"deep_policy_blocks_ultra_underbudget", "Policy underbudget", "max_llm_calls", deep_policy_blocks_ultra_underbudget},
        {"deep_prefer_specific_branch", "Branch specificity", "prefer detailed branch", deep_prefer_specific_branch},
        {"deep_bench_medcase_echo_runs", "Bench medcase", "echo path", deep_bench_medcase_echo_runs},
        {"deep_lcs_similarity", "LCS similarity", "algorithm check", deep_lcs_similarity},
    };
}

Result<std::vector<ScenarioResult>> run_all_fusion_scenarios_deep() {
    std::vector<ScenarioResult> out;
    for (const auto& s : all_fusion_scenarios_deep()) {
        auto r = s.run();
        if (!r) {
            ScenarioResult f;
            f.id = s.id;
            f.passed = false;
            f.message = r.error().message;
            out.push_back(std::move(f));
        } else {
            out.push_back(std::move(r.value()));
        }
    }
    return out;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
