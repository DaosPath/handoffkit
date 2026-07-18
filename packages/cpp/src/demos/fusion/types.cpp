#include <handoffkit/demos/fusion/types.hpp>

#include <algorithm>
#include <chrono>
#include <random>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

std::string lower_copy(std::string s) {
    for (char& c : s) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return s;
}

}  // namespace

std::string fusion_mode_to_string(FusionMode mode) {
    switch (mode) {
        case FusionMode::Lean: return "lean";
        case FusionMode::Ultra: return "ultra";
        case FusionMode::Dag: return "dag";
        case FusionMode::Panel: return "panel";
    }
    return "lean";
}

Result<FusionMode> fusion_mode_from_string(std::string_view s) {
    const auto v = lower_copy(std::string(s));
    if (v == "lean" || v == "3" || v == "dual") return FusionMode::Lean;
    if (v == "ultra" || v == "5") return FusionMode::Ultra;
    if (v == "dag" || v == "graph") return FusionMode::Dag;
    if (v == "panel" || v == "multi" || v == "models") return FusionMode::Panel;
    return Error::invalid_argument("unknown fusion mode: " + std::string(s), "mode");
}

std::string fusion_profile_to_string(FusionProfileId id) {
    switch (id) {
        case FusionProfileId::Shipping: return "shipping";
        case FusionProfileId::Neutral: return "neutral";
        case FusionProfileId::Dialectic: return "dialectic";
        case FusionProfileId::Diagnostic: return "diagnostic";
        case FusionProfileId::Coding: return "coding";
        case FusionProfileId::Research: return "research";
    }
    return "neutral";
}

Result<FusionProfileId> fusion_profile_from_string(std::string_view s) {
    const auto v = lower_copy(std::string(s));
    if (v == "shipping" || v == "ship" || v == "cpp_ship") return FusionProfileId::Shipping;
    if (v == "neutral" || v == "default" || v == "generic") return FusionProfileId::Neutral;
    if (v == "dialectic" || v == "debate") return FusionProfileId::Dialectic;
    if (v == "diagnostic" || v == "clinical" || v == "doctor") return FusionProfileId::Diagnostic;
    if (v == "coding" || v == "code") return FusionProfileId::Coding;
    if (v == "research" || v == "analysis") return FusionProfileId::Research;
    return Error::invalid_argument("unknown fusion profile: " + std::string(s), "profile");
}

std::vector<std::string> fusion_profile_names() {
    return {"shipping", "neutral", "dialectic", "diagnostic", "coding", "research"};
}

std::vector<std::string> fusion_mode_names() {
    return {"lean", "ultra", "dag", "panel"};
}

std::string fusion_tier_to_string(FusionTier tier) {
    switch (tier) {
        case FusionTier::Lite: return "lite";
        case FusionTier::Medium: return "medium";
        case FusionTier::Pro: return "pro";
        case FusionTier::Ultra: return "ultra";
        case FusionTier::Genius: return "genius";
    }
    return "medium";
}

Result<FusionTier> fusion_tier_from_string(std::string_view s) {
    const auto v = lower_copy(std::string(s));
    if (v == "lite" || v == "fusion_lite" || v == "fusion-lite" || v == "l") return FusionTier::Lite;
    if (v == "medium" || v == "fusion_medium" || v == "fusion-medium" || v == "med" || v == "m") {
        return FusionTier::Medium;
    }
    if (v == "pro" || v == "fusion_pro" || v == "fusion-pro" || v == "p") return FusionTier::Pro;
    if (v == "ultra" || v == "fusion_ultra" || v == "fusion-ultra" || v == "u") return FusionTier::Ultra;
    if (v == "genius" || v == "genio" || v == "fusion_genius" || v == "fusion-genius" || v == "g") {
        return FusionTier::Genius;
    }
    return Error::invalid_argument("unknown fusion tier: " + std::string(s), "tier");
}

std::vector<std::string> fusion_tier_names() {
    return {"lite", "medium", "pro", "ultra", "genius"};
}

std::string fusion_prompt_depth_to_string(FusionPromptDepth depth) {
    switch (depth) {
        case FusionPromptDepth::Compact: return "compact";
        case FusionPromptDepth::Standard: return "standard";
        case FusionPromptDepth::Deep: return "deep";
        case FusionPromptDepth::Research: return "research";
        case FusionPromptDepth::Exhaustive: return "exhaustive";
    }
    return "standard";
}

