#include <handoffkit/demos/fusion/fusion_style.hpp>
#include <handoffkit/demos/fusion/persist.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/runtime/team.hpp>

#include <fstream>

namespace handoffkit {
namespace demos {
namespace {

Result<fusion::FusionConfig> config_from_demo_options(const DemoOptions& options) {
    fusion::FusionConfig cfg;
    const std::string default_task =
        "Design how to ship HandoffKit C++ to production: packaging, CLI, and multi-agent handoffs. "
        "Give concrete steps and risks in under 12 bullets.";
    cfg.task = default_task;
    if (options.extra.contains("config_file") && options.extra["config_file"].is_string()) {
        const auto path = options.extra["config_file"].get<std::string>();
        std::ifstream in(path);
        if (!in) return Error::parse_error("cannot open fusion config: " + path, path);
        nlohmann::json j;
        try {
            in >> j;
        } catch (const std::exception& e) {
            return Error::parse_error(std::string("invalid fusion config JSON: ") + e.what(), path);
        }
        if (!j.contains("task") || !j["task"].is_string() || j["task"].get<std::string>().empty()) {
            j["task"] = default_task;
        }
        auto parsed = fusion::FusionConfig::from_json(j);
        if (!parsed) return parsed.error();
        cfg = std::move(parsed.value());
    }
    if (options.extra.contains("prompt") && options.extra["prompt"].is_string() &&
        !options.extra["prompt"].get<std::string>().empty()) {
        cfg.task = options.extra["prompt"].get<std::string>();
    }
    const bool ultra = options.extra.value("ultra", false);
    if (options.extra.contains("mode") && options.extra["mode"].is_string()) {
        const auto mode = options.extra["mode"].get<std::string>();
        if (auto m = fusion::fusion_mode_from_string(mode)) cfg.mode = m.value();
    } else if (!options.extra.contains("config_file") && ultra) {
        cfg.mode = fusion::FusionMode::Ultra;
    }

    if (options.extra.contains("profile") && options.extra["profile"].is_string()) {
        const auto profile = options.extra["profile"].get<std::string>();
        if (auto p = fusion::fusion_profile_from_string(profile)) cfg.profile = p.value();
    }

    if (options.extra.contains("provider") && options.extra["provider"].is_string() &&
        !options.extra["provider"].get<std::string>().empty()) {
        cfg.provider = options.extra["provider"].get<std::string>();
    }
    if (options.extra.contains("model") && options.extra["model"].is_string()) {
        cfg.model = options.extra["model"].get<std::string>();
    }
    const bool loaded_config = options.extra.contains("config_file");
    const bool output_dir_explicit = options.extra.value("output_dir_explicit", false);
    const bool no_write_explicit = options.extra.value("no_write_explicit", false);
    if (!loaded_config || output_dir_explicit) cfg.output_dir = options.output_dir;
    if (!loaded_config || no_write_explicit) cfg.write_files = options.write_files;
    if (options.extra.contains("cache_dir") && options.extra["cache_dir"].is_string()) {
        cfg.cache.cache_dir = options.extra["cache_dir"].get<std::string>();
    } else if (!loaded_config || output_dir_explicit) {
        cfg.cache.cache_dir = options.output_dir / "fusion-cache";
    }
    if (options.extra.contains("no_cache") && options.extra["no_cache"].get<bool>()) {
        cfg.cache.enabled = false;
    }
    // Product tier (lite/medium/pro/ultra/genius) sets mode + branches + budget.
    // Applied after raw mode so tier is the product selector when present.
    if (options.extra.contains("tier") && options.extra["tier"].is_string()) {
        if (auto t = fusion::fusion_tier_from_string(options.extra["tier"].get<std::string>())) {
            fusion::apply_fusion_tier(cfg, t.value());
        }
    }
    if (options.extra.contains("branch_count") && options.extra["branch_count"].is_number_integer()) {
        cfg.branch_count = options.extra["branch_count"].get<int>();
        if (cfg.branch_count < 2) cfg.branch_count = 2;
        if (cfg.branch_count > 8) cfg.branch_count = 8;
    }
    // Optional native web explorer → Markdown context (opt-in via enable_web_tools).
    if (options.extra.contains("enable_web_tools")) {
        if (options.extra["enable_web_tools"].is_boolean()) {
            cfg.enable_web_tools = options.extra["enable_web_tools"].get<bool>();
        } else if (options.extra["enable_web_tools"].is_number_integer()) {
            cfg.enable_web_tools = options.extra["enable_web_tools"].get<int>() != 0;
        }
    }
    if (options.extra.contains("web") && options.extra["web"].is_boolean()) {
        cfg.enable_web_tools = options.extra["web"].get<bool>();
    }
    if (options.extra.contains("web_transport") && options.extra["web_transport"].is_string()) {
        cfg.web_transport = options.extra["web_transport"].get<std::string>();
    }
    if (options.extra.contains("seed_url") && options.extra["seed_url"].is_string()) {
        cfg.seed_urls.push_back(options.extra["seed_url"].get<std::string>());
    }
    if (options.extra.contains("seed_urls") && options.extra["seed_urls"].is_array()) {
        for (const auto& u : options.extra["seed_urls"]) {
            if (u.is_string()) cfg.seed_urls.push_back(u.get<std::string>());
        }
    }
    if (options.extra.contains("web_auto_search") && options.extra["web_auto_search"].is_boolean()) {
        cfg.web_auto_search = options.extra["web_auto_search"].get<bool>();
    }
    if (options.extra.contains("web_search_query") && options.extra["web_search_query"].is_string()) {
        cfg.web_search_query = options.extra["web_search_query"].get<std::string>();
    }
    if (options.extra.contains("web_max_pages") && options.extra["web_max_pages"].is_number_integer()) {
        cfg.web_max_pages = options.extra["web_max_pages"].get<int>();
    }
    if (options.extra.contains("web_max_depth") && options.extra["web_max_depth"].is_number_integer()) {
        cfg.web_max_depth = options.extra["web_max_depth"].get<int>();
    }
    // Multi-model panel (mode=panel)
    if (options.extra.contains("panel_models") && options.extra["panel_models"].is_array()) {
        for (const auto& m : options.extra["panel_models"]) {
            if (m.is_string()) cfg.panel_models.push_back(m.get<std::string>());
        }
    }
    if (options.extra.contains("models") && options.extra["models"].is_string()) {
        // comma-separated "m1,m2,m3,m4"
        std::string csv = options.extra["models"].get<std::string>();
        std::string cur;
        for (char c : csv) {
            if (c == ',' || c == ' ') {
                if (!cur.empty()) {
                    cfg.panel_models.push_back(cur);
                    cur.clear();
                }
            } else {
                cur.push_back(c);
            }
        }
        if (!cur.empty()) cfg.panel_models.push_back(cur);
    }
    if (options.extra.contains("model_a") && options.extra["model_a"].is_string()) {
        cfg.model_a = options.extra["model_a"].get<std::string>();
    }
    if (options.extra.contains("model_b") && options.extra["model_b"].is_string()) {
        cfg.model_b = options.extra["model_b"].get<std::string>();
    }
    if (options.extra.contains("model_merge") && options.extra["model_merge"].is_string()) {
        cfg.model_merge = options.extra["model_merge"].get<std::string>();
    }
    if (options.extra.contains("attach_panel_judge") && options.extra["attach_panel_judge"].is_boolean()) {
        cfg.attach_panel_judge = options.extra["attach_panel_judge"].get<bool>();
    }
    if (options.extra.contains("no_panel_judge") && options.extra["no_panel_judge"].get<bool>()) {
        cfg.attach_panel_judge = false;
    }
    if (options.extra.contains("enable_meta_judge") && options.extra["enable_meta_judge"].is_boolean()) {
        cfg.enable_meta_judge = options.extra["enable_meta_judge"].get<bool>();
    }
    if (options.extra.contains("meta_judge") && options.extra["meta_judge"].get<bool>()) {
        cfg.enable_meta_judge = true;
    }
    if (options.extra.contains("no_early_stop") && options.extra["no_early_stop"].get<bool>()) {
        cfg.early_stop_on_overlap = false;
    }
    if (options.extra.contains("no_anti_dilution") && options.extra["no_anti_dilution"].get<bool>()) {
        cfg.anti_dilution = false;
    }
    if (options.extra.contains("no_meta_judge") && options.extra["no_meta_judge"].get<bool>()) {
        cfg.enable_meta_judge = false;
    }
    if (options.extra.contains("parallel_branches") && options.extra["parallel_branches"].is_boolean()) {
        cfg.parallel_branches = options.extra["parallel_branches"].get<bool>();
    }
    if (options.extra.contains("max_parallel_branches") && options.extra["max_parallel_branches"].is_number_integer()) {
        cfg.max_parallel_branches = std::max(1, std::min(options.extra["max_parallel_branches"].get<int>(), 8));
    }
    if (options.extra.contains("overlap_threshold") && options.extra["overlap_threshold"].is_number()) {
        cfg.overlap_skip_skeptic_threshold = options.extra["overlap_threshold"].get<double>();
    }
    if (options.extra.contains("max_llm_calls") && options.extra["max_llm_calls"].is_number_integer()) {
        cfg.policy.max_llm_calls = options.extra["max_llm_calls"].get<int>();
    }
    auto generation_int = [&](const char* key, int& target) {
        if (options.extra.contains(key) && options.extra[key].is_number_integer()) {
            target = options.extra[key].get<int>();
        }
    };
    generation_int("branch_max_tokens", cfg.generation.branch_max_tokens);
    generation_int("skeptic_max_tokens", cfg.generation.skeptic_max_tokens);
    generation_int("merge_max_tokens", cfg.generation.merge_max_tokens);
    generation_int("meta_judge_max_tokens", cfg.generation.meta_judge_max_tokens);
    if (options.extra.contains("generation_temperature") && options.extra["generation_temperature"].is_number()) {
        cfg.generation.temperature = options.extra["generation_temperature"].get<double>();
    }
    if (options.extra.contains("generation_top_p") && options.extra["generation_top_p"].is_number()) {
        cfg.generation.top_p = options.extra["generation_top_p"].get<double>();
    }
    if (options.extra.contains("thinking") && options.extra["thinking"].is_string()) {
        const auto value = options.extra["thinking"].get<std::string>();
        if (value == "enabled" || value == "disabled") {
            cfg.generation.extra_body["thinking"] = {{"type", value}};
        }
    }
    if (options.extra.contains("reasoning_effort") && options.extra["reasoning_effort"].is_string()) {
        cfg.generation.extra_body["reasoning_effort"] = options.extra["reasoning_effort"];
    }
    if (options.extra.contains("role_pack_file") && options.extra["role_pack_file"].is_string()) {
        cfg.role_pack_file = options.extra["role_pack_file"].get<std::string>();
    }
    if (options.extra.contains("prompt_config_file") && options.extra["prompt_config_file"].is_string()) {
        const auto path = options.extra["prompt_config_file"].get<std::string>();
        std::ifstream in(path);
        if (!in) return Error::parse_error("cannot open fusion prompt config: " + path, path);
        nlohmann::json j;
        try {
            in >> j;
        } catch (const std::exception& e) {
            return Error::parse_error(std::string("invalid prompt config JSON: ") + e.what(), path);
        }
        auto parsed = fusion::FusionPromptConfig::from_json(j);
        if (!parsed) return parsed.error();
        cfg.prompts = std::move(parsed.value());
    }
    // Any explicitly supplied CLI mode wins over the tier-derived mode.
    if (options.extra.contains("mode") && options.extra["mode"].is_string()) {
        const std::string m = options.extra["mode"].get<std::string>();
        if (auto parsed = fusion::fusion_mode_from_string(m)) cfg.mode = parsed.value();
    }
    cfg.extra = options.extra;
    return Result<fusion::FusionConfig>::success(std::move(cfg));
}

}  // namespace

DemoResult demo_result_from_fusion(const fusion::FusionRunResult& run, std::string name, std::string title) {
    DemoResult result;
    result.name = std::move(name);
    result.title = std::move(title);
    result.task = run.config.task;
    result.final_output = run.final_output;
    result.success = run.success;
    result.handoffs = run.handoffs;
    result.artifact_paths = run.artifact_paths;
    result.report = run.report;
    result.report["final_output"] = run.final_output;
    result.report["task"] = run.config.task;
    result.report["error"] = run.error;
    result.summary_markdown =
        std::string("Fusion ") + fusion::fusion_mode_to_string(run.config.mode) +
        " profile=" + fusion::fusion_profile_to_string(run.config.profile) +
        " llm_calls=" + std::to_string(run.metrics.llm_calls) +
        " cache_hit_rate=" + std::to_string(run.metrics.cache.hit_rate());

    TeamRunResult fake;
    fake.task = run.config.task;
    fake.final_output = run.final_output;
    fake.success = run.success;
    fake.handoffs = run.handoffs;
    for (const auto& b : run.branches) {
        fake.agent_outputs.push_back({b.label, b.architect_output});
        if (!b.skeptic_output.empty()) {
            fake.agent_outputs.push_back({b.label + "_skeptic", b.skeptic_output});
        }
    }
    fake.agent_outputs.push_back({"Merger", run.merge_output});
    result.trace = build_run_trace(run.run_id, result.name, fake, "hybrid_min");
    return result;
}

Result<DemoResult> run_fusion_style_router_demo(const DemoOptions& options) {
    auto cfg_result = config_from_demo_options(options);
    if (!cfg_result) return cfg_result.error();
    auto cfg = std::move(cfg_result.value());
    auto run = fusion::run_fusion(cfg);
    if (!run) return run.error();

    const bool ultra = cfg.mode == fusion::FusionMode::Ultra;
    DemoResult result = demo_result_from_fusion(
        run.value(),
        ultra ? "fusion_style_ultra" : "fusion_style_router",
        ultra ? "Fusion-style ULTRA via FusionEngine" : "Fusion-style dual branch via FusionEngine"
    );

    // Populate branch report keys expected by CLI pretty-printer.
    if (run.value().branches.size() >= 2) {
        result.report["branch_a"] = {
            {"agent", run.value().branches[0].label},
            {"output", run.value().branches[0].architect_output},
            {"skeptic", run.value().branches[0].skeptic_output},
        };
        result.report["branch_b"] = {
            {"agent", run.value().branches[1].label},
            {"output", run.value().branches[1].architect_output},
            {"skeptic", run.value().branches[1].skeptic_output},
        };
    }
    result.report["merger"] = {{"agent", "Merger"}, {"output", run.value().merge_output}};
    result.report["llm_calls"] = run.value().metrics.llm_calls;
    result.report["planned_llm_calls"] = fusion::planned_llm_calls_for_config(cfg);
    result.report["provider"] = cfg.provider;
    result.report["model"] = cfg.model;
    result.report["ultra"] = ultra;
    result.report["style"] = ultra ? "fusion_ultra_dual_branch_skeptic_merge" : "fusion_dual_branch_merge";
    result.report["profile"] = fusion::fusion_profile_to_string(cfg.profile);
    result.report["tier"] = fusion::fusion_tier_to_string(cfg.tier);
    result.report["tier_display"] = fusion::fusion_tier_spec(cfg.tier).display_name;
    result.report["branch_count"] = cfg.branch_count;
    result.report["mode"] = fusion::fusion_mode_to_string(cfg.mode);
    result.report["cache"] = run.value().metrics.cache.to_json();
    if (run.value().report.contains("web_research")) {
        result.report["web_research"] = run.value().report["web_research"];
    }
    if (run.value().report.contains("web_tools_live")) {
        result.report["web_tools_live"] = run.value().report["web_tools_live"];
    }

    if (options.write_files) {
        // also write classic demo artifacts name
        auto arts = write_demo_artifacts(options, result);
        if (!arts) return arts.error();
    }
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_fusion_cache_lab_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "fusion_cache_lab";
    result.title = "Fusion cache memory+disk lab";
    result.task = "Exercise fusion cache put/get/evict/disk round-trip";

    fusion::FusionCacheConfig cc;
    cc.cache_dir = options.output_dir / "fusion-cache-lab";
    cc.max_memory_entries = 8;
    cc.max_memory_bytes = 4096;
    cc.ttl_seconds = 3600;
    fusion::FusionCache cache(cc);

    const std::string key = "lab-key-1";
    auto p1 = cache.put(key, "hello-fusion-cache", {{"tag", "lab"}});
    if (!p1) return p1.error();
    auto g1 = cache.get(key);
    if (!g1 || g1.value() != "hello-fusion-cache") {
        return Error::validation_failed("cache get mismatch after put");
    }
    // second get should hit memory
    auto g2 = cache.get(key);
    if (!g2) return Error::validation_failed("cache second get miss");

    // fill to force eviction
    for (int i = 0; i < 20; ++i) {
        (void)cache.put("k" + std::to_string(i), std::string(200, 'x'));
    }
    const auto st = cache.stats();
    result.report = {
        {"task", result.task},
        {"stats", st.to_json()},
        {"stats_text", fusion::format_cache_stats_text(st)},
    };
    result.final_output = fusion::format_cache_stats_markdown(st);
    result.success = fusion::cache_stats_healthy(st) && st.puts >= 1 && st.hits >= 1;
    result.summary_markdown = "Fusion cache lab complete";
    auto arts = write_demo_artifacts(options, result);
    if (!arts) return arts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_fusion_neutral_ultra_demo(const DemoOptions& options) {
    DemoOptions o = options;
    o.extra["ultra"] = true;
    o.extra["profile"] = "neutral";
    if (!o.extra.contains("provider")) o.extra["provider"] = "echo";
    if (!o.extra.contains("prompt")) {
        o.extra["prompt"] =
            "A 48-year-old man has resistant hypertension, K 2.6, high aldosterone, suppressed renin. "
            "Give primary diagnosis, 3 differentials, key findings, next 3 tests, confidence 0-100.";
    }
    auto r = run_fusion_style_router_demo(o);
    if (!r) return r;
    r.value().name = "fusion_neutral_ultra";
    r.value().title = "Fusion neutral ULTRA (task-faithful)";
    return r;
}

}  // namespace demos
}  // namespace handoffkit
