#pragma once

#include <handoffkit/demos/fusion/branch_compare.hpp>
#include <handoffkit/demos/fusion/roles.hpp>
#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

enum class MergeStrategyKind {
    TaskFaithfulPrompt,
    ShippingSectionsPrompt,
    BulletVoteSynthesize,
    ConflictAnnotate,
};

[[nodiscard]] std::string merge_strategy_to_string(MergeStrategyKind k);
[[nodiscard]] Result<MergeStrategyKind> merge_strategy_from_string(std::string_view s);

struct MergePlan {
    MergeStrategyKind kind = MergeStrategyKind::TaskFaithfulPrompt;
    bool ascii = true;
    bool include_diff_notes = true;
    nlohmann::json to_json() const;
};

/// Build the user prompt for the merger agent under a strategy.
[[nodiscard]] std::string build_merge_user_prompt(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies,
    const MergePlan& plan,
    const RolePack& pack
);

/// Offline synthesize without LLM: vote bullets + annotate conflicts.
[[nodiscard]] std::string offline_bullet_vote_merge(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies
);

[[nodiscard]] MergePlan merge_plan_for_pack(const RolePack& pack);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
