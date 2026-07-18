#pragma once

#include <handoffkit/demos/fusion/types.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct TextScore {
    double jaccard = 0.0;
    double containment = 0.0;  // gold tokens in prediction
    double length_ratio = 0.0;
    bool contains_normalized_gold = false;
    nlohmann::json to_json() const;
};

[[nodiscard]] std::vector<std::string> tokenize_simple(std::string_view text);
[[nodiscard]] std::string normalize_label(std::string_view text);
[[nodiscard]] TextScore score_text_against_gold(std::string_view prediction, std::string_view gold);
[[nodiscard]] nlohmann::json score_fusion_run(const FusionRunResult& run, std::string_view gold_label = {});
[[nodiscard]] std::string metrics_markdown(const FusionMetrics& m);

/// Aggregate batch metrics for bench harness.
struct BatchMetrics {
    int cases = 0;
    int successes = 0;
    int gold_hits = 0;
    double mean_hit_rate = 0.0;
    double mean_wall_ms = 0.0;
    int total_llm_calls = 0;
    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

void batch_metrics_add(BatchMetrics& agg, const FusionRunResult& run, bool gold_hit);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
