#pragma once

// Lightweight train/distill types (snake_case wire). No GPU frameworks.

#include <handoffkit/error.hpp>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace handoffkit {
namespace train {

enum class ExampleFormat {
    PromptCompletion,  // {"prompt","completion"}
    Messages,          // {"messages":[{"role","content"},...]}
    Preference,        // {"prompt","chosen","rejected"} — stored; train may ignore in v1
};

[[nodiscard]] std::string example_format_to_string(ExampleFormat f);
[[nodiscard]] Result<ExampleFormat> example_format_from_string(std::string_view s);

struct TrainExample {
    ExampleFormat format = ExampleFormat::PromptCompletion;
    std::string prompt;
    std::string completion;
    nlohmann::json messages = nlohmann::json::array();
    std::string chosen;
    std::string rejected;
    nlohmann::json meta = nlohmann::json::object();

    [[nodiscard]] bool empty() const;
    [[nodiscard]] nlohmann::json to_json() const;
    static Result<TrainExample> from_json(const nlohmann::json& j);
};

struct Dataset {
    std::string id;
    std::filesystem::path path;
    ExampleFormat format = ExampleFormat::PromptCompletion;
    std::size_t count = 0;
    std::string content_hash;
    nlohmann::json meta = nlohmann::json::object();

    [[nodiscard]] nlohmann::json to_json() const;
    static Result<Dataset> from_json(const nlohmann::json& j);
};

struct TrainConfig {
    std::string base_model{"echo-student"};
    int epochs = 1;
    double learning_rate = 2e-5;
    int max_steps = 0;  // 0 = derive from epochs * examples
    int seed = 42;
    std::filesystem::path output_dir{"runs/train-out"};
    std::string backend_id{"echo"};  // echo | process
    std::vector<std::string> extra_args;
    nlohmann::json meta = nlohmann::json::object();

    [[nodiscard]] nlohmann::json to_json() const;
    static Result<TrainConfig> from_json(const nlohmann::json& j);
};

struct TrainMetrics {
    std::vector<double> loss_per_epoch;
    double final_loss = 0.0;
    int steps = 0;
    std::size_t examples_seen = 0;

    [[nodiscard]] nlohmann::json to_json() const;
};

struct TrainReport {
    bool success = false;
    std::string job_id;
    std::string backend_id;
    std::string error;
    int wall_ms = 0;
    TrainMetrics metrics;
    std::filesystem::path log_path;
    std::vector<std::string> artifact_paths;
    nlohmann::json meta = nlohmann::json::object();

    [[nodiscard]] nlohmann::json to_json() const;
};

enum class TrainJobKind {
    Sft,
    DistillSft,
    PreferenceStore,  // dataset only / no-op train in v1 backends
};

[[nodiscard]] std::string train_job_kind_to_string(TrainJobKind k);
[[nodiscard]] Result<TrainJobKind> train_job_kind_from_string(std::string_view s);

struct TrainJobSpec {
    std::string job_id;
    TrainJobKind kind = TrainJobKind::Sft;
    Dataset dataset;
    TrainConfig config;
    nlohmann::json meta = nlohmann::json::object();

    [[nodiscard]] nlohmann::json to_json() const;
    static Result<TrainJobSpec> from_json(const nlohmann::json& j);
};

}  // namespace train
}  // namespace handoffkit
