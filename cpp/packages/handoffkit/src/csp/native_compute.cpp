#include <handoffkit/csp/native_compute.hpp>
#include <handoffkit/csp/security.hpp>

#include <condition_variable>
#include <ctime>
#include <deque>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <thread>
#include <unordered_map>
#include <utility>

namespace handoffkit::csp {
namespace {

std::string utc_now() {
    const auto now = std::chrono::system_clock::now();
    const auto seconds = std::chrono::system_clock::to_time_t(now);
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &seconds);
#else
    gmtime_r(&seconds, &utc);
#endif
    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return output.str();
}

DeliveryNack make_nack(
    const std::string& message_id,
    std::string code,
    std::string message,
    bool retryable) {
    return DeliveryNack{
        message_id,
        std::move(code),
        std::move(message),
        retryable,
        utc_now(),
        nlohmann::json::object()};
}

std::size_t edge_queue_capacity(const EdgeRuntimeProfile& profile) {
    profile.validate();
    return profile.channel_capacity;
}

}  // namespace

NativeDeliveryResult NativeAckNackAdapter::success(
    const std::string& job_id,
    const std::string& message_id,
    ArtifactRef artifact) {
    artifact.validate();
    DeliveryAck ack{
        message_id,
        utc_now(),
        {{"job_id", job_id}, {"artifact_id", artifact.artifact_id}}};
    ack.validate();
    return NativeDeliveryResult{job_id, std::move(artifact), std::move(ack), std::nullopt};
}

NativeDeliveryResult NativeAckNackAdapter::failure(
    const std::string& job_id,
    const std::string& message_id,
    std::string code,
    std::string message,
    bool retryable) {
    auto nack = make_nack(message_id, std::move(code), std::move(message), retryable);
    nack.metadata = {{"job_id", job_id}};
    nack.validate();
    return NativeDeliveryResult{job_id, std::nullopt, std::nullopt, std::move(nack)};
}

NativeJobInterrupted::NativeJobInterrupted(std::string code, std::string message)
    : std::runtime_error(std::move(message)), code_(std::move(code)) {}

NativeJobFailure::NativeJobFailure(std::string code, std::string message, bool retryable)
    : std::runtime_error(std::move(message)),
      code_(std::move(code)),
      retryable_(retryable) {}

NativeJobContext::NativeJobContext(
    std::string job_id,
    std::stop_token stop_token,
    std::optional<std::chrono::system_clock::time_point> deadline,
    std::shared_ptr<std::atomic_bool> deadline_fired,
    NativeProgressHandler progress_handler)
    : job_id_(std::move(job_id)),
      stop_token_(stop_token),
      deadline_(deadline),
      deadline_fired_(std::move(deadline_fired)),
      progress_handler_(std::move(progress_handler)) {}

bool NativeJobContext::deadline_exceeded() const noexcept {
    return deadline_fired_->load(std::memory_order_acquire) ||
           (deadline_.has_value() && std::chrono::system_clock::now() >= *deadline_);
}

bool NativeJobContext::stop_requested() const noexcept {
    return stop_token_.stop_requested() || deadline_exceeded();
}

void NativeJobContext::throw_if_stopped() const {
    if (deadline_exceeded()) {
        throw NativeJobInterrupted("deadline_exceeded", "Native job deadline exceeded.");
    }
    if (stop_token_.stop_requested()) {
        throw NativeJobInterrupted("job_cancelled", "Native job was cancelled.");
    }
}

void NativeJobContext::report_progress(
    std::string phase,
    std::string status,
    std::uint64_t step,
    std::uint64_t total_steps,
    std::string message,
    std::vector<ArtifactRef> artifacts,
    std::optional<double> loss,
    nlohmann::json metrics) const {
    throw_if_stopped();
    JobProgress progress;
    progress.job_id = job_id_;
    progress.phase = std::move(phase);
    progress.status = std::move(status);
    progress.step = step;
    progress.total_steps = total_steps;
    progress.progress = total_steps == 0
                            ? 0.0
                            : static_cast<double>(step) / static_cast<double>(total_steps);
    progress.loss = loss;
    progress.metrics = std::move(metrics);
    progress.message = std::move(message);
    progress.timestamp = utc_now();
    progress.artifacts = std::move(artifacts);
    progress.validate();
    if (progress_handler_) progress_handler_(progress);
}