nlohmann::json FusionCapabilityPack::to_json() const {
    return nlohmann::json{
        {"pack_id", pack_id},
        {"description", description},
        {"depth", fusion_prompt_depth_to_string(depth)},
        {"skills", skills},
        {"tool_slots", tool_slots},
        {"evidence_min_points", evidence_min_points},
        {"max_branch_bullets", max_branch_bullets},
        {"max_skeptic_bullets", max_skeptic_bullets},
        {"handoff_summary_chars", handoff_summary_chars},
    };
}

FusionCapabilityPack fusion_capability_pack(FusionTier tier) {
    FusionCapabilityPack p;
    switch (tier) {
        case FusionTier::Lite:
            p.pack_id = "capability_lite";
            p.description = "Fast dual-path: answer-first outline + concise merge.";
            p.depth = FusionPromptDepth::Compact;
            p.skills = {"answer_first", "outline", "concise_merge"};
            p.tool_slots = {"structured_handoff", "direct_answer"};
            p.evidence_min_points = 2;
            p.max_branch_bullets = 10;
            p.max_skeptic_bullets = 4;
            p.handoff_summary_chars = 700;
            break;
        case FusionTier::Medium:
            p.pack_id = "capability_medium";
            p.description = "Balanced dual-path: structure + tradeoffs + explicit assumptions.";
            p.depth = FusionPromptDepth::Standard;
            p.skills = {
                "answer_first", "structure", "tradeoffs", "assumptions", "concise_merge"
            };
            p.tool_slots = {
                "structured_handoff", "context_refs", "direct_answer", "assumption_log"
            };
            p.evidence_min_points = 3;
            p.max_branch_bullets = 12;
            p.max_skeptic_bullets = 6;
            p.handoff_summary_chars = 1000;
            break;
        case FusionTier::Pro:
            p.pack_id = "capability_pro";
            p.description = "Dual-path + skeptic: evidence, gaps, calibrated merge.";
            p.depth = FusionPromptDepth::Deep;
            p.skills = {
                "answer_first", "structure", "tradeoffs", "evidence_check", "gap_analysis",
                "skeptic_review", "faithful_merge"
            };
            p.tool_slots = {
                "structured_handoff", "context_refs", "direct_answer",
                "critique_pass", "decision_log", "confidence_scale"
            };
            p.evidence_min_points = 4;
            p.max_branch_bullets = 14;
            p.max_skeptic_bullets = 8;
            p.handoff_summary_chars = 1300;
            break;
        case FusionTier::Ultra:
            p.pack_id = "capability_ultra";
            p.description = "Multi-angle DAG: breadth, counter-evidence, synthesis under uncertainty.";
            p.depth = FusionPromptDepth::Research;
            p.skills = {
                "answer_first", "multi_angle", "evidence_check", "counter_evidence",
                "source_hygiene", "breadth", "synthesis", "uncertainty"
            };
            p.tool_slots = {
                "structured_handoff", "context_refs", "direct_answer",
                "multi_branch_merge", "research_outline", "citation_slots", "confidence_scale"
            };
            p.evidence_min_points = 5;
            p.max_branch_bullets = 16;
            p.max_skeptic_bullets = 8;
            p.handoff_summary_chars = 1500;
            break;
        case FusionTier::Genius:
            p.pack_id = "capability_genius";
            p.description = "Wide DAG: adversarial coverage, residual risk, max task fidelity.";
            p.depth = FusionPromptDepth::Exhaustive;
            p.skills = {
                "answer_first", "multi_angle", "evidence_check", "counter_evidence",
                "source_hygiene", "breadth", "depth", "adversarial_think", "synthesis",
                "uncertainty", "residual_risks", "actionable_next"
            };
            p.tool_slots = {
                "structured_handoff", "context_refs", "direct_answer",
                "multi_branch_merge", "research_outline", "citation_slots",
                "risk_register", "decision_log", "confidence_scale"
            };
            p.evidence_min_points = 6;
            p.max_branch_bullets = 18;
            p.max_skeptic_bullets = 10;
            p.handoff_summary_chars = 2000;
            break;
    }
    return p;
}

nlohmann::json FusionTierSpec::to_json() const {
    return nlohmann::json{
        {"tier", id},
        {"display_name", display_name},
        {"description", description},
        {"mode", fusion_mode_to_string(mode)},
        {"branch_count", branch_count},
        {"planned_llm_calls", planned_llm_calls},
        {"max_llm_calls", max_llm_calls},
        {"capability", capability.to_json()},
    };
}

