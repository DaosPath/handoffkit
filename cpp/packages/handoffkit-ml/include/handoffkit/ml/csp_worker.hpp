#pragma once

#include <handoffkit/csp/contracts.hpp>
#include <handoffkit/csp/native_compute.hpp>

#include <cstddef>
#include <filesystem>
#include <memory>
#include <string>

namespace handoffkit::ml {

struct MlWorkerOptions {
    std::string worker_id;
    std::size_t worker_threads{1};
    std::size_t queue_capacity{8};
};

[[nodiscard]] csp::WorkerCapabilities detect_ml_worker_capabilities(
    const std::string& worker_id,
    std::size_t worker_threads);

[[nodiscard]] csp::ArtifactRef make_local_artifact_ref(
    std::string artifact_id,
    const std::filesystem::path& path,
    std::string media_type,
    nlohmann::json metadata = nlohmann::json::object());

void verify_local_artifact(const csp::ArtifactRef& artifact);

class MlCspWorker {
public:
    MlCspWorker(
        MlWorkerOptions options,
        csp::NativeProgressHandler progress_handler,
        csp::NativeResultHandler result_handler);
    ~MlCspWorker();

    MlCspWorker(const MlCspWorker&) = delete;
    MlCspWorker& operator=(const MlCspWorker&) = delete;

    [[nodiscard]] const csp::WorkerCapabilities& capabilities() const noexcept;
    [[nodiscard]] csp::NativeSubmitResult submit_training(
        const csp::TrainingJob& job,
        const std::string& message_id);
    [[nodiscard]] csp::NativeSubmitResult submit_evaluation(
        const csp::EvaluationJob& job,
        const std::string& message_id);
    [[nodiscard]] bool cancel(const std::string& job_id);
    void shutdown(csp::ShutdownMode mode = csp::ShutdownMode::drain);

private:
    csp::WorkerCapabilities capabilities_;
    std::unique_ptr<csp::NativeComputePool> pool_;
};

}  // namespace handoffkit::ml
