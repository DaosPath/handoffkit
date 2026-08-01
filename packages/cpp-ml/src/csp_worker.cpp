#include <handoffkit/ml/csp_worker.hpp>

#include <handoffkit/ml/csp_jobs.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>

#include <openssl/evp.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <thread>
#include <utility>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#elif defined(__unix__) || defined(__APPLE__)
#include <unistd.h>
#endif

namespace handoffkit::ml {
namespace {

std::string host_os() {
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

std::string host_architecture() {
#if defined(__aarch64__) || defined(_M_ARM64)
    return "arm64";
#elif defined(__x86_64__) || defined(_M_X64)
    return "x86_64";
#elif defined(__arm__) || defined(_M_ARM)
    return "arm";
#else
    return "unknown";
#endif
}

std::uint64_t physical_memory_bytes() {
#if defined(_WIN32)
    MEMORYSTATUSEX status{};
    status.dwLength = sizeof(status);
    return GlobalMemoryStatusEx(&status) ? status.ullTotalPhys : 0;
#elif defined(_SC_PHYS_PAGES) && defined(_SC_PAGE_SIZE)
    const auto pages = sysconf(_SC_PHYS_PAGES);
    const auto page_size = sysconf(_SC_PAGE_SIZE);
    if (pages <= 0 || page_size <= 0) return 0;
    return static_cast<std::uint64_t>(pages) * static_cast<std::uint64_t>(page_size);
#else
    return 0;
#endif
}

std::string path_from_file_uri(const std::string& uri) {
    constexpr std::string_view prefix = "file://";
    if (!uri.starts_with(prefix)) {
        throw csp::NativeJobFailure(
            "artifact_uri_unsupported", "ML workers accept only local file:// artifacts.");
    }
    std::string path = uri.substr(prefix.size());
#ifdef _WIN32
    if (path.size() >= 3 && path[0] == '/' && path[2] == ':') path.erase(path.begin());
#endif
    return path;
}

std::string file_uri(const std::filesystem::path& path) {
    auto value = std::filesystem::absolute(path).generic_string();
#ifdef _WIN32
    return "file:///" + value;
#else
    return "file://" + value;
#endif
}

std::string sha256_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw csp::NativeJobFailure(
            "artifact_unavailable", "Cannot open artifact: " + path.string());
    }
    EVP_MD_CTX* raw_context = EVP_MD_CTX_new();
    if (raw_context == nullptr) {
        throw csp::NativeJobFailure("crypto_provider_error", "OpenSSL digest context failed.");
    }
    const auto cleanup = [](EVP_MD_CTX* context) { EVP_MD_CTX_free(context); };
    std::unique_ptr<EVP_MD_CTX, decltype(cleanup)> context(raw_context, cleanup);
    if (EVP_DigestInit_ex(context.get(), EVP_sha256(), nullptr) != 1) {
        throw csp::NativeJobFailure("crypto_provider_error", "OpenSSL SHA-256 init failed.");
    }
    std::array<char, 64 * 1024> buffer{};
    while (input) {
        input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const auto count = input.gcount();
        if (count > 0 &&
            EVP_DigestUpdate(context.get(), buffer.data(), static_cast<std::size_t>(count)) != 1) {
            throw csp::NativeJobFailure("crypto_provider_error", "OpenSSL SHA-256 update failed.");
        }
    }
    if (!input.eof()) {
        throw csp::NativeJobFailure("artifact_unavailable", "Cannot read artifact: " + path.string());
    }
    std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
    unsigned int digest_size = 0;
    if (EVP_DigestFinal_ex(context.get(), digest.data(), &digest_size) != 1 ||
        digest_size != 32) {
        throw csp::NativeJobFailure("crypto_provider_error", "OpenSSL SHA-256 final failed.");
    }
    std::ostringstream hex;
    hex << std::hex << std::setfill('0');
    for (unsigned int index = 0; index < digest_size; ++index) {
        hex << std::setw(2) << static_cast<unsigned int>(digest[index]);
    }
    return hex.str();
}

void verify_artifact(const csp::ArtifactRef& artifact) {
    artifact.validate();
    const auto path = std::filesystem::path(path_from_file_uri(artifact.uri));
    std::error_code error;
    if (!std::filesystem::is_regular_file(path, error) || error) {
        throw csp::NativeJobFailure(
            "artifact_unavailable", "Input artifact is not a regular file: " + path.string());
    }
    const auto actual_size = std::filesystem::file_size(path, error);
    if (error || actual_size != artifact.size_bytes) {
        throw csp::NativeJobFailure(
            "artifact_integrity_failed", "Input artifact size does not match ArtifactRef.");
    }
    auto expected = artifact.sha256;
    std::transform(expected.begin(), expected.end(), expected.begin(), [](unsigned char value) {
        return static_cast<char>(std::tolower(value));
    });
    if (sha256_file(path) != expected) {
        throw csp::NativeJobFailure(
            "artifact_integrity_failed", "Input artifact SHA-256 does not match ArtifactRef.");
    }
}

csp::ArtifactRef artifact_from_file(
    std::string artifact_id,
    const std::filesystem::path& path,
    std::string media_type,
    nlohmann::json metadata) {
    std::error_code error;
    const auto size = std::filesystem::file_size(path, error);
    if (error) {
        throw csp::NativeJobFailure(
            "artifact_unavailable", "Output artifact is unavailable: " + path.string());
    }
    csp::ArtifactRef artifact{
        std::move(artifact_id),
        file_uri(path),
        sha256_file(path),
        size,
        std::move(media_type),
        std::move(metadata)};
    artifact.validate();
    return artifact;
}

std::int64_t days_from_civil(int year, unsigned month, unsigned day) {
    year -= month <= 2;
    const auto era = (year >= 0 ? year : year - 399) / 400;
    const auto year_of_era = static_cast<unsigned>(year - era * 400);
    const auto day_of_year =
        (153U * (month > 2 ? month - 3 : month + 9) + 2U) / 5U + day - 1U;
    const auto day_of_era =
        year_of_era * 365U + year_of_era / 4U - year_of_era / 100U + day_of_year;
    return static_cast<std::int64_t>(era) * 146097 + static_cast<std::int64_t>(day_of_era) -
           719468;
}

std::chrono::system_clock::time_point parse_deadline(const std::string& timestamp) {
    static const std::regex pattern(
        R"(^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(Z|([+-])([0-9]{2}):([0-9]{2}))$)");
    std::smatch match;
    if (!std::regex_match(timestamp, match, pattern)) {
        throw std::invalid_argument("deadline must be an RFC 3339 timestamp");
    }
    const int year = std::stoi(match[1].str());
    const auto month = static_cast<unsigned>(std::stoul(match[2].str()));
    const auto day = static_cast<unsigned>(std::stoul(match[3].str()));
    const auto hour = std::stoll(match[4].str());
    const auto minute = std::stoll(match[5].str());
    const auto second = std::stoll(match[6].str());
    std::int64_t offset = 0;
    if (match[8].str() != "Z") {
        offset = (std::stoll(match[10].str()) * 60 + std::stoll(match[11].str())) * 60;
        if (match[9].str() == "-") offset = -offset;
    }
    const auto seconds = days_from_civil(year, month, day) * 86400 + hour * 3600 +
                         minute * 60 + second - offset;
    std::int64_t nanos = 0;
    auto fraction = match[7].str();
    if (!fraction.empty()) {
        if (fraction.size() > 9) fraction.resize(9);
        fraction.append(9 - fraction.size(), '0');
        nanos = std::stoll(fraction);
    }
    return std::chrono::system_clock::time_point{
        std::chrono::seconds(seconds) + std::chrono::nanoseconds(nanos)};
}

std::optional<std::chrono::system_clock::time_point> deadline_for(
    const std::optional<std::string>& deadline) {
    if (!deadline.has_value()) return std::nullopt;
    return parse_deadline(*deadline);
}

bool supports_request(
    const csp::WorkerCapabilities& capabilities,
    const std::vector<std::string>& requested) {
    for (const auto& capability : requested) {
        if (capability == "cpu") continue;
        if (capability == "cuda" && capabilities.cuda) continue;
        if (std::find(capabilities.profiles.begin(), capabilities.profiles.end(), capability) !=
            capabilities.profiles.end()) {
            continue;
        }
        return false;
    }
    return true;
}

csp::NativeSubmitResult rejected(
    const std::string& job_id,
    const std::string& message_id,
    std::string code,
    std::string message) {
    auto result = csp::NativeAckNackAdapter::failure(
        job_id, message_id, std::move(code), std::move(message), false);
    return {false, std::move(result.nack)};
}

}  // namespace

