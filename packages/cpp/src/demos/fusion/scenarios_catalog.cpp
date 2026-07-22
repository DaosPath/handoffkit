#include <handoffkit/demos/fusion/scenarios.hpp>
#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/roles.hpp>
#include <handoffkit/demos/fusion/bench.hpp>
#include <handoffkit/demos/fusion/policy.hpp>

#include <filesystem>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

std::filesystem::path scenario_tmp(const char* name) {
    return std::filesystem::temp_directory_path() / "hk-fusion-scen" / name;
}

ScenarioResult ok_sc(std::string id, std::string msg, nlohmann::json details = {}) {
    return ScenarioResult{std::move(id), true, std::move(msg), std::move(details)};
}

Result<ScenarioResult> scen_lean_neutral() {
    FusionConfig cfg;
    cfg.task = "Name two risks of multi-agent handoffs.";
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Neutral;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto r = run_fusion(cfg);
    if (!r) return r.error();
    if (!r.value().success || r.value().metrics.llm_calls != 3) {
        return Result<ScenarioResult>::failure(Error::validation_failed(
            "lean_neutral failed calls=" + std::to_string(r.value().metrics.llm_calls)
        ));
    }
    return ok_sc("lean_neutral", "lean neutral 3 calls", r.value().report);
}

Result<ScenarioResult> scen_ultra_diagnostic() {
    FusionConfig cfg;
    cfg.task = "Primary dx: high aldosterone low renin hypokalemia resistant HTN.";
    cfg.mode = FusionMode::Ultra;
    cfg.profile = FusionProfileId::Diagnostic;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    cfg.early_stop_on_overlap = false;  // scenario validates the full five-call graph
    auto r = run_fusion(cfg);
    if (!r) return r.error();
    if (r.value().metrics.llm_calls != 5) {
        return Result<ScenarioResult>::failure(Error::validation_failed("expected 5 ultra calls"));
    }
    return ok_sc("ultra_diagnostic", "ultra diagnostic 5 calls", {{"llm_calls", 5}});
}

Result<ScenarioResult> scen_shipping_merge_flag() {
    auto pack = make_shipping_pack();
    if (pack.task_faithful_merge) {
        return Result<ScenarioResult>::failure(Error::validation_failed("shipping should not be task_faithful"));
    }
    if (!pack.shipping_merge_sections) {
        return Result<ScenarioResult>::failure(Error::validation_failed("shipping needs merge sections"));
    }
    return ok_sc("shipping_flags", "shipping pack flags ok");
}

Result<ScenarioResult> scen_neutral_merge_flag() {
    auto pack = make_neutral_pack();
    if (!pack.task_faithful_merge) {
        return Result<ScenarioResult>::failure(Error::validation_failed("neutral must be task_faithful"));
    }
    return ok_sc("neutral_flags", "neutral pack flags ok");
}

Result<ScenarioResult> scen_cache_roundtrip() {
    FusionCacheConfig cc;
    cc.cache_dir = scenario_tmp("cache");
    cc.use_disk = true;
    std::filesystem::remove_all(cc.cache_dir);
    FusionCache cache(cc);
    if (!cache.put("s1", "payload-one")) {
        return Result<ScenarioResult>::failure(Error::validation_failed("put failed"));
    }
    auto g = cache.get("s1");
    if (!g || g.value() != "payload-one") {
        return Result<ScenarioResult>::failure(Error::validation_failed("get mismatch"));
    }
    FusionCache cache2(cc);
    auto g2 = cache2.get("s1");
    if (!g2 || g2.value() != "payload-one") {
        return Result<ScenarioResult>::failure(Error::validation_failed("disk get mismatch"));
    }
    return ok_sc("cache_roundtrip", "memory+disk ok", cache2.stats_json());
}

Result<ScenarioResult> scen_policy_tripwire() {
    FusionConfig cfg;
    cfg.task = "Anything";
    cfg.mode = FusionMode::Ultra;
    cfg.profile = FusionProfileId::Neutral;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    cfg.policy.max_llm_calls = 2;  // ultra needs 5
    auto v = validate_fusion_config(cfg);
    if (v) {
        return Result<ScenarioResult>::failure(Error::validation_failed("expected validate fail"));
    }
    return ok_sc("policy_tripwire", "max_llm_calls guards ultra", {{"error", v.error().message}});
}

Result<ScenarioResult> scen_sanitize_emdash() {
    const std::string raw = "A \xE2\x80\x94 B";  // em dash utf-8
    const auto s = sanitize_prompt_text(raw, true);
    if (s.find('-') == std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("emdash not mapped"));
    }
    return ok_sc("sanitize_emdash", "utf-8 dash sanitized", {{"out", s}});
}

Result<ScenarioResult> scen_dag_three() {
    FusionConfig cfg;
    cfg.task = "Compare three approaches to agent handoffs.";
    cfg.mode = FusionMode::Dag;
    cfg.profile = FusionProfileId::Coding;
    cfg.provider = "echo";
    cfg.branch_count = 3;
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto r = run_fusion(cfg);
    if (!r) return r.error();
    if (r.value().branches.size() != 3) {
        return Result<ScenarioResult>::failure(Error::validation_failed("expected 3 branches"));
    }
    // 3 architects + 1 merge
    if (r.value().metrics.llm_calls != 4) {
        return Result<ScenarioResult>::failure(Error::validation_failed("expected 4 dag calls"));
    }
    return ok_sc("dag_three", "dag 3 branches", {{"llm_calls", r.value().metrics.llm_calls}});
}

