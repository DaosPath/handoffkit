#include <handoffkit/ml/csp_worker.hpp>

#include <atomic>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace fs = std::filesystem;

namespace {

struct WorkerConfig {
    std::string worker_id;
    std::size_t worker_threads{1};
    std::size_t queue_capacity{8};
    fs::path output_root;
    std::shared_ptr<handoffkit::csp::ArtifactIngestionPolicy> artifact_policy;
};

std::string utc_now() {
    const auto now = std::chrono::system_clock::now();
    const auto seconds = std::chrono::time_point_cast<std::chrono::seconds>(now);
    const auto fraction = std::chrono::duration_cast<std::chrono::milliseconds>(now - seconds);
    const auto raw = std::chrono::system_clock::to_time_t(seconds);
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &raw);
#else
    gmtime_r(&raw, &utc);
#endif
    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%S") << '.' << std::setfill('0')
           << std::setw(3) << fraction.count() << 'Z';
    return output.str();
}

std::string safe_component(const std::string& value) {
    std::string result;
    result.reserve(value.size());
    for (const auto character : value) {
        if (std::isalnum(static_cast<unsigned char>(character)) || character == '-' ||
            character == '_') {
            result.push_back(character);
        }
    }
    if (result.empty() || result.size() > 128) {
        throw std::invalid_argument("job_id cannot form a safe output directory");
    }
    return result;
}

std::string file_uri(const fs::path& path) {
    const auto value = fs::absolute(path).generic_string();
#if defined(_WIN32)
    return "file:///" + value;
#else
    return "file://" + value;
#endif
}

nlohmann::json read_json(const fs::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("worker policy cannot be opened");
    nlohmann::json value;
    input >> value;
    if (!input.eof() && input.fail()) throw std::runtime_error("worker policy is invalid JSON");
    return value;
}

std::vector<std::string> string_array(
    const nlohmann::json& value,
    const char* name) {
    if (!value.contains(name)) return {};
    if (!value.at(name).is_array()) throw std::invalid_argument(std::string(name) + " must be an array");
    return value.at(name).get<std::vector<std::string>>();
}

WorkerConfig load_config(const fs::path& policy_path) {
    const auto value = read_json(policy_path);
    if (!value.is_object() || value.value("format", std::string{}) !=
                                  "handoffkit-cpp-ml-worker-policy" ||
        value.value("version", 0) != 1) {
        throw std::invalid_argument("unsupported cpp-ml worker policy format");
    }
    WorkerConfig config;
    config.worker_id = value.at("worker_id").get<std::string>();
    config.worker_threads = value.value("worker_threads", std::size_t{1});
    config.queue_capacity = value.value("queue_capacity", std::size_t{8});
    config.output_root = fs::absolute(value.at("output_root").get<std::string>());
    fs::create_directories(config.output_root);

    auto policy = std::make_shared<handoffkit::csp::ArtifactIngestionPolicy>();
    policy->hash_required = value.value("hash_required", true);
    const auto signature_requirement =
        value.value("signature_requirement", std::string{"optional"});
    if (signature_requirement == "required") {
        policy->signature_requirement =
            handoffkit::csp::ArtifactSignatureRequirement::Required;
    } else if (signature_requirement != "optional") {
        throw std::invalid_argument("signature_requirement must be optional or required");
    }
    for (const auto& producer : string_array(value, "trusted_producers")) {
        policy->trusted_producers.insert(producer);
    }
    for (const auto& signer : string_array(value, "trusted_signers")) {
        policy->trusted_signers.insert(signer);
    }
    for (const auto& media_type : string_array(value, "allowed_media_types")) {
        policy->allowed_media_types.insert(media_type);
    }
    policy->max_size_bytes = value.at("max_size_bytes").get<std::uint64_t>();
    for (const auto& root : string_array(value, "allowed_roots")) {
        policy->allowed_roots.emplace_back(root);
    }
    policy->snapshot_directory = value.at("snapshot_directory").get<std::string>();
    if (value.contains("quarantine_directory") &&
        !value.at("quarantine_directory").is_null()) {
        policy->quarantine_directory = value.at("quarantine_directory").get<std::string>();
    }

    std::vector<handoffkit::csp::ArtifactSigningCredential> credentials;
    for (const auto& item : value.value("signing_credentials", nlohmann::json::array())) {
        credentials.push_back({
            item.at("signer_identity").get<std::string>(),
            item.at("public_key_pem").get<std::string>(),
            item.value("valid_from", std::int64_t{0}),
            item.value("valid_until", std::int64_t{0}),
            item.value("revoked", false)});
    }
    if (!credentials.empty()) {
        policy->signature_policy =
            std::make_shared<handoffkit::csp::ArtifactTrustPolicy>(std::move(credentials));
    }
    policy->validate();
    config.artifact_policy = std::move(policy);
    return config;
}

