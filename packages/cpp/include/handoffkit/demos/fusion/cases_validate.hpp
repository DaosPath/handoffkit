#pragma once
#include <handoffkit/demos/fusion/bench.hpp>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>
namespace handoffkit { namespace demos { namespace fusion {
struct CaseValidationIssue {
  std::string case_id;
  std::string code;
  std::string message;
  nlohmann::json to_json() const;
};
struct CaseValidationReport {
  int cases = 0;
  int ok = 0;
  int issues = 0;
  std::vector<CaseValidationIssue> items;
  nlohmann::json to_json() const;
};
// Individual validators
bool case_has_nonempty_id(const BenchCase& c);
bool case_has_nonempty_prompt(const BenchCase& c);
bool case_has_nonempty_gold(const BenchCase& c);
bool case_prompt_mentions_required_format(const BenchCase& c);
bool case_prompt_has_research_disclaimer(const BenchCase& c);
bool case_prompt_has_vignette_marker(const BenchCase& c);
bool case_id_looks_stable(const BenchCase& c);
bool case_source_mentions_medcase(const BenchCase& c);
bool case_gold_not_in_prompt_leak_heuristic(const BenchCase& c);
bool case_notes_nonempty(const BenchCase& c);
bool case_prompt_min_length(const BenchCase& c, std::size_t min_chars);
bool case_prompt_max_length(const BenchCase& c, std::size_t max_chars);
bool case_prompt_ascii_ratio_ok(const BenchCase& c, double min_ratio);
bool case_gold_normalized_nonempty(const BenchCase& c);
// Run all validators on one case / all cases
std::vector<CaseValidationIssue> validate_one_case(const BenchCase& c);
CaseValidationReport validate_all_medcase_cases();
// Offline gold scoring across corpus using echo is useless; instead score gold self-consistency
nlohmann::json corpus_gold_label_stats();
}}}
