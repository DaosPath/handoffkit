#include <handoffkit/ml/csp_worker.hpp>
#include <handoffkit/ml/data.hpp>

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#define REQUIRE(condition)                                                        \
    do {                                                                          \
        if (!(condition)) {                                                       \
            std::cerr << "requirement failed at line " << __LINE__ << ": "       \
                      << #condition << '\n';                                      \
            abort();                                                              \
        }                                                                         \
    } while (false)

using namespace std::chrono_literals;
namespace fs = std::filesystem;

namespace {

std::string file_uri(const fs::path& path) {
    const auto value = fs::absolute(path).generic_string();
#ifdef _WIN32
    return "file:///" + value;
#else
    return "file://" + value;
#endif
}

std::string rfc3339_after(std::chrono::milliseconds delay) {
    const auto value = std::chrono::system_clock::now() + delay;
    const auto seconds = std::chrono::time_point_cast<std::chrono::seconds>(value);
    const auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(value - seconds);
    const auto time = std::chrono::system_clock::to_time_t(seconds);
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &time);
#else
    gmtime_r(&time, &utc);
#endif
    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%S") << '.' << std::setfill('0')
           << std::setw(3) << millis.count() << 'Z';
    return output.str();
}

struct Collector {
    std::mutex mutex;
    std::condition_variable condition;
    std::vector<handoffkit::csp::JobProgress> progress;
    std::vector<handoffkit::csp::NativeDeliveryResult> results;

    void add_progress(const handoffkit::csp::JobProgress& value) {
        std::lock_guard lock(mutex);
        progress.push_back(value);
        condition.notify_all();
    }

    void add_result(const handoffkit::csp::NativeDeliveryResult& value) {
        std::lock_guard lock(mutex);
        results.push_back(value);
        condition.notify_all();
    }

    bool wait_result_count(std::size_t count, std::chrono::seconds timeout = 20s) {
        std::unique_lock lock(mutex);
        return condition.wait_for(lock, timeout, [&] { return results.size() >= count; });
    }

    bool wait_for_progress(const std::string& job_id, std::chrono::seconds timeout = 10s) {
        std::unique_lock lock(mutex);
        return condition.wait_for(lock, timeout, [&] {
            for (const auto& value : progress) {
                if (value.job_id == job_id) return true;
            }
            return false;
        });
    }

    std::optional<handoffkit::csp::NativeDeliveryResult> result_for(
        const std::string& job_id) {
        std::lock_guard lock(mutex);
        for (const auto& value : results) {
            if (value.job_id == job_id) return value;
        }
        return std::nullopt;
    }
};

handoffkit::csp::TrainingJob training_job(
    const std::string& id,
    const handoffkit::csp::ArtifactRef& dataset,
    const fs::path& output,
    int epochs) {
    handoffkit::csp::TrainingJob job;
    job.job_id = id;
    job.dataset = dataset;
    job.output = file_uri(output);
    job.config = {
        {"epochs", epochs},
        {"block_size", 16},
        {"n_embd", 16},
        {"n_head", 2},
        {"n_layer", 1},
        {"lr", 0.01},
        {"allow_tiny", true},
        {"require_loss_drop", false},
        {"tokenizer", "byte"},
        {"device", "cpu"},
        {"profile", "test"}};
    job.requested_capabilities = {"cpu"};
    job.idempotency_key = "idem-" + id;
    return job;
}

}  // namespace

