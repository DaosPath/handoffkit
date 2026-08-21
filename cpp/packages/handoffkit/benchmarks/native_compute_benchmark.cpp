#include <handoffkit/csp/native_compute.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <numeric>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <vector>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#elif defined(__APPLE__)
#include <sys/sysctl.h>
#elif defined(__linux__)
#include <unistd.h>
#endif

namespace {

using Clock = std::chrono::steady_clock;

double percentile(const std::vector<double>& sorted, double quantile) {
    const auto rank = static_cast<std::size_t>(
        std::max(1.0, std::ceil(static_cast<double>(sorted.size()) * quantile)));
    return sorted[std::min(sorted.size() - 1, rank - 1)];
}

std::string json_escape(std::string_view input) {
    std::string output;
    output.reserve(input.size());
    for (const char value : input) {
        switch (value) {
            case '\\': output += "\\\\"; break;
            case '"': output += "\\\""; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default: output += value; break;
        }
    }
    return output;
}

std::string compiler_name() {
#if defined(__clang__)
    return std::string("clang ") + __clang_version__;
#elif defined(_MSC_VER)
    return "msvc " + std::to_string(_MSC_VER);
#elif defined(__GNUC__)
    return std::string("gcc ") + __VERSION__;
#else
    return "unknown";
#endif
}

constexpr std::string_view os_name() {
#if defined(_WIN32)
    return "windows";
#elif defined(__APPLE__)
    return "macos";
#elif defined(__linux__)
    return "linux";
#else
    return "unknown";
#endif
}

constexpr std::string_view architecture_name() {
#if defined(_M_X64) || defined(__x86_64__)
    return "x86_64";
#elif defined(_M_ARM64) || defined(__aarch64__)
    return "arm64";
#elif defined(_M_IX86) || defined(__i386__)
    return "x86";
#elif defined(__arm__)
    return "arm";
#else
    return "unknown";
#endif
}

std::string cpu_model() {
#if defined(_WIN32)
    const char* value = std::getenv("PROCESSOR_IDENTIFIER");
    return value == nullptr ? "unknown" : value;
#elif defined(__APPLE__)
    char value[256]{};
    std::size_t size = sizeof(value);
    return sysctlbyname("machdep.cpu.brand_string", value, &size, nullptr, 0) == 0
               ? std::string(value)
               : "unknown";
#elif defined(__linux__)
    std::ifstream input("/proc/cpuinfo");
    std::string line;
    while (std::getline(input, line)) {
        if (line.rfind("model name", 0) != 0 && line.rfind("Hardware", 0) != 0) continue;
        const auto separator = line.find(':');
        if (separator == std::string::npos) continue;
        const auto first = line.find_first_not_of(" \t", separator + 1);
        return first == std::string::npos ? "unknown" : line.substr(first);
    }
    return "unknown";
#else
    return "unknown";
#endif
}

std::uint64_t total_memory_bytes() {
#if defined(_WIN32)
    MEMORYSTATUSEX status{};
    status.dwLength = sizeof(status);
    return GlobalMemoryStatusEx(&status) != 0 ? status.ullTotalPhys : 0;
#elif defined(__APPLE__)
    std::uint64_t value = 0;
    std::size_t size = sizeof(value);
    return sysctlbyname("hw.memsize", &value, &size, nullptr, 0) == 0 ? value : 0;
#elif defined(__linux__)
    const long pages = sysconf(_SC_PHYS_PAGES);
    const long page_size = sysconf(_SC_PAGE_SIZE);
    if (pages <= 0 || page_size <= 0) return 0;
    return static_cast<std::uint64_t>(pages) * static_cast<std::uint64_t>(page_size);
#else
    return 0;
#endif
}

}  // namespace

