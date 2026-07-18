#pragma once

#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/metrics.hpp>

#include <string>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct BenchCase {
    std::string case_id;
    std::string source;
    std::string prompt;
    std::string gold_label;
    std::string notes;
    nlohmann::json to_json() const;
};

[[nodiscard]] std::vector<BenchCase> embedded_bench_cases();
[[nodiscard]] const BenchCase* find_bench_case(std::string_view case_id);

struct BenchCaseResult {
    BenchCase cse;
    FusionRunResult run;
    TextScore score;
    bool gold_hit = false;
    nlohmann::json to_json() const;
};

struct BenchBatchResult {
    std::vector<BenchCaseResult> results;
    BatchMetrics metrics;
    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

Result<BenchCaseResult> run_bench_case(const BenchCase& cse, FusionConfig base);
Result<BenchBatchResult> run_bench_batch(const std::vector<std::string>& case_ids, FusionConfig base);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