csp::ArtifactRef make_local_artifact_ref(
    std::string artifact_id,
    const std::filesystem::path& path,
    std::string media_type,
    nlohmann::json metadata) {
    return artifact_from_file(
        std::move(artifact_id), path, std::move(media_type), std::move(metadata));
}

void verify_local_artifact(const csp::ArtifactRef& artifact) {
    verify_artifact(artifact);
}

csp::WorkerCapabilities detect_ml_worker_capabilities(
    const std::string& worker_id,
    std::size_t worker_threads) {
    if (worker_id.empty()) throw std::invalid_argument("worker_id must not be empty");
    csp::WorkerCapabilities capabilities;
    capabilities.worker_id = worker_id;
    capabilities.runtime = "cpp-ml";
    capabilities.os = host_os();
    capabilities.architecture = host_architecture();
    capabilities.cpu_cores = std::max(1U, std::thread::hardware_concurrency());
    capabilities.memory_bytes = physical_memory_bytes();
    capabilities.cuda = cuda_rt::available();
    for (const auto& device : cuda_rt::list_devices()) {
        capabilities.cuda_devices.push_back(device.name);
    }
    capabilities.profiles = {"cpu"};
    if (capabilities.cuda) capabilities.profiles.push_back("cuda");
    capabilities.operations = {"job:training", "job:evaluation"};
    capabilities.metadata = {
        {"worker_threads", worker_threads},
        {"cuda_compiled", cuda_rt::compiled()},
        {"cuda_available", capabilities.cuda},
        {"cuda_status", cuda_rt::status_note()}};
    capabilities.validate();
    return capabilities;
}

