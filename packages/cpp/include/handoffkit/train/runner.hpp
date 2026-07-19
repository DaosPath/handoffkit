#pragma once

#include <handoffkit/train/backend.hpp>
#include <handoffkit/train/distill.hpp>
#include <handoffkit/handoff.hpp>

#include <memory>

namespace handoffkit {
namespace train {

struct TrainRunOptions {
    bool write_report_json = true;
    bool emit_handoff = true;
    TrainProgressFn progress;
};

struct TrainRunResult {
    TrainReport report;
    HandoffState handoff;  // trainer → evaluator (when emit_handoff)
    std::filesystem::path report_path;

    [[nodiscard]] nlohmann::json to_json() const;
};

[[nodiscard]] Result<TrainRunResult> run_train_job(
    const TrainJobSpec& job,
    TrainBackend& backend,
    const TrainRunOptions& options = {}
);

/// Convenience: prompts → distill (teacher) → SFT job (student backend).
struct DistillThenTrainConfig {
    DistillConfig distill;
    TrainConfig train;
    std::string job_id_prefix{"distill_sft"};
};

struct DistillThenTrainResult {
    DistillResult distill;
    TrainRunResult train;

    [[nodiscard]] nlohmann::json to_json() const;
};

[[nodiscard]] Result<DistillThenTrainResult> distill_then_train(
    AnyProvider& teacher,
    const std::vector<std::string>& prompts,
    TrainBackend& student_backend,
    const DistillThenTrainConfig& config = {}
);

[[nodiscard]] std::unique_ptr<TrainBackend> make_train_backend(std::string_view backend_id);

}  // namespace train
}  // namespace handoffkit
