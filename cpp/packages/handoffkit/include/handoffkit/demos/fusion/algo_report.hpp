#pragma once
#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/demos/fusion/branch_compare.hpp>
#include <handoffkit/demos/fusion/algo_rubric.hpp>
#include <string>
namespace handoffkit { namespace demos { namespace fusion {
struct FusionRichReport {
  std::string markdown;
  std::string html;
  nlohmann::json wire;
};
FusionRichReport build_rich_fusion_report(const FusionRunResult& run, const BranchDiff& diff, const RubricReport& rubric);
std::string html_escape(std::string_view s);
std::string markdown_table(const std::vector<std::vector<std::string>>& rows);
}}}