FusionTierSpec fusion_tier_spec(FusionTier tier) {
    FusionTierSpec s;
    s.tier = tier;
    s.id = fusion_tier_to_string(tier);
    s.capability = fusion_capability_pack(tier);
    switch (tier) {
        case FusionTier::Lite:
            s.display_name = "Fusion Lite";
            s.description = "Fast dual-branch + merge (3 LLM calls). Best for quick answers.";
            s.mode = FusionMode::Lean;
            s.branch_count = 2;
            s.planned_llm_calls = 3;
            s.max_llm_calls = 3;
            break;
        case FusionTier::Medium:
            s.display_name = "Fusion Medium";
            s.description = "Solid dual-branch + merge (3 LLM calls) with roomier call budget.";
            s.mode = FusionMode::Lean;
            s.branch_count = 2;
            s.planned_llm_calls = 3;
            s.max_llm_calls = 6;
            break;
        case FusionTier::Pro:
            s.display_name = "Fusion Pro";
            s.description = "Dual-branch + skeptic each + merge (5 LLM calls). Higher critique depth.";
            s.mode = FusionMode::Ultra;
            s.branch_count = 2;
            s.planned_llm_calls = 5;
            s.max_llm_calls = 5;
            break;
        case FusionTier::Ultra:
            s.display_name = "Fusion Ultra";
            s.description = "Multi-architect DAG: 4 approaches + merge (5 LLM calls).";
            s.mode = FusionMode::Dag;
            s.branch_count = 4;
            s.planned_llm_calls = 5;  // 4 architects + merge
            s.max_llm_calls = 6;
            break;
        case FusionTier::Genius:
            s.display_name = "Fusion Genius";
            s.description = "Wide multi-architect DAG: 6 approaches + merge (7 LLM calls). Max exploration.";
            s.mode = FusionMode::Dag;
            s.branch_count = 6;
            s.planned_llm_calls = 7;  // 6 architects + merge
            s.max_llm_calls = 8;
            break;
    }
    return s;
}

void apply_fusion_tier(FusionConfig& config, FusionTier tier) {
    const auto spec = fusion_tier_spec(tier);
    config.tier = tier;
    config.mode = spec.mode;
    config.branch_count = spec.branch_count;
    config.policy.max_llm_calls = spec.max_llm_calls;
    config.extra["tier"] = spec.id;
    config.extra["tier_display"] = spec.display_name;
    config.extra["planned_llm_calls"] = spec.planned_llm_calls;
    config.extra["capability"] = spec.capability.to_json();
}

int planned_llm_calls_for_config(const FusionConfig& config) {
    switch (config.mode) {
        case FusionMode::Lean:
            return 3;
        case FusionMode::Ultra:
            return 5;
        case FusionMode::Dag: {
            const int n = std::max(2, std::min(config.branch_count, 8));
            return n + 1;  // N architects + merge
        }
        case FusionMode::Panel: {
            int n = static_cast<int>(config.panel_models.size());
            if (n < 1) {
                // same resolve as panel.cpp without including it here
                n = 0;
                if (!config.model_a.empty()) ++n;
                if (!config.model_b.empty()) ++n;
                if (!config.model.empty()) ++n;
                if (!config.model_merge.empty()) ++n;
                if (n < 1) n = 4;
            }
            return std::max(2, std::min(n, 16));
        }
    }
    return 3;
}

nlohmann::json FusionPolicyConfig::to_json() const {
    return nlohmann::json{
        {"max_llm_calls", max_llm_calls},
        {"max_wall_ms", max_wall_ms},
        {"max_prompt_chars", max_prompt_chars},
        {"cooldown_ms", cooldown_ms},
        {"hard_fail_on_budget", hard_fail_on_budget},
        {"allow_disk_cache", allow_disk_cache},
        {"allow_memory_cache", allow_memory_cache},
    };
}

