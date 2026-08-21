#pragma once

// Multi-model panel + deterministic panel judge (consensus / contradictions / rubric).
// Analysis feeds merge prompts and a unified report schema.

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/runtime/provider.hpp>

#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct PanelSlot {
    std::string provider;  // optional; empty = use FusionConfig.provider
    std::string model;
    std::string role;
    std::string answer;
    std::vector<std::string> strengths;
    std::vector<std::string> risks;
    std::string confidence{"medium"};
    std::string error;

    nlohmann::json to_json() const;
};

/// Parsed "provider:model" or bare model id.
struct PanelModelSpec {
    std::string provider;  // empty → config default
    std::string model;
};

struct PanelJudgeReport {
    bool success = false;
    std::string task;
    std::string mode;
    std::vector<PanelSlot> panel;
    std::vector<std::string> consensus;
    std::vector<std::string> contradictions;
    std::vector<std::string> coverage_gaps;
    std::vector<std::string> unique_insights;
    std::vector<std::string> blind_spots;
    std::string final_answer;
    nlohmann::json rubric = nlohmann::json::object();
    bool meta_judge_used = false;

    /// Unified analysis object (snake_case) shared by panel + dual/dag reports.
    [[nodiscard]] nlohmann::json analysis_json() const;
    nlohmann::json to_json() const;
    std::string to_markdown() const;
    /// Compact section injected into merge prompts.
    [[nodiscard]] std::string merge_prompt_section() const;
};

[[nodiscard]] std::vector<std::string> default_panel_roles();
/// Profile-aware roles (research/coding/shipping/diagnostic/…).
[[nodiscard]] std::vector<std::string> panel_roles_for_profile(FusionProfileId profile);

[[nodiscard]] PanelModelSpec parse_panel_model_spec(std::string_view spec);
[[nodiscard]] std::vector<std::string> resolve_panel_models(const FusionConfig& config);
[[nodiscard]] std::vector<PanelModelSpec> resolve_panel_model_specs(const FusionConfig& config);

[[nodiscard]] std::string frame_panel_role_task(
    std::string_view task,
    std::string_view role,
    bool ascii = true
);

/// Deterministic offline answers for CI when provider is echo (role-keyed templates).
[[nodiscard]] std::string offline_panel_answer(std::string_view role, std::string_view task);

[[nodiscard]] PanelJudgeReport judge_fusion_panel(
    std::string_view task,
    std::vector<PanelSlot> panel,
    std::string_view mode
);

[[nodiscard]] PanelJudgeReport judge_branch_outputs_as_panel(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies,
    std::string_view merge_output,
    std::string_view mode
);

/// Token Jaccard between two answer bodies (for early-stop).
[[nodiscard]] double branch_answer_overlap(std::string_view a, std::string_view b);

/// Extract a leading "direct answer" line/sentence for anti-dilution checks.
[[nodiscard]] std::string extract_direct_answer_lead(std::string_view text, std::size_t max_chars = 200);

/// If merge lost a concrete lead present in a branch, prefix it.
[[nodiscard]] std::string apply_anti_dilution(
    std::string_view merge_output,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies
);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