int main() {
    const auto scratch = fs::current_path() / "test_artifacts_ml_csp_worker";
    std::error_code error;
    fs::remove_all(scratch, error);
    fs::create_directories(scratch, error);
    REQUIRE(!error);
    const auto dataset_path = scratch / "data.jsonl";
    REQUIRE(handoffkit::ml::write_sft_jsonl(
        dataset_path.string(), {{"P:", " MARK42"}, {"Q:", " ANSWER"}}));
    const auto dataset = handoffkit::ml::make_local_artifact_ref(
        "dataset-1", dataset_path, "application/x-ndjson");
    handoffkit::ml::verify_local_artifact(dataset);

    Collector collector;
    auto artifact_policy = std::make_shared<handoffkit::csp::ArtifactIngestionPolicy>();
    artifact_policy->allowed_roots = {scratch};
    artifact_policy->snapshot_directory = scratch / "verified-snapshots";
    artifact_policy->quarantine_directory = scratch / "quarantine";
    artifact_policy->allowed_media_types = {
        "application/x-ndjson",
        "application/vnd.handoffkit.checkpoint"};
    artifact_policy->max_size_bytes = 16 * 1024 * 1024;
    handoffkit::ml::MlCspWorker worker(
        {"ml-worker-1", 1, 4, artifact_policy},
        [&](const auto& value) { collector.add_progress(value); },
        [&](const auto& value) { collector.add_result(value); });
    const auto& capabilities = worker.capabilities();
    REQUIRE(capabilities.runtime == "cpp-ml");
    REQUIRE(capabilities.cpu_cores >= 1);
    REQUIRE(capabilities.memory_bytes > 0);
    REQUIRE(capabilities.metadata.contains("cuda_compiled"));
    REQUIRE(capabilities.metadata.contains("cuda_available"));
    REQUIRE(capabilities.metadata.at("artifact_gate") == "sha256-policy-snapshot");
    REQUIRE(capabilities.metadata.at("artifact_allowed_roots") == 1);
    REQUIRE(capabilities.metadata.at("cuda_available").get<bool>() == capabilities.cuda);
    REQUIRE(capabilities.operations.size() == 2);

    auto train = training_job("train-real", dataset, scratch / "train-out", 4);
    const auto train_submit = worker.submit_training(train, "message-train");
    REQUIRE(train_submit.accepted);
    REQUIRE(collector.wait_result_count(1));
    const auto train_result = collector.result_for("train-real");
    REQUIRE(train_result.has_value());
    if (train_result->nack.has_value()) {
        std::cerr << "training nack " << train_result->nack->code << ": "
                  << train_result->nack->message << '\n';
    }
    REQUIRE(train_result->succeeded());
    REQUIRE(train_result->artifact.has_value());
    handoffkit::ml::verify_local_artifact(*train_result->artifact);

    handoffkit::csp::EvaluationJob evaluation;
    evaluation.job_id = "eval-real";
    evaluation.model = *train_result->artifact;
    evaluation.dataset = dataset;
    evaluation.output = file_uri(scratch / "eval-out");
    evaluation.config = {{"tokenizer", "byte"}, {"block_size", 16}};
    evaluation.requested_capabilities = {"cpu"};
    evaluation.idempotency_key = "idem-eval-real";
    const auto eval_submit = worker.submit_evaluation(evaluation, "message-eval");
    REQUIRE(eval_submit.accepted);
    REQUIRE(collector.wait_result_count(2));
    const auto eval_result = collector.result_for("eval-real");
    REQUIRE(eval_result.has_value() && eval_result->succeeded());
    REQUIRE(eval_result->artifact->media_type == "application/json");
    handoffkit::ml::verify_local_artifact(*eval_result->artifact);

    auto tampered_dataset = dataset;
    tampered_dataset.sha256[0] = tampered_dataset.sha256[0] == '0' ? '1' : '0';
    auto bad = training_job("bad-integrity", tampered_dataset, scratch / "bad-out", 1);
    const auto bad_submit = worker.submit_training(bad, "message-bad");
    REQUIRE(bad_submit.accepted);
    REQUIRE(collector.wait_result_count(3));
    const auto bad_result = collector.result_for("bad-integrity");
    REQUIRE(bad_result.has_value() && bad_result->nack.has_value());
    REQUIRE(bad_result->nack->code == "artifact_integrity_mismatch");

    auto denied_media = dataset;
    denied_media.media_type = "application/octet-stream";
    auto media_job = training_job("bad-media", denied_media, scratch / "bad-media-out", 1);
    const auto media_submit = worker.submit_training(media_job, "message-bad-media");
    REQUIRE(media_submit.accepted);
    REQUIRE(collector.wait_result_count(4));
    const auto media_result = collector.result_for("bad-media");
    REQUIRE(media_result.has_value() && media_result->nack.has_value());
    REQUIRE(media_result->nack->code == "artifact_media_type_denied");

    auto denied = training_job("denied", dataset, scratch / "denied-out", 1);
    denied.requested_capabilities = {"tpu"};
    const auto denied_submit = worker.submit_training(denied, "message-denied");
    REQUIRE(!denied_submit.accepted);
    REQUIRE(denied_submit.nack->code == "capability_denied");

    auto cancellable = training_job("cancel-real", dataset, scratch / "cancel-out", 100000);
    const auto cancel_submit = worker.submit_training(cancellable, "message-cancel");
    REQUIRE(cancel_submit.accepted);
    REQUIRE(collector.wait_for_progress("cancel-real"));
    REQUIRE(worker.cancel("cancel-real"));
    REQUIRE(collector.wait_result_count(5));
    const auto cancel_result = collector.result_for("cancel-real");
    REQUIRE(cancel_result.has_value() && cancel_result->nack.has_value());
    REQUIRE(cancel_result->nack->code == "job_cancelled");

    auto deadline = training_job("deadline-real", dataset, scratch / "deadline-out", 100000);
    deadline.deadline = rfc3339_after(200ms);
    const auto deadline_submit = worker.submit_training(deadline, "message-deadline");
    REQUIRE(deadline_submit.accepted);
    REQUIRE(collector.wait_result_count(6));
    const auto deadline_result = collector.result_for("deadline-real");
    REQUIRE(deadline_result.has_value() && deadline_result->nack.has_value());
    REQUIRE(deadline_result->nack->code == "deadline_exceeded");

    {
        std::lock_guard lock(collector.mutex);
        bool checkpoint_progress = false;
        bool evaluation_progress = false;
        for (const auto& progress : collector.progress) {
            if (progress.job_id == "train-real" && !progress.artifacts.empty()) {
                checkpoint_progress = true;
            }
            if (progress.job_id == "eval-real") evaluation_progress = true;
        }
        REQUIRE(checkpoint_progress);
        REQUIRE(evaluation_progress);
    }
    worker.shutdown();
    return 0;
}