Result<FusionPolicyConfig> FusionPolicyConfig::from_json(const nlohmann::json& j) {
    if (!j.is_object()) return Error::parse_error("policy must be object", "policy");
    FusionPolicyConfig c;
    if (j.contains("max_llm_calls")) c.max_llm_calls = j.at("max_llm_calls").get<int>();
    if (j.contains("max_wall_ms")) c.max_wall_ms = j.at("max_wall_ms").get<int>();
    if (j.contains("max_prompt_chars")) c.max_prompt_chars = j.at("max_prompt_chars").get<int>();
    if (j.contains("cooldown_ms")) c.cooldown_ms = j.at("cooldown_ms").get<int>();
    if (j.contains("hard_fail_on_budget")) c.hard_fail_on_budget = j.at("hard_fail_on_budget").get<bool>();
    if (j.contains("allow_disk_cache")) c.allow_disk_cache = j.at("allow_disk_cache").get<bool>();
    if (j.contains("allow_memory_cache")) c.allow_memory_cache = j.at("allow_memory_cache").get<bool>();
    if (c.max_llm_calls < 1) return Error::invalid_argument("max_llm_calls must be >= 1", "max_llm_calls");
    if (c.max_prompt_chars < 256) return Error::invalid_argument("max_prompt_chars too small", "max_prompt_chars");
    return c;
}

nlohmann::json FusionCacheConfig::to_json() const {
    return nlohmann::json{
        {"enabled", enabled},
        {"cache_dir", cache_dir.string()},
        {"max_memory_entries", max_memory_entries},
        {"max_memory_bytes", max_memory_bytes},
        {"ttl_seconds", ttl_seconds},
        {"use_disk", use_disk},
        {"use_memory", use_memory},
    };
}

Result<FusionCacheConfig> FusionCacheConfig::from_json(const nlohmann::json& j) {
    if (!j.is_object()) return Error::parse_error("cache config must be object", "cache");
    FusionCacheConfig c;
    if (j.contains("enabled")) c.enabled = j.at("enabled").get<bool>();
    if (j.contains("cache_dir")) c.cache_dir = j.at("cache_dir").get<std::string>();
    if (j.contains("max_memory_entries")) c.max_memory_entries = j.at("max_memory_entries").get<std::size_t>();
    if (j.contains("max_memory_bytes")) c.max_memory_bytes = j.at("max_memory_bytes").get<std::size_t>();
    if (j.contains("ttl_seconds")) c.ttl_seconds = j.at("ttl_seconds").get<int>();
    if (j.contains("use_disk")) c.use_disk = j.at("use_disk").get<bool>();
    if (j.contains("use_memory")) c.use_memory = j.at("use_memory").get<bool>();
    return c;
}

nlohmann::json FusionConfig::to_json() const {
    return nlohmann::json{
        {"task", task},
        {"mode", fusion_mode_to_string(mode)},
        {"profile", fusion_profile_to_string(profile)},
        {"tier", fusion_tier_to_string(tier)},
        {"provider", provider},
        {"model", model},
        {"model_a", model_a},
        {"model_b", model_b},
        {"model_merge", model_merge},
        {"panel_models", panel_models},
        {"panel_roles", panel_roles},
        {"attach_panel_judge", attach_panel_judge},
        {"enable_meta_judge", enable_meta_judge},
        {"early_stop_on_overlap", early_stop_on_overlap},
        {"overlap_skip_skeptic_threshold", overlap_skip_skeptic_threshold},
        {"anti_dilution", anti_dilution},
        {"cache", cache.to_json()},
        {"policy", policy.to_json()},
        {"output_dir", output_dir.string()},
        {"write_files", write_files},
        {"ascii_sanitize", ascii_sanitize},
        {"branch_count", branch_count},
        {"enable_web_tools", enable_web_tools},
        {"web_transport", web_transport},
        {"seed_urls", seed_urls},
        {"web_auto_search", web_auto_search},
        {"web_search_query", web_search_query},
        {"web_max_pages", web_max_pages},
        {"web_max_depth", web_max_depth},
        {"web_context_max_chars", web_context_max_chars},
        {"web_timeout_ms", web_timeout_ms},
        {"web_prefer_explore", web_prefer_explore},
        {"extra", extra.is_null() ? nlohmann::json::object() : extra},
    };
}