struct NativeComputePool::Impl {
    struct Record {
        NativeJob job;
        std::stop_source stop_source;
        std::shared_ptr<std::atomic_bool> deadline_fired{
            std::make_shared<std::atomic_bool>(false)};
    };

    explicit Impl(
        std::size_t worker_count,
        std::size_t capacity,
        NativeProgressHandler progress,
        NativeResultHandler result)
        : queue_capacity(capacity),
          progress_handler(std::move(progress)),
          result_handler(std::move(result)) {
        if (worker_count == 0) throw std::invalid_argument("worker_count must be at least 1");
        if (queue_capacity == 0) throw std::invalid_argument("queue_capacity must be at least 1");
        workers.reserve(worker_count);
        for (std::size_t index = 0; index < worker_count; ++index) {
            workers.emplace_back([this](std::stop_token worker_stop) { run(worker_stop); });
        }
    }

    void emit_result(const NativeDeliveryResult& result) noexcept {
        if (!result_handler) return;
        try {
            result_handler(result);
        } catch (...) {
            // A consumer callback must not terminate a worker thread.
        }
    }

    void finish(const std::shared_ptr<Record>& record, NativeDeliveryResult result) {
        {
            std::lock_guard lock(mutex);
            records.erase(record->job.job_id);
            --active;
        }
        emit_result(result);
        condition.notify_all();
    }

    void run(std::stop_token worker_stop) {
        while (true) {
            std::shared_ptr<Record> record;
            {
                std::unique_lock lock(mutex);
                condition.wait(lock, [&] {
                    return worker_stop.stop_requested() || !queue.empty() || !accepting;
                });
                if (queue.empty()) {
                    if (!accepting || worker_stop.stop_requested()) return;
                    continue;
                }
                record = queue.front();
                queue.pop_front();
                ++active;
                condition.notify_all();
            }

            std::jthread deadline_monitor;
            if (record->job.deadline.has_value()) {
                const auto deadline = *record->job.deadline;
                deadline_monitor = std::jthread(
                    [record, deadline](std::stop_token monitor_stop) {
                        std::mutex wait_mutex;
                        std::condition_variable_any wait_condition;
                        std::unique_lock wait_lock(wait_mutex);
                        const bool deadline_reached = !wait_condition.wait_until(
                            wait_lock, monitor_stop, deadline, [] { return false; });
                        if (deadline_reached && !monitor_stop.stop_requested()) {
                            record->deadline_fired->store(true, std::memory_order_release);
                            record->stop_source.request_stop();
                        }
                    });
            }

            NativeDeliveryResult result;
            try {
                NativeJobContext context{
                    record->job.job_id,
                    record->stop_source.get_token(),
                    record->job.deadline,
                    record->deadline_fired,
                    progress_handler};
                context.throw_if_stopped();
                auto artifact = record->job.execute(context);
                context.throw_if_stopped();
                result = NativeAckNackAdapter::success(
                    record->job.job_id, record->job.message_id, std::move(artifact));
            } catch (const NativeJobInterrupted& error) {
                result = NativeAckNackAdapter::failure(
                    record->job.job_id,
                    record->job.message_id,
                    error.code(),
                    error.what(),
                    false);
            } catch (const NativeJobFailure& error) {
                result = NativeAckNackAdapter::failure(
                    record->job.job_id,
                    record->job.message_id,
                    error.code(),
                    error.what(),
                    error.retryable());
            } catch (const SecurityError& error) {
                result = NativeAckNackAdapter::failure(
                    record->job.job_id,
                    record->job.message_id,
                    error.code(),
                    error.what(),
                    false);
            } catch (const std::exception& error) {
                result = NativeAckNackAdapter::failure(
                    record->job.job_id,
                    record->job.message_id,
                    "native_job_failed",
                    error.what(),
                    false);
            } catch (...) {
                result = NativeAckNackAdapter::failure(
                    record->job.job_id,
                    record->job.message_id,
                    "native_job_failed",
                    "Native job failed with a non-standard exception.",
                    false);
            }
            if (deadline_monitor.joinable()) {
                deadline_monitor.request_stop();
                deadline_monitor.join();
            }
            finish(record, std::move(result));
        }
    }

