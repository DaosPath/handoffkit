#pragma once
#include <string>
#include <string_view>
#include <vector>
#include <nlohmann/json.hpp>
namespace handoffkit { namespace demos { namespace fusion {
struct RubricCriterion {
  std::string id;
  std::string description;
  double weight = 1.0;
  // keywords that increase score if present
  std::vector<std::string> positive;
  std::vector<std::string> negative;
};
struct RubricScore {
  std::string criterion_id;
  double raw = 0.0;
  double weighted = 0.0;
  std::vector<std::string> hits;
  std::vector<std::string> penalties;
  nlohmann::json to_json() const;
};
struct RubricReport {
  double total = 0.0;
  double max_total = 0.0;
  double normalized = 0.0;
  std::vector<RubricScore> scores;
  nlohmann::json to_json() const;
};
std::vector<RubricCriterion> diagnostic_rubric();
std::vector<RubricCriterion> shipping_rubric();
std::vector<RubricCriterion> task_faithful_rubric();
RubricReport score_with_rubric(std::string_view text, const std::vector<RubricCriterion>& rubric);
// Compare two answers under same rubric
nlohmann::json compare_answers_under_rubric(std::string_view a, std::string_view b, const std::vector<RubricCriterion>& rubric);
}}}
