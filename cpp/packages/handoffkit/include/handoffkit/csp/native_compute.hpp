#pragma once

#include <handoffkit/csp/contracts.hpp>

#include <atomic>
#include <chrono>
#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <stop_token>
#include <string>
#include <vector>

namespace handoffkit::csp {

enum class WorkerLifecycle { running, draining, stopping, stopped };
enum class ShutdownMode { drain, cancel };

struct NativeDeliveryResult {
    std::string job_id;
    std::optional<ArtifactRef> artifact;
    std::optional<DeliveryAck> ack;
    std::optional<DeliveryNack> nack;

    [[nodiscard]] bool succeeded() const noexcept { return ack.has_value(); }
};

class NativeAckNackAdapter {
public:
    [[nodiscard]] static NativeDeliveryResult success(
        const std::string& job_id,
        const std::string& message_id,
        ArtifactRef artifact);

    [[nodiscard]] static NativeDeliveryResult failure(
        const std::string& job_id,
        const std::string& message_id,
        std::string code,
        std::string message,
        bool retryable = false);
};

using NativeProgressHandler = std::function<void(const JobProgress&)>;
using NativeResultHandler = std::function<void(const NativeDeliveryResult&)>;

class NativeJobInterrupted final : public std::runtime_error {
public:
    NativeJobInterrupted(std::string code, std::string message);
    [[nodiscard]] const std::string& code() const noexcept { return code_; }

private:
    std::string code_;
};

class NativeJobFailure final : public std::runtime_error {
public:
    NativeJobFailure(std::string code, std::string message, bool retryable = false);
    [[nodiscard]] const std::string& code() const noexcept { return code_; }
    [[nodiscard]] bool retryable() const noexcept { return retryable_; }

private:
    std::string code_;
    bool retryable_;
};

class NativeJobContext {
public:
    [[nodiscard]] const std::string& job_id() const noexcept { return job_id_; }
    [[nodiscard]] std::stop_token stop_token() const noexcept { return stop_token_; }
    [[nodiscard]] bool deadline_exceeded() const noexcept;
    [[nodiscard]] bool stop_requested() const noexcept;
    void throw_if_stopped() const;

    void report_progress(
        std::string phase,
        std::string status,
        std::uint64_t step,
        std::uint64_t total_steps,
        std::string message = {},
        std::vector<ArtifactRef> artifacts = {},
        std::optional<double> loss = std::nullopt,
        nlohmann::json metrics = nlohmann::json::object()) const;

private:
    friend class NativeComputePool;
    NativeJobContext(
        std::string job_id,
        std::stop_token stop_token,
        std::optional<std::chrono::system_clock::time_point> deadline,
        std::shared_ptr<std::atomic_bool> deadline_fired,
        NativeProgressHandler progress_handler);

    std::string job_id_;
    std::stop_token stop_token_;
    std::optional<std::chrono::system_clock::time_point> deadline_;
    std::shared_ptr<std::atomic_bool> deadline_fired_;
    NativeProgressHandler progress_handler_;
};

using NativeJobFunction = std::function<ArtifactRef(NativeJobContext&)>;

struct NativeJob {
    std::string job_id;
    std::string message_id;
    NativeJobFunction execute;
    std::optional<std::chrono::system_clock::time_point> deadline;
};

struct NativeSubmitResult {
    bool accepted{false};
    std::optional<DeliveryNack> nack;
};

class NativeComputePool {
public:
    NativeComputePool(
        std::size_t worker_count,
        std::size_t queue_capacity,
        NativeProgressHandler progress_handler,
        NativeResultHandler result_handler);
    NativeComputePool(
        const EdgeRuntimeProfile& profile,
        std::size_t worker_count,
        NativeProgressHandler progress_handler,
        NativeResultHandler result_handler);
    ~NativeComputePool();

    NativeComputePool(const NativeComputePool&) = delete;
    NativeComputePool& operator=(const NativeComputePool&) = delete;
    NativeComputePool(NativeComputePool&&) = delete;
    NativeComputePool& operator=(NativeComputePool&&) = delete;

    [[nodiscard]] NativeSubmitResult submit(NativeJob job);
    [[nodiscard]] bool cancel(const std::string& job_id);
    void shutdown(ShutdownMode mode = ShutdownMode::drain);

    [[nodiscard]] WorkerLifecycle lifecycle() const noexcept;
    [[nodiscard]] std::size_t pending_jobs() const;
    [[nodiscard]] std::size_t active_jobs() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace handoffkit::csp
