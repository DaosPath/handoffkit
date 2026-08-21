#include <handoffkit/csp/native_compute.hpp>

#include <atomic>
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

// Keep checks active in Release builds; standard assert may erase side effects under NDEBUG.
#undef assert
#define assert(condition)           \
    do {                            \
        if (!(condition)) abort();  \
    } while (false)

using namespace std::chrono_literals;
using handoffkit::csp::ArtifactRef;
using handoffkit::csp::NativeComputePool;
using handoffkit::csp::NativeDeliveryResult;
using handoffkit::csp::NativeJob;
using handoffkit::csp::ShutdownMode;
using handoffkit::csp::WorkerLifecycle;

namespace {

ArtifactRef artifact_for(const std::string& job_id) {
    return ArtifactRef{
        "artifact-" + job_id,
        "file:///tmp/" + job_id + ".bin",
        std::string(64, 'a'),
        4,
        "application/octet-stream",
        nlohmann::json::object()};
}

struct Collector {
    std::mutex mutex;
    std::condition_variable condition;
    std::vector<handoffkit::csp::JobProgress> progress;
    std::vector<NativeDeliveryResult> results;

    void add_progress(const handoffkit::csp::JobProgress& value) {
        std::lock_guard lock(mutex);
        progress.push_back(value);
        condition.notify_all();
    }

    void add_result(const NativeDeliveryResult& value) {
        std::lock_guard lock(mutex);
        results.push_back(value);
        condition.notify_all();
    }

    bool wait_results(std::size_t count, std::chrono::milliseconds timeout = 2s) {
        std::unique_lock lock(mutex);
        return condition.wait_for(lock, timeout, [&] { return results.size() >= count; });
    }