Result<ScenarioResult> scen_profiles_all_construct() {
    nlohmann::json names = nlohmann::json::array();
    for (const auto& n : fusion_profile_names()) {
        auto p = fusion_profile_from_string(n);
        if (!p) return Result<ScenarioResult>::failure(Error::validation_failed("bad profile " + n));
        auto pack = make_role_pack(p.value());
        if (pack.branches.size() < 2) {
            return Result<ScenarioResult>::failure(Error::validation_failed("pack incomplete " + n));
        }
        names.push_back(n);
    }
    return ok_sc("profiles_all", "all profiles construct", {{"profiles", names}});
}

Result<ScenarioResult> scen_bench_toy() {
    FusionConfig cfg;
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Neutral;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto r = run_bench_case(*find_bench_case("toy-cache-1"), cfg);
    if (!r) return r.error();
    return ok_sc("bench_toy", "toy bench ran", {{"gold_hit", r.value().gold_hit}});
}

Result<ScenarioResult> scen_prompt_template() {
    auto out = render_template("Hello {{name}}!", {{"name", "Fusion"}}, false);
    if (out != "Hello Fusion!") {
        return Result<ScenarioResult>::failure(Error::validation_failed("template fail: " + out));
    }
    return ok_sc("prompt_template", "template ok");
}

Result<ScenarioResult> scen_merge_frame_faithful() {
    auto m = frame_merge_task("Diagnose X", "A", "bodyA", "B", "bodyB", true, false, true);
    if (m.find("ORIGINAL TASK") == std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("missing ORIGINAL TASK"));
    }
    if (m.find("Goals, Architecture, CLI") != std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("shipping sections leaked"));
    }
    return ok_sc("merge_frame_faithful", "task-faithful merge frame ok");
}

Result<ScenarioResult> scen_merge_frame_shipping() {
    auto m = frame_merge_task("Ship kit", "A", "bodyA", "B", "bodyB", false, true, true);
    if (m.find("Goals, Architecture, CLI") == std::string::npos) {
        return Result<ScenarioResult>::failure(Error::validation_failed("missing shipping sections"));
    }
    return ok_sc("merge_frame_shipping", "shipping merge frame ok");
}

Result<ScenarioResult> scen_dialectic_lean() {
    FusionConfig cfg;
    cfg.task = "Should we prefer static or dynamic linking for a C++ SDK?";
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Dialectic;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto r = run_fusion(cfg);
    if (!r) return r.error();
    if (!r.value().success) return Result<ScenarioResult>::failure(Error::validation_failed("dialectic failed"));
    return ok_sc("dialectic_lean", "dialectic lean ok", {{"llm_calls", r.value().metrics.llm_calls}});
}

Result<ScenarioResult> scen_research_ultra() {
    FusionConfig cfg;
    cfg.task = "Evaluate evidence that dual-branch fusion improves answer quality.";
    cfg.mode = FusionMode::Ultra;
    cfg.profile = FusionProfileId::Research;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto r = run_fusion(cfg);
    if (!r) return r.error();
    if (r.value().metrics.llm_calls != 5) {
        return Result<ScenarioResult>::failure(Error::validation_failed("research ultra calls"));
    }
    return ok_sc("research_ultra", "research ultra ok");
}

}  // namespace

nlohmann::json ScenarioResult::to_json() const {
    return nlohmann::json{
        {"id", id},
        {"passed", passed},
        {"message", message},
        {"details", details.is_null() ? nlohmann::json::object() : details},
    };
}

std::vector<ScenarioSpec> all_fusion_scenarios() {
    return {
        {"lean_neutral", "Lean neutral", "3-call neutral fusion", scen_lean_neutral},
        {"ultra_diagnostic", "Ultra diagnostic", "5-call diagnostic", scen_ultra_diagnostic},
        {"shipping_flags", "Shipping flags", "legacy pack flags", scen_shipping_merge_flag},
        {"neutral_flags", "Neutral flags", "task-faithful pack", scen_neutral_merge_flag},
        {"cache_roundtrip", "Cache roundtrip", "memory+disk", scen_cache_roundtrip},
        {"policy_tripwire", "Policy tripwire", "max_llm_calls guard", scen_policy_tripwire},
        {"sanitize_emdash", "Sanitize emdash", "UTF-8 dash", scen_sanitize_emdash},
        {"dag_three", "DAG three branches", "3+merge", scen_dag_three},
        {"profiles_all", "All profiles", "construct packs", scen_profiles_all_construct},
        {"bench_toy", "Bench toy", "embedded case", scen_bench_toy},
        {"prompt_template", "Prompt template", "{{vars}}", scen_prompt_template},
        {"merge_frame_faithful", "Merge faithful", "no shipping sections", scen_merge_frame_faithful},
        {"merge_frame_shipping", "Merge shipping", "shipping sections", scen_merge_frame_shipping},
        {"dialectic_lean", "Dialectic lean", "thesis/antithesis", scen_dialectic_lean},
        {"research_ultra", "Research ultra", "evidence panel", scen_research_ultra},
    };
}

std::vector<std::string> fusion_scenario_ids() {
    std::vector<std::string> ids;
    for (const auto& s : all_fusion_scenarios()) ids.push_back(s.id);
    return ids;
}

Result<ScenarioResult> run_fusion_scenario(std::string_view id) {
    for (const auto& s : all_fusion_scenarios()) {
        if (s.id == id) return s.run();
    }
    return Error::invalid_argument("unknown scenario: " + std::string(id), "id");
}

Result<std::vector<ScenarioResult>> run_all_fusion_scenarios() {
    std::vector<ScenarioResult> out;
    for (const auto& s : all_fusion_scenarios()) {
        auto r = s.run();
        if (!r) {
            ScenarioResult fail;
            fail.id = s.id;
            fail.passed = false;
            fail.message = r.error().message;
            out.push_back(std::move(fail));
            continue;
        }
        out.push_back(std::move(r.value()));
    }
    return out;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
