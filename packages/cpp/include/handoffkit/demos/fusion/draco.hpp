#pragma once

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/error.hpp>

#include <nlohmann/json.hpp>

#include <cstddef>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct DracoCriterion {
    std::string id;
    std::string section_id;
    std::string section_title;
    std::string requirement;
    double weight = 0.0;

    [[nodiscard]] nlohmann::json to_json() const;
};

struct DracoTask {
    std::size_t index = 0;
    std::string id;
    std::string domain;
    std::string problem;
    nlohmann::json rubric = nlohmann::json::object();
    std::vector<DracoCriterion> criteria;

    [[nodiscard]] nlohmann::json to_json() const;
};

struct DracoScore {
    double raw_score = 0.0;
    double positive_weight_sum = 0.0;
    double normalized_score_pct = 0.0;
    std::size_t n_criteria = 0;
    std::size_t n_judged = 0;
    std::size_t n_missing = 0;
    std::size_t met_positive = 0;
    std::size_t unmet_positive = 0;
    std::size_t met_negative_penalties = 0;
    std::size_t unmet_negative = 0;
    nlohmann::json details = nlohmann::json::array();

    [[nodiscard]] nlohmann::json to_json() const;
};

struct DracoRunConfig {
    std::filesystem::path dataset_path;
    std::filesystem::path output_dir{"runs/draco"};
    std::string provider{"opencode-go"};
    std::string model;
    std::string judge_provider;
    std::string judge_model;
    std::string tier{"baseline"};
    std::size_t offset = 0;
    std::size_t limit = 20;
    bool resume = true;
    bool generate_answers = true;
    bool judge_answers = true;
    bool enable_web_tools = false;
    bool parallel_branches = true;
    int max_parallel_branches = 4;
    int answer_max_tokens = 8192;
    int judge_max_tokens = 2400;
    int judge_batch_size = 8;
    int generation_attempts = 2;
    int judge_attempts = 2;
    std::size_t judge_problem_max_chars = 12000;
    std::size_t judge_answer_max_chars = 30000;
    bool write_markdown = true;

    [[nodiscard]] nlohmann::json to_json() const;
};

struct DracoTaskResult {
    std::size_t index = 0;
    std::string id;
    std::string domain;
    std::string status;
    std::string error;
    std::size_t criteria_count = 0;
    std::size_t answer_chars = 0;
    int generation_calls = 0;
    double generation_wall_s = 0.0;
    bool resumed_generation = false;
    bool resumed_judge = false;
    bool judged = false;
    nlohmann::json generation = nlohmann::json::object();
    nlohmann::json judge = nlohmann::json::object();
    DracoScore score;

    [[nodiscard]] nlohmann::json to_json() const;
};

struct DracoBatchResult {
    DracoRunConfig config;
    std::size_t dataset_tasks = 0;
    std::size_t selected_tasks = 0;
    std::size_t generated_tasks = 0;
    std::size_t judged_tasks = 0;
    std::size_t failed_tasks = 0;
    double mean_score_pct = 0.0;
    std::vector<DracoTaskResult> tasks;

    [[nodiscard]] nlohmann::json to_json() const;
    [[nodiscard]] std::string to_markdown() const;
};

/// Load the official DRACO JSONL shape: id/domain/problem and answer as rubric JSON.
[[nodiscard]] Result<std::vector<DracoTask>> load_draco_tasks(
    const std::filesystem::path& path
);

/// Official DRACO weighted MET/UNMET aggregation.
[[nodiscard]] DracoScore score_draco_verdicts(
    const std::vector<DracoCriterion>& criteria,
    const std::unordered_map<std::string, std::string>& verdicts
);

/// Native C++ batch runner. Baseline uses AnyProvider::generate; product tiers use FusionEngine.
[[nodiscard]] Result<DracoBatchResult> run_draco_batch(const DracoRunConfig& config);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
