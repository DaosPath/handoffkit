#pragma once

#include <handoffkit/demos/fusion/types.hpp>
#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct BranchDiff {
    double token_jaccard = 0.0;
    double line_overlap = 0.0;
    double longest_common_ratio = 0.0;
    int shared_bullets = 0;
    int only_a_bullets = 0;
    int only_b_bullets = 0;
    std::vector<std::string> conflicts;  // short human notes
    nlohmann::json to_json() const;
};

[[nodiscard]] std::vector<std::string> extract_bullet_lines(std::string_view text);
[[nodiscard]] std::size_t longest_common_subsequence_len(std::string_view a, std::string_view b);
[[nodiscard]] double line_overlap_ratio(std::string_view a, std::string_view b);
[[nodiscard]] BranchDiff compare_branch_outputs(std::string_view a, std::string_view b);
[[nodiscard]] BranchDiff compare_fusion_branches(const FusionRunResult& run);

/// Rank which branch is "more specific" (longer unique tokens, more numbers).
[[nodiscard]] int prefer_branch_index(const std::vector<std::string>& outputs);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