handoffkit::csp::MessageEnvelope response_for(
    const handoffkit::csp::MessageEnvelope& request,
    std::uint64_t sequence,
    std::string kind,
    std::string payload_type,
    nlohmann::json payload,
    const std::string& worker_id) {
    handoffkit::csp::MessageEnvelope response;
    response.message_id = "cpp-ml-" + std::to_string(sequence);
    response.session_id = request.session_id;
    response.channel = request.channel;
    response.kind = std::move(kind);
    response.source = worker_id;
    response.target = request.source;
    response.sequence = sequence;
    response.created_at = utc_now();
    response.correlation_id = request.message_id;
    response.causation_id = request.message_id;
    response.idempotency_key = request.idempotency_key;
    response.payload_type = std::move(payload_type);
    response.payload = std::move(payload);
    response.metadata = nlohmann::json::object();
    response.validate();
    return response;
}

class NdjsonWorker {
public:
    NdjsonWorker(WorkerConfig config, std::streambuf* protocol_buffer)
        : config_(std::move(config)),
          protocol_output_(protocol_buffer),
          worker_(
              {config_.worker_id,
               config_.worker_threads,
               config_.queue_capacity,
               config_.artifact_policy},
              [this](const auto& progress) { emit_progress(progress); },
              [this](const auto& result) { emit_result(result); }) {}

    int run() {
        std::string line;
        while (std::getline(std::cin, line)) {
            if (line.empty()) continue;
            try {
                handle(handoffkit::csp::MessageEnvelope::from_json(
                    nlohmann::json::parse(line)));
            } catch (const std::exception& error) {
                emit_protocol_error(error.what());
            }
        }
        worker_.shutdown(handoffkit::csp::ShutdownMode::cancel);
        return 0;
    }

private:
    std::uint64_t next_sequence() { return sequence_.fetch_add(1) + 1; }

    void write(const handoffkit::csp::MessageEnvelope& envelope) {
        std::lock_guard lock(output_mutex_);
        protocol_output_ << envelope.to_json().dump() << '\n' << std::flush;
    }

    std::optional<handoffkit::csp::MessageEnvelope> request_for(
        const std::string& job_id,
        bool remove) {
        std::lock_guard lock(request_mutex_);
        const auto found = requests_.find(job_id);
        if (found == requests_.end()) return std::nullopt;
        auto value = found->second;
        if (remove) requests_.erase(found);
        return value;
    }

    bool remember(
        const std::string& job_id,
        const handoffkit::csp::MessageEnvelope& request) {
        std::lock_guard lock(request_mutex_);
        return requests_.emplace(job_id, request).second;
    }

    handoffkit::csp::MessageEnvelope response(
        const handoffkit::csp::MessageEnvelope& request,
        std::uint64_t sequence,
        std::string kind,
        std::string payload_type,
        nlohmann::json payload) const {
        return response_for(
            request,
            sequence,
            std::move(kind),
            std::move(payload_type),
            std::move(payload),
            config_.worker_id);
    }

    void handle(const handoffkit::csp::MessageEnvelope& request) {
		if (!request.target.has_value() || *request.target != config_.worker_id) {
			write(response(
				request,
				next_sequence(),
				"delivery_nack",
				"delivery_nack",
				{{"message_id", request.message_id},
				 {"code", "worker_identity_mismatch"},
				 {"message", "Request target does not match this worker identity."},
				 {"retryable", false},
				 {"processed_at", utc_now()},
				 {"metadata", nlohmann::json::object()}}));
			return;
		}
        if (request.kind == "worker_capabilities") {
			write(response(
                request,
                next_sequence(),
                "worker_capabilities",
                "worker_capabilities",
                worker_.capabilities().to_json()));
            return;
        }
        if (request.kind == "training_job") {
            auto job = handoffkit::csp::TrainingJob::from_json(request.payload);
            job.output = file_uri(config_.output_root / safe_component(job.job_id));
            if (!remember(job.job_id, request)) {
                emit_duplicate(request, job.job_id);
                return;
            }
            const auto result = worker_.submit_training(job, request.message_id);
            emit_submission(request, job.job_id, result);
            return;
        }
        if (request.kind == "evaluation_job") {
            auto job = handoffkit::csp::EvaluationJob::from_json(request.payload);
            job.output = file_uri(config_.output_root / safe_component(job.job_id));
            if (!remember(job.job_id, request)) {
                emit_duplicate(request, job.job_id);
                return;
            }
            const auto result = worker_.submit_evaluation(job, request.message_id);
            emit_submission(request, job.job_id, result);
            return;
        }
        if (request.kind == "job_cancel") {
            const auto job_id = request.payload.at("job_id").get<std::string>();
            const auto cancelled = worker_.cancel(job_id);
			write(response(
                request,
                next_sequence(),
                cancelled ? "job_cancelled" : "delivery_nack",
                "json",
                cancelled
                    ? nlohmann::json{{"job_id", job_id}, {"cancelled", true}}
                    : nlohmann::json{
                          {"message_id", request.message_id},
                          {"code", "job_not_found"},
                          {"message", "Job is not active."},
                          {"retryable", false},
                          {"processed_at", utc_now()},
                          {"metadata", {{"job_id", job_id}}}}));
            return;
        }
        if (request.kind == "session_close") {
            worker_.shutdown(handoffkit::csp::ShutdownMode::drain);
			write(response(
                request,
                next_sequence(),
                "session_closed",
                "json",
                {{"closed", true}}));
            return;
        }
		write(response(
            request,
            next_sequence(),
            "delivery_nack",
            "delivery_nack",
            {{"message_id", request.message_id},
             {"code", "unknown_message_kind"},
             {"message", "cpp-ml worker does not support this message kind."},
             {"retryable", false},
             {"processed_at", utc_now()},
             {"metadata", nlohmann::json::object()}}));
    }

