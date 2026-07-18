#pragma once

// Fusion-style demo suite types (demo layer only). Wire JSON uses snake_case.

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>

#include <nlohmann/json.hpp>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

enum class FusionMode {
    Lean,   // dual branch + merge (3 LLM calls typical)
    Ultra,  // dual branch + skeptic each + merge (5 calls)
    Dag,    // configurable step list
    Panel,  // multi-model panel (N models/roles) + deterministic judge
};

/// Product-facing fusion product tiers (map onto mode + branch_count + budget).
/// Wire names: lite | medium | pro | ultra | genius
enum class FusionTier {
    Lite,    // lean dual + merge (3 calls) — fast
    Medium,  // lean dual + merge (3) with roomier budget / neutral quality defaults
    Pro,     // ultra: dual + skeptics + merge (5)
    Ultra,   // multi-architect DAG (4 branches + merge = 5)
    Genius,  // wide DAG (6 branches + merge = 7) — max exploration
};

/// Prompt / evidence depth scales with product tier (not only call count).
enum class FusionPromptDepth {
    Compact,     // lite — short bullets
    Standard,    // medium
    Deep,        // pro — evidence + critique
    Research,    // ultra — multi-angle research
    Exhaustive,  // genius — wide coverage + residual uncertainty
};

enum class FusionProfileId {
    Shipping,
    Neutral,
    Dialectic,
    Diagnostic,
    Coding,
    Research,
};

/// Differentiated capability pack per product tier: skills + declared tool slots + depth.
/// Tool slots are offline-declared capabilities (not live external tools unless a provider wires them).
struct FusionCapabilityPack {
    std::string pack_id;          // e.g. capability_lite
    std::string description;
    FusionPromptDepth depth = FusionPromptDepth::Standard;
    std::vector<std::string> skills;
    std::vector<std::string> tool_slots;
    int evidence_min_points = 2;
    int max_branch_bullets = 10;
    int max_skeptic_bullets = 6;
    int handoff_summary_chars = 900;

    nlohmann::json to_json() const;
};

struct FusionTierSpec {
    FusionTier tier = FusionTier::Medium;
    std::string id;           // snake_case wire id
    std::string display_name; // human label e.g. "Fusion Pro"
    std::string description;
    FusionMode mode = FusionMode::Lean;
    int branch_count = 2;
    int planned_llm_calls = 3;
    int max_llm_calls = 8;
    FusionCapabilityPack capability;

    nlohmann::json to_json() const;
};

[[nodiscard]] std::string fusion_mode_to_string(FusionMode mode);
[[nodiscard]] Result<FusionMode> fusion_mode_from_string(std::string_view s);
[[nodiscard]] std::string fusion_profile_to_string(FusionProfileId id);
[[nodiscard]] Result<FusionProfileId> fusion_profile_from_string(std::string_view s);
[[nodiscard]] std::string fusion_tier_to_string(FusionTier tier);
[[nodiscard]] Result<FusionTier> fusion_tier_from_string(std::string_view s);
[[nodiscard]] std::string fusion_prompt_depth_to_string(FusionPromptDepth depth);
[[nodiscard]] std::vector<std::string> fusion_profile_names();
[[nodiscard]] std::vector<std::string> fusion_mode_names();
[[nodiscard]] std::vector<std::string> fusion_tier_names();
[[nodiscard]] FusionTierSpec fusion_tier_spec(FusionTier tier);
[[nodiscard]] FusionCapabilityPack fusion_capability_pack(FusionTier tier);

struct FusionPolicyConfig {
    int max_llm_calls = 32;
    int max_wall_ms = 600000;
    int max_prompt_chars = 120000;
    int cooldown_ms = 0;
    bool hard_fail_on_budget = true;
    bool allow_disk_cache = true;
    bool allow_memory_cache = true;

    nlohmann::json to_json() const;
    static Result<FusionPolicyConfig> from_json(const nlohmann::json& j);
};

struct FusionCacheConfig {
    bool enabled = true;
    std::filesystem::path cache_dir{"runs/fusion-cache"};
    std::size_t max_memory_entries = 256;
    std::size_t max_memory_bytes = 32 * 1024 * 1024;
    int ttl_seconds = 7 * 24 * 3600;
    bool use_disk = true;
    bool use_memory = true;

    nlohmann::json to_json() const;
    static Result<FusionCacheConfig> from_json(const nlohmann::json& j);
};

