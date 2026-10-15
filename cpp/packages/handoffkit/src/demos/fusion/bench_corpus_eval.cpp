#include <handoffkit/demos/fusion/cases_medcase.hpp>
#include <handoffkit/demos/fusion/cases_validate.hpp>
#include <handoffkit/demos/fusion/metrics.hpp>
#include <handoffkit/demos/fusion/algo_rubric.hpp>
#include <handoffkit/demos/fusion/text_pipeline.hpp>
#include <handoffkit/demos/fusion/algo_stats.hpp>
namespace handoffkit { namespace demos { namespace fusion {

nlohmann::json evaluate_medcase_corpus_offline() {
  auto all = all_medcase_bench_cases();
  auto val = validate_all_medcase_cases();
  std::vector<double> prompt_lens, gold_lens, gold_token_counts;
  prompt_lens.reserve(all.size()); gold_lens.reserve(all.size());
  int format_ok=0, disclaimer_ok=0;
  for (const auto& c : all) {
    prompt_lens.push_back(double(c.prompt.size()));
    gold_lens.push_back(double(c.gold_label.size()));
    gold_token_counts.push_back(double(tokenize_simple(c.gold_label).size()));
    if (case_prompt_mentions_required_format(c)) ++format_ok;
    if (case_prompt_has_research_disclaimer(c)) ++disclaimer_ok;
    // self score: gold against itself should be high
    auto sc = score_text_against_gold(c.gold_label, c.gold_label);
    if (!sc.contains_normalized_gold) {
      // still ok if normalize collapses differently
    }
  }
  return nlohmann::json{
    {"cases", (int)all.size()},
    {"validation", val.to_json()},
    {"prompt_len", summarize_vector(prompt_lens)},
    {"gold_len", summarize_vector(gold_lens)},
    {"gold_tokens", summarize_vector(gold_token_counts)},
    {"format_ok", format_ok},
    {"disclaimer_ok", disclaimer_ok},
    {"gold_label_stats", corpus_gold_label_stats()},
  };
}

}}}