MlCspWorker::MlCspWorker(
    MlWorkerOptions options,
    csp::NativeProgressHandler progress_handler,
    csp::NativeResultHandler result_handler)
    : capabilities_(detect_ml_worker_capabilities(options.worker_id, options.worker_threads)),
      pool_(std::make_unique<csp::NativeComputePool>(
          options.worker_threads,
          options.queue_capacity,
          std::move(progress_handler),
          std::move(result_handler))) {}

MlCspWorker::~MlCspWorker() = default;

const csp::WorkerCapabilities& MlCspWorker::capabilities() const noexcept {
    return capabilities_;
}

csp::NativeSubmitResult MlCspWorker::submit_training(
    const csp::TrainingJob& job,
    const std::string& message_id) {
    try {
        job.validate();
        if (!supports_request(capabilities_, job.requested_capabilities)) {
            return rejected(
                job.job_id,
                message_id,
                "capability_denied",
                "ML worker does not grant all requested capabilities.");
        }
        const auto deadline = deadline_for(job.deadline);
        return pool_->submit(csp::NativeJob{
            job.job_id,
            message_id,
            [job](csp::NativeJobContext& context) {
                verify_artifact(job.dataset);
                context.throw_if_stopped();
                auto adapted = adapt_training_job(job);
                adapted.config.stop_requested = [&context] { return context.stop_requested(); };
                adapted.config.progress_callback = [&context](int step, int total, float loss) {
                    context.report_progress(
                        "training", "running", step, total, "training step", {}, loss);
                };
                auto result = sft_train(adapted.dataset_path, adapted.output_dir, adapted.config);
                context.throw_if_stopped();
                if (!result.success) {
                    throw csp::NativeJobFailure(
                        "training_failed",
                        result.error.empty() ? "ML training failed." : result.error);
                }
                auto artifact = artifact_from_file(
                    job.job_id + ":checkpoint",
                    result.ckpt_path,
                    "application/vnd.handoffkit.checkpoint",
                    {{"producer", "cpp-ml"},
                     {"device", adapted.config.device},
                     {"steps", result.steps},
                     {"initial_loss", result.initial_loss},
                     {"final_loss", result.final_loss}});
                context.report_progress(
                    "checkpoint", "completed", 1, 1, "checkpoint committed", {artifact});
                return artifact;
            },
            deadline});
    } catch (const std::exception& error) {
        return rejected(job.job_id, message_id, "invalid_training_job", error.what());
    }
}

csp::NativeSubmitResult MlCspWorker::submit_evaluation(
    const csp::EvaluationJob& job,
    const std::string& message_id) {
    try {
        job.validate();
        if (!supports_request(capabilities_, job.requested_capabilities)) {
            return rejected(
                job.job_id,
                message_id,
                "capability_denied",
                "ML worker does not grant all requested capabilities.");
        }
        const auto deadline = deadline_for(job.deadline);
        return pool_->submit(csp::NativeJob{
            job.job_id,
            message_id,
            [job](csp::NativeJobContext& context) {
                verify_artifact(job.model);
                verify_artifact(job.dataset);
                context.throw_if_stopped();
                auto adapted = adapt_evaluation_job(job);
                adapted.config.stop_requested = [&context] { return context.stop_requested(); };
                adapted.config.progress_callback =
                    [&context](int examples, int total, float mean_loss) {
                        context.report_progress(
                            "evaluation",
                            "running",
                            examples,
                            total,
                            "evaluation example",
                            {},
                            mean_loss,
                            {{"mean_loss", mean_loss}});
                    };
                auto result = eval_ckpt_on_jsonl(
                    adapted.model_path, adapted.dataset_path, adapted.config);
                context.throw_if_stopped();
                if (!result.success) {
                    throw csp::NativeJobFailure(
                        "evaluation_failed",
                        result.error.empty() ? "ML evaluation failed." : result.error);
                }
                if (result.report_path.empty()) {
                    throw csp::NativeJobFailure(
                        "evaluation_failed", "ML evaluation did not produce a report artifact.");
                }
                auto artifact = artifact_from_file(
                    job.job_id + ":report",
                    result.report_path,
                    "application/json",
                    {{"producer", "cpp-ml"},
                     {"examples", result.examples},
                     {"tokens", result.tokens},
                     {"mean_loss", result.mean_loss},
                     {"perplexity", result.perplexity}});
                context.report_progress(
                    "evaluation", "completed", 1, 1, "evaluation report committed", {artifact});
                return artifact;
            },
            deadline});
    } catch (const std::exception& error) {
        return rejected(job.job_id, message_id, "invalid_evaluation_job", error.what());
    }
}

bool MlCspWorker::cancel(const std::string& job_id) {
    return pool_->cancel(job_id);
}

void MlCspWorker::shutdown(csp::ShutdownMode mode) {
    pool_->shutdown(mode);
}

}  // namespace handoffkit::ml