int main(int argc, char** argv) {
    using namespace handoffkit::csp;
    const std::size_t job_count = argc > 1 ? std::stoull(argv[1]) : 2000;
    const std::size_t worker_count = std::max(
        1U, std::min(4U, std::thread::hardware_concurrency()));
    constexpr std::size_t queue_capacity = 16;
    if (job_count < 10) return 2;
    const std::size_t warmup_count = std::min<std::size_t>(
        100, std::max<std::size_t>(10, job_count / 10));

    auto make_job = [](std::string id, std::size_t index) {
        return NativeJob{
            id,
            "message-" + id,
            [id, index](NativeJobContext& context) {
                std::uint64_t value = index + 1;
                for (std::uint64_t round = 0; round < 4000; ++round) {
                    value = (value * 6364136223846793005ULL) + round;
                    if ((round & 511U) == 0) context.throw_if_stopped();
                }
                return ArtifactRef{
                    "artifact-" + id,
                    "memory://" + id,
                    std::string(64, 'a'),
                    sizeof(value),
                    "application/octet-stream",
                    {{"checksum", value}}};
            },
            std::nullopt};
    };

    {
        std::mutex warmup_mutex;
        std::condition_variable warmup_condition;
        std::atomic_size_t warmup_completed{0};
        std::atomic_size_t warmup_failures{0};
        NativeComputePool warmup_pool(
            worker_count,
            queue_capacity,
            {},
            [&](const NativeDeliveryResult& result) {
                if (!result.succeeded()) ++warmup_failures;
                ++warmup_completed;
                warmup_condition.notify_all();
            });
        for (std::size_t index = 0; index < warmup_count; ++index) {
            while (!warmup_pool.submit(make_job("warmup-" + std::to_string(index), index)).accepted) {
                std::this_thread::yield();
            }
        }
        std::unique_lock lock(warmup_mutex);
        if (!warmup_condition.wait_for(lock, std::chrono::seconds(10), [&] {
                return warmup_completed.load() == warmup_count;
            })) {
            return 6;
        }
        warmup_pool.shutdown(ShutdownMode::drain);
        if (warmup_failures.load() != 0) return 7;
    }

    std::mutex mutex;
    std::condition_variable condition;
    std::unordered_map<std::string, Clock::time_point> submitted_at;
    std::vector<double> latencies;
    latencies.reserve(job_count);
    std::atomic_size_t completed{0};
    std::atomic_size_t failures{0};
    std::atomic_size_t backpressure{0};
    std::atomic_size_t peak_pending{0};

    NativeComputePool pool(
        worker_count,
        queue_capacity,
        {},
        [&](const NativeDeliveryResult& result) {
            const auto finished = Clock::now();
            std::lock_guard lock(mutex);
            const auto found = submitted_at.find(result.job_id);
            if (found == submitted_at.end() || !result.succeeded()) {
                ++failures;
            } else {
                latencies.push_back(std::chrono::duration<double, std::milli>(
                                        finished - found->second)
                                        .count());
            }
            ++completed;
            condition.notify_all();
        });

    const auto benchmark_started = Clock::now();
    for (std::size_t index = 0; index < job_count; ++index) {
        const auto id = "benchmark-" + std::to_string(index);
        {
            std::lock_guard lock(mutex);
            submitted_at.emplace(id, Clock::now());
        }
        while (true) {
            auto result = pool.submit(make_job(id, index));
            if (result.accepted) break;
            if (!result.nack.has_value() || result.nack->code != "backpressure") return 3;
            ++backpressure;
            std::this_thread::yield();
        }
        const auto pending = pool.pending_jobs() + pool.active_jobs();
        auto previous = peak_pending.load();
        while (pending > previous && !peak_pending.compare_exchange_weak(previous, pending)) {}
    }

    {
        std::unique_lock lock(mutex);
        if (!condition.wait_for(lock, std::chrono::seconds(30), [&] {
                return completed.load() == job_count;
            })) {
            return 4;
        }
    }
    pool.shutdown(ShutdownMode::drain);
    const auto elapsed = std::chrono::duration<double>(Clock::now() - benchmark_started).count();
    if (failures.load() != 0 || latencies.size() != job_count) return 5;
    std::sort(latencies.begin(), latencies.end());
    const auto total_latency =
        std::accumulate(latencies.begin(), latencies.end(), 0.0);

    std::cout << std::fixed << std::setprecision(6)
              << "{\n"
              << "  \"notice\": \"environmental measurement \\u2014 not a performance guarantee\",\n"
              << "  \"runtime\": \"cpp\",\n"
              << "  \"benchmark\": \"native_compute\",\n"
              << "  \"environment\": {\n"
              << "    \"cpu\": \"" << json_escape(cpu_model()) << "\",\n"
              << "    \"logical_cpus\": " << std::thread::hardware_concurrency() << ",\n"
              << "    \"ram_bytes\": " << total_memory_bytes() << ",\n"
              << "    \"os\": \"" << os_name() << "\",\n"
              << "    \"architecture\": \"" << architecture_name() << "\",\n"
              << "    \"compiler\": \"" << json_escape(compiler_name()) << "\",\n"
              << "    \"cpp_standard\": " << __cplusplus << ",\n"
#if defined(NDEBUG)
              << "    \"build_mode\": \"Release\"\n"
#else
              << "    \"build_mode\": \"Debug\"\n"
#endif
              << "  },\n"
              << "  \"parameters\": {\n"
              << "    \"samples\": " << job_count << ",\n"
              << "    \"warmup\": " << warmup_count << ",\n"
              << "    \"payload\": \"synthetic compute plus ArtifactRef\",\n"
              << "    \"concurrency\": " << worker_count << ",\n"
              << "    \"queue_capacity\": " << queue_capacity << "\n"
              << "  },\n"
              << "  \"jobs\": " << job_count << ",\n"
              << "  \"workers\": " << worker_count << ",\n"
              << "  \"queue_capacity\": " << queue_capacity << ",\n"
              << "  \"elapsed_seconds\": " << elapsed << ",\n"
              << "  \"throughput_jobs_per_second\": "
              << static_cast<double>(job_count) / elapsed << ",\n"
              << "  \"latency_ms\": {\n"
              << "    \"mean\": " << total_latency / static_cast<double>(job_count) << ",\n"
              << "    \"p50\": " << percentile(latencies, 0.50) << ",\n"
              << "    \"p95\": " << percentile(latencies, 0.95) << ",\n"
              << "    \"p99\": " << percentile(latencies, 0.99) << "\n"
              << "  },\n"
              << "  \"peak_pending_jobs\": " << peak_pending.load() << ",\n"
              << "  \"backpressure_rejections\": " << backpressure.load() << "\n"
              << "}\n";
    return 0;
}
