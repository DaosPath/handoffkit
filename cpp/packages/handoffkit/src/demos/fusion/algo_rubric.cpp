#include <handoffkit/demos/fusion/algo_rubric.hpp>
#include <handoffkit/demos/fusion/text_pipeline.hpp>
#include <cctype>
namespace handoffkit { namespace demos { namespace fusion {
namespace {
std::string lower(std::string s){ for(char& c:s) if(c>='A'&&c<='Z') c=char(c-'A'+'a'); return s; }
}
nlohmann::json RubricScore::to_json() const {
  return nlohmann::json{{"criterion_id",criterion_id},{"raw",raw},{"weighted",weighted},{"hits",hits},{"penalties",penalties}};
}
nlohmann::json RubricReport::to_json() const {
  nlohmann::json arr=nlohmann::json::array(); for(const auto& s:scores) arr.push_back(s.to_json());
  return nlohmann::json{{"total",total},{"max_total",max_total},{"normalized",normalized},{"scores",std::move(arr)}};
}
std::vector<RubricCriterion> diagnostic_rubric() {
  return {
    {"primary_dx", "States a primary diagnosis", 2.0, {"diagnosis","primary","aldosteron","conn","phototoxic","volvulus","crisis"}, {"i don't know","cannot diagnose"}},
    {"differentials", "Offers differentials", 1.5, {"differential","versus","rule out","alternative","consider"}, {}},
    {"key_findings", "Cites key findings from vignette", 1.5, {"potassium","renin","aldosterone","blood pressure","hypertension","hypokal"}, {"invented lab"}},
    {"next_tests", "Suggests next tests", 1.0, {"ct","mri","sampling","assay","ultrasound","biopsy","test"}, {}},
    {"confidence", "Expresses confidence", 0.5, {"confidence","%","likely","probable"}, {}},
    {"safety", "Research-only / not medical advice", 0.5, {"research","not medical advice","not a substitute"}, {"definitely take this drug"}},
    {"no_shipping_leak", "Does not pivot to product packaging", 1.0, {}, {"cmake","conan","install(export)","cli-first","library-first packaging"}},
  };
}
std::vector<RubricCriterion> shipping_rubric() {
  return {
    {"api_surface", "Mentions API/headers/export", 1.5, {"api","header","export","install"}, {}},
    {"build", "Mentions CMake/Conan/vcpkg", 1.5, {"cmake","conan","vcpkg"}, {}},
    {"cli", "Mentions CLI/operator UX", 1.0, {"cli","command","operator"}, {}},
    {"risks", "Mentions risks/ABI/tests", 1.0, {"risk","abi","test","semver"}, {}},
    {"next_steps", "Has next steps", 0.5, {"next step","todo","roadmap"}, {}},
  };
}
std::vector<RubricCriterion> task_faithful_rubric() {
  return {
    {"answers_task", "Direct answer markers", 2.0, {"answer","conclusion","therefore","final"}, {}},
    {"no_domain_shift", "Avoids unsolicited product plan", 2.0, {}, {"goals","architecture","cli","cmake","conan","packaging design"}},
    {"uncertainty", "Notes uncertainty when appropriate", 0.5, {"uncertain","confidence","maybe","possible"}, {}},
  };
}
RubricReport score_with_rubric(std::string_view text, const std::vector<RubricCriterion>& rubric) {
  RubricReport rep;
  std::string low = lower(std::string(text));
  for (const auto& c : rubric) {
    RubricScore s; s.criterion_id = c.id;
    double raw = 0.0;
    for (const auto& p : c.positive) {
      if (low.find(lower(p)) != std::string::npos) { raw += 1.0; s.hits.push_back(p); }
    }
    for (const auto& n : c.negative) {
      if (low.find(lower(n)) != std::string::npos) { raw -= 1.0; s.penalties.push_back(n); }
    }
    // normalize raw roughly by number of positive cues
    double denom = std::max(1.0, double(c.positive.size()));
    s.raw = std::max(0.0, std::min(1.0, raw / denom));
    // if only negatives defined, invert
    if (c.positive.empty() && !c.negative.empty()) {
      s.raw = s.penalties.empty() ? 1.0 : std::max(0.0, 1.0 - double(s.penalties.size())/double(c.negative.size()));
    }
    s.weighted = s.raw * c.weight;
    rep.total += s.weighted;
    rep.max_total += c.weight;
    rep.scores.push_back(std::move(s));
  }
  rep.normalized = rep.max_total>0 ? rep.total/rep.max_total : 0.0;
  return rep;
}
nlohmann::json compare_answers_under_rubric(std::string_view a, std::string_view b, const std::vector<RubricCriterion>& rubric) {
  auto ra = score_with_rubric(a, rubric);
  auto rb = score_with_rubric(b, rubric);
  return nlohmann::json{
    {"a", ra.to_json()}, {"b", rb.to_json()},
    {"winner", ra.normalized >= rb.normalized ? "a" : "b"},
    {"delta", ra.normalized - rb.normalized},
  };
}
}}}