    const std::size_t queue_capacity;
    NativeProgressHandler progress_handler;
    NativeResultHandler result_handler;
    mutable std::mutex mutex;
    std::condition_variable condition;
    std::deque<std::shared_ptr<Record>> queue;
    std::unordered_map<std::string, std::shared_ptr<Record>> records;
    std::vector<std::jthread> workers;
    std::size_t active{0};
    bool accepting{true};
    WorkerLifecycle state{WorkerLifecycle::running};
};

NativeComputePool::NativeComputePool(
    std::size_t worker_count,
    std::size_t queue_capacity,
    NativeProgressHandler progress_handler,
    NativeResultHandler result_handler)
    : impl_(std::make_unique<Impl>(
          worker_count,
          queue_capacity,
          std::move(progress_handler),
          std::move(result_handler))) {}

NativeComputePool::NativeComputePool(
    const EdgeRuntimeProfile& profile,
    std::size_t worker_count,
    NativeProgressHandler progress_handler,
    NativeResultHandler result_handler)
    : NativeComputePool(
          worker_count,
          edge_queue_capacity(profile),
          std::move(progress_handler),
          std::move(result_handler)) {}

NativeComputePool::~NativeComputePool() {
    if (impl_) shutdown(ShutdownMode::cancel);
}

NativeSubmitResult NativeComputePool::submit(NativeJob job) {
    if (job.job_id.empty()) throw std::invalid_argument("job_id must not be empty");
    if (job.message_id.empty()) throw std::invalid_argument("message_id must not be empty");
    if (!job.execute) throw std::invalid_argument("execute callback must be provided");

    std::lock_guard lock(impl_->mutex);
    if (!impl_->accepting) {
        return {false, make_nack(
                           job.message_id,
                           "worker_shutdown",
                           "Native worker pool is not accepting jobs.",
                           false)};
    }
    if (impl_->records.contains(job.job_id)) {
        return {false, make_nack(
                           job.message_id,
                           "duplicate_job",
                           "A native job with this job_id is already queued or running.",
                           false)};
    }
    if (job.deadline.has_value() && std::chrono::system_clock::now() >= *job.deadline) {
        return {false, make_nack(
                           job.message_id,
                           "deadline_exceeded",
                           "Native job deadline has already elapsed.",
                           false)};
    }
    if (impl_->queue.size() >= impl_->queue_capacity) {
        return {false, make_nack(
                           job.message_id,
                           "backpressure",
                           "Native worker queue is full.",
                           true)};
    }
    auto record = std::make_shared<Impl::Record>();
    record->job = std::move(job);
    impl_->records.emplace(record->job.job_id, record);
    impl_->queue.push_back(std::move(record));
    impl_->condition.notify_one();
    return {true, std::nullopt};
}

bool NativeComputePool::cancel(const std::string& job_id) {
    std::lock_guard lock(impl_->mutex);
    const auto found = impl_->records.find(job_id);
    if (found == impl_->records.end()) return false;
    found->second->stop_source.request_stop();
    impl_->condition.notify_all();
    return true;
}

void NativeComputePool::shutdown(ShutdownMode mode) {
    {
        std::lock_guard lock(impl_->mutex);
        if (impl_->state == WorkerLifecycle::stopped) return;
        impl_->accepting = false;
        impl_->state = mode == ShutdownMode::drain
                           ? WorkerLifecycle::draining
                           : WorkerLifecycle::stopping;
        if (mode == ShutdownMode::cancel) {
            for (const auto& [job_id, record] : impl_->records) {
                (void)job_id;
                record->stop_source.request_stop();
            }
        }
    }
    impl_->condition.notify_all();
    for (auto& worker : impl_->workers) {
        if (worker.joinable()) worker.join();
    }
    impl_->workers.clear();
    {
        std::lock_guard lock(impl_->mutex);
        impl_->state = WorkerLifecycle::stopped;
    }
}

WorkerLifecycle NativeComputePool::lifecycle() const noexcept {
    std::lock_guard lock(impl_->mutex);
    return impl_->state;
}

std::size_t NativeComputePool::pending_jobs() const {
    std::lock_guard lock(impl_->mutex);
    return impl_->queue.size();
}

std::size_t NativeComputePool::active_jobs() const {
    std::lock_guard lock(impl_->mutex);
    return impl_->active;
}

}  // namespace handoffkit::csp