    std::optional<NativeDeliveryResult> result_for(const std::string& job_id) {
        std::lock_guard lock(mutex);
        for (const auto& result : results) {
            if (result.job_id == job_id) return result;
        }
        return std::nullopt;
    }
};

void test_parallel_progress_artifacts_and_ack() {
    Collector collector;
    NativeComputePool pool(
        3,
        8,
        [&](const auto& value) { collector.add_progress(value); },
        [&](const auto& value) { collector.add_result(value); });

    for (int index = 0; index < 6; ++index) {
        const auto id = "parallel-" + std::to_string(index);
        const auto submitted = pool.submit(NativeJob{
            id,
            "message-" + id,
            [id](auto& context) {
                context.report_progress("compute", "running", 1, 2, "started");
                std::this_thread::sleep_for(5ms);
                context.report_progress("compute", "running", 2, 2, "finished");
                return artifact_for(id);
            },
            std::nullopt});
        assert(submitted.accepted);
    }
    assert(collector.wait_results(6));
    pool.shutdown(ShutdownMode::drain);
    assert(pool.lifecycle() == WorkerLifecycle::stopped);
    assert(pool.pending_jobs() == 0);
    assert(pool.active_jobs() == 0);
    {
        std::lock_guard lock(collector.mutex);
        assert(collector.progress.size() == 12);
        for (const auto& result : collector.results) {
            assert(result.succeeded());
            assert(result.ack.has_value());
            assert(result.artifact.has_value());
            assert(!result.nack.has_value());
        }
    }
}

void test_bounded_queue_backpressure() {
    Collector collector;
    std::mutex gate_mutex;
    std::condition_variable gate;
    bool release = false;
    std::atomic_bool first_started{false};
    NativeComputePool pool(
        1,
        1,
        {},
        [&](const auto& value) { collector.add_result(value); });

    auto blocking = [&](std::string id) {
        return NativeJob{
            id,
            "message-" + id,
            [&, id](auto& context) {
                first_started.store(true);
                std::unique_lock lock(gate_mutex);
                gate.wait(lock, [&] { return release || context.stop_requested(); });
                context.throw_if_stopped();
                return artifact_for(id);
            },
            std::nullopt};
    };

    const auto running = pool.submit(blocking("running"));
    assert(running.accepted);
    while (!first_started.load()) std::this_thread::yield();
    const auto queued = pool.submit(blocking("queued"));
    assert(queued.accepted);
    const auto rejected = pool.submit(blocking("rejected"));
    assert(!rejected.accepted);
    assert(rejected.nack.has_value());
    assert(rejected.nack->code == "backpressure");
    assert(rejected.nack->retryable);

    {
        std::lock_guard lock(gate_mutex);
        release = true;
    }
    gate.notify_all();
    assert(collector.wait_results(2));
    pool.shutdown();
}

void test_cancellation_and_deadlines() {
    Collector collector;
    NativeComputePool pool(
        2,
        4,
        {},
        [&](const auto& value) { collector.add_result(value); });

    std::atomic_bool cancellable_started{false};
    const auto cancellable = pool.submit(NativeJob{
        "cancel-me",
        "message-cancel",
        [&](auto& context) -> ArtifactRef {
            cancellable_started.store(true);
            while (true) {
                context.throw_if_stopped();
                std::this_thread::sleep_for(1ms);
            }
        },
        std::nullopt});
    assert(cancellable.accepted);
    while (!cancellable_started.load()) std::this_thread::yield();
    const bool cancellation_requested = pool.cancel("cancel-me");
    assert(cancellation_requested);

    const auto deadline_submit = pool.submit(NativeJob{
        "deadline",
        "message-deadline",
        [](auto& context) -> ArtifactRef {
            while (true) {
                context.throw_if_stopped();
                std::this_thread::sleep_for(1ms);
            }
        },
        std::chrono::system_clock::now() + 25ms});
    assert(deadline_submit.accepted);
    assert(collector.wait_results(2));
    const auto cancelled = collector.result_for("cancel-me");
    const auto deadline = collector.result_for("deadline");
    assert(cancelled.has_value() && cancelled->nack.has_value());
    assert(cancelled->nack->code == "job_cancelled");
    assert(deadline.has_value() && deadline->nack.has_value());
    assert(deadline->nack->code == "deadline_exceeded");

    const auto elapsed = pool.submit(NativeJob{
        "elapsed", "message-elapsed", [](auto&) { return artifact_for("elapsed"); },
        std::chrono::system_clock::now() - 1ms});
    assert(!elapsed.accepted);
    assert(elapsed.nack->code == "deadline_exceeded");
    pool.shutdown();
}

void test_graceful_and_cancel_shutdown() {
    Collector collector;
    NativeComputePool draining(
        1,
        4,
        {},
        [&](const auto& value) { collector.add_result(value); });
    for (int index = 0; index < 3; ++index) {
        const auto id = "drain-" + std::to_string(index);
        const auto submitted = draining.submit(NativeJob{
            id,
            "message-" + id,
            [id](auto& context) {
                context.throw_if_stopped();
                return artifact_for(id);
            },
            std::nullopt});
        assert(submitted.accepted);
    }
    draining.shutdown(ShutdownMode::drain);
    assert(collector.wait_results(3));

    Collector cancelled_collector;
    NativeComputePool cancelling(
        1,
        2,
        {},
        [&](const auto& value) { cancelled_collector.add_result(value); });
    std::atomic_bool started{false};
    const auto shutdown_job = cancelling.submit(NativeJob{
        "shutdown-cancel",
        "message-shutdown-cancel",
        [&](auto& context) -> ArtifactRef {
            started.store(true);
            while (true) {
                context.throw_if_stopped();
                std::this_thread::sleep_for(1ms);
            }
        },
        std::nullopt});
    assert(shutdown_job.accepted);
    while (!started.load()) std::this_thread::yield();
    cancelling.shutdown(ShutdownMode::cancel);
    assert(cancelled_collector.wait_results(1));
    const auto result = cancelled_collector.result_for("shutdown-cancel");
    assert(result.has_value() && result->nack.has_value());
    assert(result->nack->code == "job_cancelled");
    const auto after = cancelling.submit(NativeJob{
        "late", "message-late", [](auto&) { return artifact_for("late"); }, std::nullopt});
    assert(!after.accepted);
    assert(after.nack->code == "worker_shutdown");
}

}  // namespace

int main(int argc, char** argv) {
    const std::string selected = argc > 1 ? argv[1] : "all";
    if (selected == "all" || selected == "parallel") {
        test_parallel_progress_artifacts_and_ack();
    }
    if (selected == "all" || selected == "backpressure") {
        test_bounded_queue_backpressure();
    }
    if (selected == "all" || selected == "cancellation") {
        test_cancellation_and_deadlines();
    }
    if (selected == "all" || selected == "shutdown") {
        test_graceful_and_cancel_shutdown();
    }
    return 0;
}