Result<FusionConfig> FusionConfig::from_json(const nlohmann::json& j) {
    if (!j.is_object()) return Error::parse_error("fusion config must be object", "config");
    FusionConfig c;
    if (j.contains("task")) c.task = j.at("task").get<std::string>();
    // Tier first (sets mode/branch_count/budget); explicit mode/branch_count may override after.
    if (j.contains("tier")) {
        auto t = fusion_tier_from_string(j.at("tier").get<std::string>());
        if (!t) return t.error();
        apply_fusion_tier(c, t.value());
    }
    if (j.contains("mode")) {
        auto m = fusion_mode_from_string(j.at("mode").get<std::string>());
        if (!m) return m.error();
        c.mode = m.value();
    }
    if (j.contains("profile")) {
        auto p = fusion_profile_from_string(j.at("profile").get<std::string>());
        if (!p) return p.error();
        c.profile = p.value();
    }
    if (j.contains("provider")) c.provider = j.at("provider").get<std::string>();
    if (j.contains("model")) c.model = j.at("model").get<std::string>();
    if (j.contains("model_a")) c.model_a = j.at("model_a").get<std::string>();
    if (j.contains("model_b")) c.model_b = j.at("model_b").get<std::string>();
    if (j.contains("model_merge")) c.model_merge = j.at("model_merge").get<std::string>();
    if (j.contains("panel_models") && j.at("panel_models").is_array()) {
        for (const auto& m : j.at("panel_models")) {
            if (m.is_string()) c.panel_models.push_back(m.get<std::string>());
        }
    }
    if (j.contains("panel_roles") && j.at("panel_roles").is_array()) {
        for (const auto& m : j.at("panel_roles")) {
            if (m.is_string()) c.panel_roles.push_back(m.get<std::string>());
        }
    }
    if (j.contains("attach_panel_judge")) c.attach_panel_judge = j.at("attach_panel_judge").get<bool>();
    if (j.contains("enable_meta_judge")) c.enable_meta_judge = j.at("enable_meta_judge").get<bool>();
    if (j.contains("early_stop_on_overlap")) c.early_stop_on_overlap = j.at("early_stop_on_overlap").get<bool>();
    if (j.contains("overlap_skip_skeptic_threshold")) {
        c.overlap_skip_skeptic_threshold = j.at("overlap_skip_skeptic_threshold").get<double>();
    }
    if (j.contains("anti_dilution")) c.anti_dilution = j.at("anti_dilution").get<bool>();
    if (j.contains("cache")) {
        auto cc = FusionCacheConfig::from_json(j.at("cache"));
        if (!cc) return cc.error();
        c.cache = cc.value();
    }
    if (j.contains("policy")) {
        auto pc = FusionPolicyConfig::from_json(j.at("policy"));
        if (!pc) return pc.error();
        c.policy = pc.value();
    }
    if (j.contains("output_dir")) c.output_dir = j.at("output_dir").get<std::string>();
    if (j.contains("write_files")) c.write_files = j.at("write_files").get<bool>();
    if (j.contains("ascii_sanitize")) c.ascii_sanitize = j.at("ascii_sanitize").get<bool>();
    if (j.contains("branch_count")) c.branch_count = j.at("branch_count").get<int>();
    if (j.contains("enable_web_tools")) c.enable_web_tools = j.at("enable_web_tools").get<bool>();
    if (j.contains("web_transport")) c.web_transport = j.at("web_transport").get<std::string>();
    if (j.contains("seed_urls") && j.at("seed_urls").is_array()) {
        for (const auto& u : j.at("seed_urls")) {
            if (u.is_string()) c.seed_urls.push_back(u.get<std::string>());
        }
    }
    if (j.contains("web_auto_search")) c.web_auto_search = j.at("web_auto_search").get<bool>();
    if (j.contains("web_search_query")) c.web_search_query = j.at("web_search_query").get<std::string>();
    if (j.contains("web_max_pages")) c.web_max_pages = j.at("web_max_pages").get<int>();
    if (j.contains("web_max_depth")) c.web_max_depth = j.at("web_max_depth").get<int>();
    if (j.contains("web_context_max_chars")) c.web_context_max_chars = j.at("web_context_max_chars").get<int>();
    if (j.contains("web_timeout_ms")) c.web_timeout_ms = j.at("web_timeout_ms").get<int>();
    if (j.contains("web_prefer_explore")) c.web_prefer_explore = j.at("web_prefer_explore").get<bool>();
    if (j.contains("extra") && j.at("extra").is_object()) c.extra = j.at("extra");
    if (c.task.empty()) return Error::invalid_argument("task is required", "task");
    if (c.branch_count < 2) c.branch_count = 2;
    if (c.branch_count > 8) c.branch_count = 8;
    return c;
}

