#include <handoffkit/demos/fusion/cases_validate.hpp>
#include <handoffkit/demos/fusion/cases_medcase.hpp>
#include <handoffkit/demos/fusion/metrics.hpp>
#include <algorithm>
#include <cctype>
#include <cstdint>
namespace handoffkit { namespace demos { namespace fusion {

nlohmann::json CaseValidationIssue::to_json() const {
  return nlohmann::json{{"case_id",case_id},{"code",code},{"message",message}};
}
nlohmann::json CaseValidationReport::to_json() const {
  nlohmann::json arr=nlohmann::json::array();
  for (const auto& i: items) arr.push_back(i.to_json());
  return nlohmann::json{{"cases",cases},{"ok",ok},{"issues",issues},{"items",std::move(arr)}};
}

bool case_has_nonempty_id(const BenchCase& c) { return !c.case_id.empty(); }
bool case_has_nonempty_prompt(const BenchCase& c) { return !c.prompt.empty(); }
bool case_has_nonempty_gold(const BenchCase& c) { return !c.gold_label.empty(); }
bool case_prompt_mentions_required_format(const BenchCase& c) {
  return c.prompt.find("Required") != std::string::npos || c.prompt.find("primary diagnosis") != std::string::npos;
}
bool case_prompt_has_research_disclaimer(const BenchCase& c) {
  return c.prompt.find("Research only") != std::string::npos || c.prompt.find("not clinical advice") != std::string::npos;
}
bool case_prompt_has_vignette_marker(const BenchCase& c) {
  return c.prompt.find("Vignette") != std::string::npos || c.prompt.find("vignette") != std::string::npos;
}
bool case_id_looks_stable(const BenchCase& c) {
  if (c.case_id.size() < 3) return false;
  // allow medcase-#### or medcase100-#### or similar alnum/-
  for (char ch: c.case_id) {
    if (!(std::isalnum((unsigned char)ch) || ch=='-' || ch=='_')) return false;
  }
  return true;
}
bool case_source_mentions_medcase(const BenchCase& c) {
  return c.source.find("MedCase") != std::string::npos || c.source.find("PMC") != std::string::npos;
}
bool case_gold_not_in_prompt_leak_heuristic(const BenchCase& c) {
  // gold may appear in notes but should not be trivially the only content of prompt
  if (c.gold_label.empty()) return true;
  auto g = normalize_label(c.gold_label);
  auto p = normalize_label(c.prompt);
  if (g.size() < 4) return true;
  // fail only if prompt is almost exactly gold
  return p.find(g) == std::string::npos || p.size() > g.size() * 5;
}
bool case_notes_nonempty(const BenchCase& c) { return !c.notes.empty(); }
bool case_prompt_min_length(const BenchCase& c, std::size_t min_chars) { return c.prompt.size() >= min_chars; }
bool case_prompt_max_length(const BenchCase& c, std::size_t max_chars) { return c.prompt.size() <= max_chars; }
bool case_prompt_ascii_ratio_ok(const BenchCase& c, double min_ratio) {
  if (c.prompt.empty()) return false;
  std::size_t ascii=0; for (unsigned char ch: c.prompt) if (ch < 128) ++ascii;
  return double(ascii)/double(c.prompt.size()) >= min_ratio;
}
bool case_gold_normalized_nonempty(const BenchCase& c) { return !normalize_label(c.gold_label).empty(); }

std::vector<CaseValidationIssue> validate_one_case(const BenchCase& c) {
  std::vector<CaseValidationIssue> issues;
  auto add=[&](bool ok, const char* code, const char* msg){
    if (!ok) issues.push_back(CaseValidationIssue{c.case_id, code, msg});
  };
  add(case_has_nonempty_id(c), "empty_id", "case_id empty");
  add(case_has_nonempty_prompt(c), "empty_prompt", "prompt empty");
  add(case_has_nonempty_gold(c), "empty_gold", "gold empty");
  add(case_prompt_mentions_required_format(c), "no_format", "missing required format markers");
  add(case_prompt_has_research_disclaimer(c), "no_disclaimer", "missing research disclaimer");
  add(case_prompt_has_vignette_marker(c), "no_vignette", "missing vignette marker");
  add(case_id_looks_stable(c), "bad_id", "case_id has unexpected chars");
  add(case_source_mentions_medcase(c), "bad_source", "source missing MedCase/PMC");
  add(case_gold_not_in_prompt_leak_heuristic(c), "gold_leak", "prompt appears gold-only");
  add(case_notes_nonempty(c), "empty_notes", "notes empty");
  add(case_prompt_min_length(c, 80), "prompt_short", "prompt < 80 chars");
  add(case_prompt_max_length(c, 200000), "prompt_huge", "prompt too large");
  add(case_prompt_ascii_ratio_ok(c, 0.70), "ascii_ratio", "ascii ratio < 0.70");
  add(case_gold_normalized_nonempty(c), "gold_norm", "normalized gold empty");
  return issues;
}

CaseValidationReport validate_all_medcase_cases() {
  CaseValidationReport rep;
  auto all = all_medcase_bench_cases();
  rep.cases = (int)all.size();
  for (const auto& c : all) {
    auto iss = validate_one_case(c);
    if (iss.empty()) ++rep.ok;
    else {
      rep.issues += (int)iss.size();
      for (auto& i: iss) rep.items.push_back(std::move(i));
    }
  }
  return rep;
}

nlohmann::json corpus_gold_label_stats() {
  auto all = all_medcase_bench_cases();
  std::size_t total=0, minl=SIZE_MAX, maxl=0, sum=0;
  int with_space=0, with_underscore=0;
  for (const auto& c: all) {
    auto g = normalize_label(c.gold_label);
    ++total; sum += g.size(); minl=std::min(minl,g.size()); maxl=std::max(maxl,g.size());
    if (c.gold_label.find(' ')!=std::string::npos) ++with_space;
    if (c.gold_label.find('_')!=std::string::npos) ++with_underscore;
  }
  if (total==0) minl=0;
  return nlohmann::json{
    {"cases",(int)total},
    {"gold_len_mean", total? double(sum)/total : 0.0},
    {"gold_len_min",(int)minl},
    {"gold_len_max",(int)maxl},
    {"gold_with_space", with_space},
    {"gold_with_underscore", with_underscore},
  };
}

}}}

