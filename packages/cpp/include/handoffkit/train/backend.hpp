#pragma once

#include <handoffkit/train/types.hpp>

#include <functional>
#include <string>

namespace handoffkit {
namespace train {

/// Progress callback: epoch (1-based), step, message.
using TrainProgressFn = std::function<void(int epoch, int step, std::string_view message)>;

/// Pluggable train backend (echo offline / external process).
class TrainBackend {
public:
    virtual ~TrainBackend() = default;
    [[nodiscard]] virtual std::string id() const = 0;
    virtual Result<TrainReport> run(const TrainJobSpec& job, TrainProgressFn progress = {}) = 0;
};

/// Deterministic offline trainer for CI (no GPU, no network).
class EchoTrainBackend : public TrainBackend {
public:
    [[nodiscard]] std::string id() const override { return "echo"; }
    Result<TrainReport> run(const TrainJobSpec& job, TrainProgressFn progress = {}) override;
};

/// Runs an external trainer command. job.config.extra_args is the argv
/// (first element = executable). Substitutions:
///   {dataset} {output_dir} {epochs} {base_model} {job_id}
class ProcessTrainBackend : public TrainBackend {
public:
    [[nodiscard]] std::string id() const override { return "process"; }
    Result<TrainReport> run(const TrainJobSpec& job, TrainProgressFn progress = {}) override;
};

}  // namespace train
}  // namespace handoffkit