struct FusionConfig {
    std::string task;
    FusionMode mode = FusionMode::Lean;
    FusionProfileId profile = FusionProfileId::Neutral;
    FusionTier tier = FusionTier::Medium;
    std::string provider{"echo"};
    std::string model;  // empty = provider default
    std::string model_a;
    std::string model_b;
    std::string model_merge;
    /// Multi-model panel slot ids (mode=panel). Empty → resolve from model_a/b/model/merge or 4x default.
    std::vector<std::string> panel_models;
    /// Optional roles aligned with panel_models; empty → default_panel_roles().
    std::vector<std::string> panel_roles;
    /// After dual/dag: pre-merge analysis inject + post report panel_judge.
    bool attach_panel_judge = true;
    /// Optional extra LLM call to refine deterministic panel analysis (off = offline gate).
    bool enable_meta_judge = false;
    /// Skip ultra skeptics when branch answers highly overlap.
    bool early_stop_on_overlap = true;
    double overlap_skip_skeptic_threshold = 0.90;
    /// If merge drops a concrete branch lead, re-prefix it.
    bool anti_dilution = true;
    FusionCacheConfig cache;
    FusionPolicyConfig policy;
    std::filesystem::path output_dir{"runs/fusion-runs"};
    bool write_files = true;
    bool ascii_sanitize = true;
    int branch_count = 2;  // for multi/dag
    nlohmann::json extra = nlohmann::json::object();

    /// When true, run native web explorer tools before LLM steps and inject Markdown.
    bool enable_web_tools = false;
    /// map|fixture|http — map uses offline fixture graph unless seed_urls override.
    std::string web_transport{"http"};
    std::vector<std::string> seed_urls;
    /// If no URLs in task/seeds, run Wikipedia OpenSearch from task text.
    bool web_auto_search = true;
    std::string web_search_query;  // empty = auto from task
    int web_max_pages = 3;
    int web_max_depth = 1;
    int web_context_max_chars = 14000;
    int web_timeout_ms = 20000;
    /// Prefer web_explore multi-page for first seed when depth>0.
    bool web_prefer_explore = true;

    nlohmann::json to_json() const;
    static Result<FusionConfig> from_json(const nlohmann::json& j);
};

/// Apply tier defaults onto config (mode, branch_count, policy.max_llm_calls, tier field).
void apply_fusion_tier(FusionConfig& config, FusionTier tier);
/// Expected LLM call count for a config (for tests/CLI reporting).
[[nodiscard]] int planned_llm_calls_for_config(const FusionConfig& config);

struct FusionCallRecord {
    std::string step_id;
    std::string role_id;
    std::string agent_name;
    std::string model;
    bool cache_hit = false;
    int latency_ms = 0;
    std::size_t chars_in = 0;
    std::size_t chars_out = 0;
    std::string prompt_hash;
    std::string error;

    nlohmann::json to_json() const;
};

struct FusionCacheStats {
    std::uint64_t hits = 0;
    std::uint64_t misses = 0;
    std::uint64_t puts = 0;
    std::uint64_t evictions = 0;
    std::uint64_t disk_reads = 0;
    std::uint64_t disk_writes = 0;
    std::uint64_t corrupt_rejects = 0;
    std::size_t memory_entries = 0;
    std::size_t memory_bytes = 0;

    [[nodiscard]] double hit_rate() const;
    nlohmann::json to_json() const;
};

struct FusionMetrics {
    int llm_calls = 0;
    int handoff_count = 0;
    int wall_ms = 0;
    FusionCacheStats cache;
    std::vector<FusionCallRecord> calls;
    nlohmann::json scores = nlohmann::json::object();

    nlohmann::json to_json() const;
};

struct FusionBranchOutput {
    std::string branch_id;
    std::string label;
    std::string architect_output;
    std::string skeptic_output;
    std::string combined;

    nlohmann::json to_json() const;
};

struct FusionRunResult {
    bool success = false;
    std::string run_id;
    std::string final_output;
    std::string error;
    FusionConfig config;
    FusionMetrics metrics;
    std::vector<FusionBranchOutput> branches;
    std::string merge_output;
    std::vector<HandoffState> handoffs;
    std::vector<std::string> artifact_paths;
    nlohmann::json report = nlohmann::json::object();

    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

[[nodiscard]] std::string make_fusion_run_id();
[[nodiscard]] std::int64_t fusion_now_unix_ms();

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
