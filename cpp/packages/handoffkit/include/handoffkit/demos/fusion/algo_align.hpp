#pragma once
#include <string>
#include <string_view>
#include <vector>
#include <nlohmann/json.hpp>
namespace handoffkit { namespace demos { namespace fusion {
struct AlignScore {
  int score = 0;
  double identity = 0.0;
  double coverage_a = 0.0;
  double coverage_b = 0.0;
  std::string aligned_a;
  std::string aligned_b;
  nlohmann::json to_json() const;
};
// Global alignment (Needleman-Wunsch)
AlignScore needleman_wunsch(std::string_view a, std::string_view b, int match=2, int mismatch=-1, int gap=-2);
// Local alignment (Smith-Waterman)
AlignScore smith_waterman(std::string_view a, std::string_view b, int match=2, int mismatch=-1, int gap=-2);
// Token-level alignment using NW on token ids
AlignScore align_token_sequences(const std::vector<std::string>& a, const std::vector<std::string>& b);
// Similarity band: compare two fusion branch texts
double branch_alignment_similarity(std::string_view a, std::string_view b);
}}}