    void emit_submission(
        const handoffkit::csp::MessageEnvelope& request,
        const std::string& job_id,
        const handoffkit::csp::NativeSubmitResult& result) {
        if (result.accepted) {
			write(response(
                request,
                next_sequence(),
                "job_accepted",
                "delivery_ack",
                {{"message_id", request.message_id},
                 {"processed_at", utc_now()},
                 {"metadata", {{"job_id", job_id}}}}));
            return;
        }
        static_cast<void>(request_for(job_id, true));
		write(response(
            request,
            next_sequence(),
            "delivery_nack",
            "delivery_nack",
            result.nack->to_json()));
    }

    void emit_duplicate(
        const handoffkit::csp::MessageEnvelope& request,
        const std::string& job_id) {
		write(response(
            request,
            next_sequence(),
            "delivery_nack",
            "delivery_nack",
            {{"message_id", request.message_id},
             {"code", "duplicate_job"},
             {"message", "A job with this job_id is already active."},
             {"retryable", false},
             {"processed_at", utc_now()},
             {"metadata", {{"job_id", job_id}}}}));
    }

    void emit_progress(const handoffkit::csp::JobProgress& progress) {
        const auto request = request_for(progress.job_id, false);
        if (!request.has_value()) return;
		write(response(
            *request,
            next_sequence(),
            "job_progress",
            "job_progress",
            progress.to_json()));
    }

    void emit_result(const handoffkit::csp::NativeDeliveryResult& result) {
        const auto request = request_for(result.job_id, true);
        if (!request.has_value()) return;
        if (result.succeeded()) {
			write(response(
                *request,
                next_sequence(),
                "job_result",
                "artifact_ref",
                result.artifact->to_json()));
        } else {
			write(response(
                *request,
                next_sequence(),
                "delivery_nack",
                "delivery_nack",
                result.nack->to_json()));
        }
    }

    void emit_protocol_error(const std::string& message) {
        std::lock_guard lock(output_mutex_);
        const auto value = nlohmann::json{
            {"protocol_version", "1.0"},
            {"message_id", "cpp-ml-protocol-" + std::to_string(next_sequence())},
            {"session_id", "invalid"},
            {"channel", "control"},
            {"kind", "delivery_nack"},
			{"source", config_.worker_id},
            {"target", nullptr},
            {"sequence", sequence_.load()},
            {"created_at", utc_now()},
            {"deadline", nullptr},
            {"correlation_id", nullptr},
            {"causation_id", nullptr},
            {"idempotency_key", nullptr},
            {"attempt", 1},
            {"requires_ack", false},
            {"payload_type", "delivery_nack"},
            {"payload",
             {{"message_id", "invalid"},
              {"code", "invalid_envelope"},
              {"message", message.substr(0, 512)},
              {"retryable", false},
              {"processed_at", utc_now()},
              {"metadata", nlohmann::json::object()}}},
            {"metadata", nlohmann::json::object()}};
        protocol_output_ << value.dump() << '\n' << std::flush;
    }

    WorkerConfig config_;
    std::ostream protocol_output_;
    std::mutex output_mutex_;
    std::mutex request_mutex_;
    std::unordered_map<std::string, handoffkit::csp::MessageEnvelope> requests_;
    std::atomic<std::uint64_t> sequence_{0};
    handoffkit::ml::MlCspWorker worker_;
};

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc != 3 || std::string(argv[1]) != "--policy") {
            std::cerr << "usage: handoffkit-cpp-ml-worker --policy POLICY.json\n";
            return 2;
        }
        auto* protocol_buffer = std::cout.rdbuf();
        std::cout.rdbuf(std::cerr.rdbuf());
        return NdjsonWorker(load_config(argv[2]), protocol_buffer).run();
    } catch (const std::exception& error) {
        std::cerr << "handoffkit-cpp-ml-worker: " << error.what() << '\n';
        return 1;
    }
}
