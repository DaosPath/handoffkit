#pragma once

#include <handoffkit/demos/fusion/types.hpp>

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

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
