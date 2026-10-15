#pragma once

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/error.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct RoleSpec {
    std::string role_id;
    std::string agent_name;
    std::string system_role;  // agent role string
    std::string focus;        // appended focus for branch/skeptic
    bool is_skeptic = false;
    bool is_merger = false;

    nlohmann::json to_json() const;
};

struct BranchRolePair {
    std::string branch_id;
    std::string label;
    RoleSpec architect;
    RoleSpec skeptic;  // used only in ultra
};

struct RolePack {
    FusionProfileId profile = FusionProfileId::Neutral;
    std::string description;
    bool task_faithful_merge = true;   // neutral/diagnostic default
    bool shipping_merge_sections = false;
    std::vector<BranchRolePair> branches;
    RoleSpec merger;

    nlohmann::json to_json() const;
};

[[nodiscard]] RolePack make_role_pack(FusionProfileId profile);
[[nodiscard]] RolePack make_shipping_pack();
[[nodiscard]] RolePack make_neutral_pack();
[[nodiscard]] RolePack make_dialectic_pack();
[[nodiscard]] RolePack make_diagnostic_pack();
[[nodiscard]] RolePack make_coding_pack();
[[nodiscard]] RolePack make_research_pack();
[[nodiscard]] RolePack make_incident_pack();
[[nodiscard]] RolePack make_product_pack();

/// Validate pack has >=2 branches with non-empty architect roles + non-empty merger.
[[nodiscard]] Result<void> validate_role_pack(const RolePack& pack);

/// Build RolePack from JSON (file-loadable definitions).
[[nodiscard]] Result<RolePack> role_pack_from_json(const nlohmann::json& j);
[[nodiscard]] Result<RolePack> load_role_pack_file(const std::filesystem::path& path);

/// Human-readable dump for CLI `fusion roles`.
[[nodiscard]] std::string format_role_pack_text(const RolePack& pack);

/// High-level LLM call plan for CLI `fusion explain` (offline, no provider).
[[nodiscard]] std::string explain_fusion_plan(const FusionConfig& config);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