nlohmann::json FusionCallRecord::to_json() const {
    return nlohmann::json{
        {"step_id", step_id},
        {"role_id", role_id},
        {"agent_name", agent_name},
        {"model", model},
        {"cache_hit", cache_hit},
        {"latency_ms", latency_ms},
        {"chars_in", chars_in},
        {"chars_out", chars_out},
        {"prompt_hash", prompt_hash},
        {"error", error},
    };
}

double FusionCacheStats::hit_rate() const {
    const auto total = hits + misses;
    if (total == 0) return 0.0;
    return static_cast<double>(hits) / static_cast<double>(total);
}

nlohmann::json FusionCacheStats::to_json() const {
    return nlohmann::json{
        {"hits", hits},
        {"misses", misses},
        {"puts", puts},
        {"evictions", evictions},
        {"disk_reads", disk_reads},
        {"disk_writes", disk_writes},
        {"corrupt_rejects", corrupt_rejects},
        {"memory_entries", memory_entries},
        {"memory_bytes", memory_bytes},
        {"hit_rate", hit_rate()},
    };
}

nlohmann::json FusionMetrics::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& c : calls) arr.push_back(c.to_json());
    return nlohmann::json{
        {"llm_calls", llm_calls},
        {"handoff_count", handoff_count},
        {"wall_ms", wall_ms},
        {"cache", cache.to_json()},
        {"calls", std::move(arr)},
        {"scores", scores.is_null() ? nlohmann::json::object() : scores},
    };
}

nlohmann::json FusionBranchOutput::to_json() const {
    return nlohmann::json{
        {"branch_id", branch_id},
        {"label", label},
        {"architect_output", architect_output},
        {"skeptic_output", skeptic_output},
        {"combined", combined},
    };
}

nlohmann::json FusionRunResult::to_json() const {
    nlohmann::json branches_j = nlohmann::json::array();
    for (const auto& b : branches) branches_j.push_back(b.to_json());
    nlohmann::json handoffs_j = nlohmann::json::array();
    for (const auto& h : handoffs) handoffs_j.push_back(h.to_json());
    return nlohmann::json{
        {"success", success},
        {"run_id", run_id},
        {"final_output", final_output},
        {"error", error},
        {"config", config.to_json()},
        {"metrics", metrics.to_json()},
        {"branches", std::move(branches_j)},
        {"merge_output", merge_output},
        {"handoffs", std::move(handoffs_j)},
        {"artifact_paths", artifact_paths},
        {"report", report.is_null() ? nlohmann::json::object() : report},
    };
}

std::string FusionRunResult::to_markdown() const {
    std::ostringstream ss;
    ss << "# Fusion run `" << run_id << "`\n\n"
       << "- success: " << (success ? "true" : "false") << "\n"
       << "- mode: " << fusion_mode_to_string(config.mode) << "\n"
       << "- profile: " << fusion_profile_to_string(config.profile) << "\n"
       << "- provider: " << config.provider << "\n"
       << "- llm_calls: " << metrics.llm_calls << "\n"
       << "- cache_hit_rate: " << metrics.cache.hit_rate() << "\n"
       << "- wall_ms: " << metrics.wall_ms << "\n\n"
       << "## Task\n\n" << config.task << "\n\n"
       << "## Final output\n\n" << final_output << "\n";
    if (!error.empty()) {
        ss << "\n## Error\n\n" << error << "\n";
    }
    for (const auto& b : branches) {
        ss << "\n## Branch " << b.branch_id << " (" << b.label << ")\n\n"
           << b.architect_output << "\n";
        if (!b.skeptic_output.empty()) {
            ss << "\n### Skeptic\n\n" << b.skeptic_output << "\n";
        }
    }
    if (!merge_output.empty() && merge_output != final_output) {
        ss << "\n## Merge\n\n" << merge_output << "\n";
    }
    return ss.str();
}

std::string make_fusion_run_id() {
    const auto ms = fusion_now_unix_ms();
    std::mt19937_64 rng{static_cast<std::uint64_t>(ms)};
    std::uniform_int_distribution<int> dist(0, 15);
    std::ostringstream ss;
    ss << "fusion-" << ms << "-";
    for (int i = 0; i < 8; ++i) {
        const int v = dist(rng);
        ss << "0123456789abcdef"[v];
    }
    return ss.str();
}

std::int64_t fusion_now_unix_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
