#include <handoffkit/ml/csp_worker.hpp>
#include <handoffkit/csp/dispatcher.hpp>
#include <handoffkit/csp/durable_scheduler.hpp>
#include <handoffkit/csp/tls_transport.hpp>

#include <algorithm>
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
#include <unordered_set>
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
    std::optional<handoffkit::csp::TlsTransportConfig> tls_transport;
    std::string bind_host{"127.0.0.1"};
    std::uint16_t port{0};
    std::vector<std::string> dispatcher_operations{
        "worker_capabilities", "training_job", "evaluation_job", "job_cancel", "session_close"};
    std::optional<fs::path> durable_state_path;
    std::optional<fs::path> replay_state_path;
    bool auto_resume{false};
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

WorkerConfig load_config(const fs::path& policy_path, bool tls_mode = false) {
    const auto value = read_json(policy_path);
    if (!value.is_object() || value.value("format", std::string{}) !=
                                   (tls_mode ? "handoffkit-cpp-ml-worker-tls-policy"
                                             : "handoffkit-cpp-ml-worker-policy") ||
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
    if (value.contains("durable_state_path") && !value.at("durable_state_path").is_null()) {
        config.durable_state_path = fs::absolute(value.at("durable_state_path").get<std::string>());
    } else if (tls_mode) {
        config.durable_state_path = config.output_root / "scheduler-state.json";
    }
    if (value.contains("replay_state_path") && !value.at("replay_state_path").is_null()) {
        config.replay_state_path = fs::absolute(value.at("replay_state_path").get<std::string>());
    } else if (tls_mode) {
        config.replay_state_path = config.output_root / "replay-state.json";
    }
    config.auto_resume = value.value("auto_resume", false);
    if (value.contains("dispatcher_operations")) {
        config.dispatcher_operations = string_array(value, "dispatcher_operations");
        if (config.dispatcher_operations.empty()) {
            throw std::invalid_argument("dispatcher_operations must not be empty");
        }
    }
    if (tls_mode) {
        const auto& tls = value.at("tls");
        if (!tls.is_object()) throw std::invalid_argument("tls policy must be an object");
        config.bind_host = value.value("bind_host", std::string{"127.0.0.1"});
        const auto port = value.value("port", 0U);
        if (port > 65535U) throw std::invalid_argument("port must be between 0 and 65535");
        config.port = static_cast<std::uint16_t>(port);
        handoffkit::csp::TlsTransportConfig transport;
        transport.security = handoffkit::csp::SecurityConfig::from_json(tls.at("security"));
        transport.server_name = tls.value("server_name", std::string{});
        transport.max_frame_bytes = tls.value(
            "max_frame_bytes", handoffkit::csp::default_max_message_bytes);
        transport.timeout = std::chrono::milliseconds(tls.value("timeout_ms", 5000U));
        if (tls.contains("peer_policy")) {
            const auto& peer_policy = tls.at("peer_policy");
            if (!peer_policy.is_object()) throw std::invalid_argument("tls.peer_policy must be an object");
            if (peer_policy.contains("expected_peer_id") && !peer_policy.at("expected_peer_id").is_null()) {
                transport.peer_policy.expected_peer_id = peer_policy.at("expected_peer_id").get<std::string>();
            }
            if (peer_policy.contains("expected_node_id") && !peer_policy.at("expected_node_id").is_null()) {
                transport.peer_policy.expected_node_id = peer_policy.at("expected_node_id").get<std::string>();
            }
            if (peer_policy.contains("expected_worker_id") && !peer_policy.at("expected_worker_id").is_null()) {
                transport.peer_policy.expected_worker_id = peer_policy.at("expected_worker_id").get<std::string>();
            }
            if (peer_policy.contains("capabilities_by_fingerprint")) {
                const auto& map = peer_policy.at("capabilities_by_fingerprint");
                if (!map.is_object()) throw std::invalid_argument("capabilities_by_fingerprint must be an object");
                for (const auto& item : map.items()) {
                    transport.peer_policy.capabilities_by_fingerprint[item.key()] =
                        item.value().get<std::vector<std::string>>();
                }
            }
        }
        transport.security.validate_cpp_transport_support();
        config.tls_transport = std::move(transport);
    }
    return config;
}

std::vector<std::string> expanded_dispatcher_operations(
    const std::vector<std::string>& operations) {
    std::vector<std::string> expanded = operations;
    const auto add = [&expanded](const std::string& value) {
        if (std::find(expanded.begin(), expanded.end(), value) == expanded.end()) {
            expanded.push_back(value);
        }
    };
    for (const auto& operation : operations) {
        if (operation == "training_job" || operation == "job:training") {
            add("training_job");
            add("job:training");
        } else if (operation == "evaluation_job" || operation == "job:evaluation") {
            add("evaluation_job");
            add("job:evaluation");
        } else if (operation == "job_cancel" || operation == "job:cancel") {
            add("job_cancel");
            add("job:cancel");
        } else if (operation == "worker_capabilities" || operation == "worker:inspect") {
            add("worker_capabilities");
            add("worker:inspect");
        } else if (operation == "session_close" || operation == "session:close") {
            add("session_close");
            add("session:close");
        }
    }
    return expanded;
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

class TlsWorkerSession {
public:
    TlsWorkerSession(
        handoffkit::csp::TlsConnection connection,
        WorkerConfig config,
        handoffkit::csp::ReplayProtection& replay,
        handoffkit::csp::DurableScheduler* scheduler,
        handoffkit::csp::DurableReplayProtection* durable_replay)
        : connection_(std::make_shared<handoffkit::csp::TlsConnection>(std::move(connection))),
          config_(std::move(config)),
          replay_(replay),
          scheduler_(scheduler),
          durable_replay_(durable_replay),
          policy_(expanded_dispatcher_operations(config_.dispatcher_operations)),
          worker_(
              {config_.worker_id,
               config_.worker_threads,
               config_.queue_capacity,
               config_.artifact_policy},
              [this](const auto& progress) { emit_progress(progress); },
              [this](const auto& result) { emit_result(result); }) {}

    TlsWorkerSession(const TlsWorkerSession&) = delete;
    TlsWorkerSession& operator=(const TlsWorkerSession&) = delete;

    int run() {
        while (!stop_requested_) {
            try {
                handoffkit::csp::CspDispatcher dispatcher(
                    *connection_, replay_, policy_);
                const auto result = dispatcher.receive_and_dispatch(
                    [this](const handoffkit::csp::PeerIdentity&, const auto& request) {
                        return handle(request);
                    });
                if (!result) {
                    persist_replay();
                    send_protocol_error(
                        "dispatch_error",
                        result.error().message,
                        false);
                    break;
                }
                if (!persist_replay()) {
                    send_protocol_error(
                        "replay_state_persist_failed",
                        replay_persist_error_,
                        false);
                    break;
                }
                send(result.value());
            } catch (const handoffkit::csp::SecurityError& error) {
                // Preserve the authentication/replay error. A persistence
                // failure is fail-closed and terminates this session too.
                static_cast<void>(persist_replay());
                send_protocol_error(error.code(), error.what(), false);
                break;
            } catch (const std::exception& error) {
                send_protocol_error("worker_protocol_error", error.what(), false);
                break;
            }
        }
        worker_.shutdown(handoffkit::csp::ShutdownMode::drain);
        return 0;
    }

private:
    std::uint64_t next_sequence() { return sequence_.fetch_add(1) + 1; }

    void send(const nlohmann::json& value) {
        std::lock_guard lock(output_mutex_);
        if (connection_ != nullptr && connection_->valid()) connection_->send_json(value);
    }

    bool persist_replay() noexcept {
        if (durable_replay_ == nullptr) return true;
        try {
            durable_replay_->persist();
            replay_persist_error_.clear();
            return true;
        } catch (const handoffkit::csp::SecurityError& error) {
            replay_persist_error_ = error.code() + ": " + std::string(error.what());
            stop_requested_ = true;
            return false;
        } catch (const std::exception& error) {
            replay_persist_error_ = error.what();
            stop_requested_ = true;
            return false;
        } catch (...) {
            replay_persist_error_ = "unknown durable replay persistence failure";
            stop_requested_ = true;
            return false;
        }
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

    nlohmann::json response(
        const handoffkit::csp::MessageEnvelope& request,
        std::string kind,
        std::string payload_type,
        nlohmann::json payload) {
        return response_for(
            request,
            next_sequence(),
            std::move(kind),
            std::move(payload_type),
            std::move(payload),
            config_.worker_id)
            .to_json();
    }

    handoffkit::Result<void> admit_job(const handoffkit::csp::DistributedJob& job) {
        if (scheduler_ == nullptr) return handoffkit::Result<void>::success();
        auto admitted = scheduler_->enqueue(job);
        if (!admitted) return admitted;
        return scheduler_->claim(job);
    }

    void complete_job(const std::string& job_id) noexcept {
        if (scheduler_ != nullptr) static_cast<void>(scheduler_->complete(job_id));
    }

    void fail_job(const std::string& job_id) noexcept {
        if (scheduler_ != nullptr) static_cast<void>(scheduler_->fail(job_id));
    }

    nlohmann::json handle(const handoffkit::csp::MessageEnvelope& request) {
        if (request.target.has_value() && *request.target != config_.worker_id) {
            return response(
                request,
                "delivery_nack",
                "delivery_nack",
                {{"message_id", request.message_id},
                 {"code", "worker_identity_mismatch"},
                 {"message", "Request target does not match this worker identity."},
                 {"retryable", false},
                 {"processed_at", utc_now()},
                 {"metadata", nlohmann::json::object()}});
        }
        if (request.kind == "worker_capabilities") {
            return response(
                request,
                "worker_capabilities",
                "worker_capabilities",
                worker_.capabilities().to_json());
        }
        if (request.kind == "training_job") {
            auto job = handoffkit::csp::TrainingJob::from_json(request.payload);
            job.output = file_uri(config_.output_root / safe_component(job.job_id));
            if (!remember(job.job_id, request)) {
                return response(
                    request,
                    "delivery_nack",
                    "delivery_nack",
                    {{"message_id", request.message_id},
                     {"code", "duplicate_job"},
                     {"message", "A job with this job_id is already active."},
                     {"retryable", false},
                     {"processed_at", utc_now()},
                     {"metadata", {{"job_id", job.job_id}}}});
            }
            handoffkit::csp::DistributedJob durable_job{
                job.job_id,
                "job:training",
                request.payload,
                job.requested_capabilities,
                job.idempotency_key,
                job.deadline,
                {{"message_id", request.message_id}}};
            const auto admitted = admit_job(durable_job);
            if (!admitted) {
                static_cast<void>(request_for(job.job_id, true));
                return response(
                    request,
                    "delivery_nack",
                    "delivery_nack",
                    {{"message_id", request.message_id},
                     {"code", "durable_admission_failed"},
                     {"message", admitted.error().message},
                     {"retryable", true},
                     {"processed_at", utc_now()},
                     {"metadata", {{"job_id", job.job_id}}}});
            }
            const auto result = worker_.submit_training(job, request.message_id);
            return submission_response(request, job.job_id, result);
        }
        if (request.kind == "evaluation_job") {
            auto job = handoffkit::csp::EvaluationJob::from_json(request.payload);
            job.output = file_uri(config_.output_root / safe_component(job.job_id));
            if (!remember(job.job_id, request)) {
                return response(
                    request,
                    "delivery_nack",
                    "delivery_nack",
                    {{"message_id", request.message_id},
                     {"code", "duplicate_job"},
                     {"message", "A job with this job_id is already active."},
                     {"retryable", false},
                     {"processed_at", utc_now()},
                     {"metadata", {{"job_id", job.job_id}}}});
            }
            handoffkit::csp::DistributedJob durable_job{
                job.job_id,
                "job:evaluation",
                request.payload,
                job.requested_capabilities,
                job.idempotency_key,
                job.deadline,
                {{"message_id", request.message_id}}};
            const auto admitted = admit_job(durable_job);
            if (!admitted) {
                static_cast<void>(request_for(job.job_id, true));
                return response(
                    request,
                    "delivery_nack",
                    "delivery_nack",
                    {{"message_id", request.message_id},
                     {"code", "durable_admission_failed"},
                     {"message", admitted.error().message},
                     {"retryable", true},
                     {"processed_at", utc_now()},
                     {"metadata", {{"job_id", job.job_id}}}});
            }
            const auto result = worker_.submit_evaluation(job, request.message_id);
            return submission_response(request, job.job_id, result);
        }
        if (request.kind == "job_cancel") {
            const auto job_id = request.payload.at("job_id").get<std::string>();
            const auto cancelled = worker_.cancel(job_id);
            return response(
                request,
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
                          {"metadata", {{"job_id", job_id}}}});
        }
        if (request.kind == "session_close") {
            stop_requested_ = true;
            return response(request, "session_closed", "json", {{"closed", true}});
        }
        return response(
            request,
            "delivery_nack",
            "delivery_nack",
            {{"message_id", request.message_id},
             {"code", "unknown_message_kind"},
             {"message", "cpp-ml TLS worker does not support this message kind."},
             {"retryable", false},
             {"processed_at", utc_now()},
             {"metadata", nlohmann::json::object()}});
    }

    nlohmann::json submission_response(
        const handoffkit::csp::MessageEnvelope& request,
        const std::string& job_id,
        const handoffkit::csp::NativeSubmitResult& result) {
        if (result.accepted) {
            return response(
                request,
                "job_accepted",
                "delivery_ack",
                {{"message_id", request.message_id},
                 {"processed_at", utc_now()},
                 {"metadata", {{"job_id", job_id}}}});
        }
        static_cast<void>(request_for(job_id, true));
        fail_job(job_id);
        return response(
            request,
            "delivery_nack",
            "delivery_nack",
            result.nack.has_value()
                ? result.nack->to_json()
                : nlohmann::json{{"message_id", request.message_id},
                                 {"code", "job_rejected"},
                                 {"message", "ML worker rejected the job."},
                                 {"retryable", false},
                                 {"processed_at", utc_now()},
                                 {"metadata", nlohmann::json::object()}});
    }

    void emit_progress(const handoffkit::csp::JobProgress& progress) {
        const auto request = request_for(progress.job_id, false);
        if (!request.has_value()) return;
        try {
            send(response(*request, "job_progress", "job_progress", progress.to_json()));
        } catch (...) {
            stop_requested_ = true;
        }
    }

    void emit_result(const handoffkit::csp::NativeDeliveryResult& result) {
        const auto request = request_for(result.job_id, true);
        if (!request.has_value()) return;
        try {
            if (result.succeeded()) {
                complete_job(result.job_id);
                send(response(
                    *request,
                    "job_result",
                    "artifact_ref",
                    result.artifact->to_json()));
            } else {
                fail_job(result.job_id);
                send(response(
                    *request,
                    "delivery_nack",
                    "delivery_nack",
                    result.nack->to_json()));
            }
        } catch (...) {
            stop_requested_ = true;
        }
    }

    void send_protocol_error(
        const std::string& code,
        const std::string& message,
        bool retryable) {
        std::lock_guard lock(output_mutex_);
        if (connection_ == nullptr || !connection_->valid()) return;
        try {
            handoffkit::csp::MessageEnvelope envelope;
            envelope.message_id = "cpp-ml-error-" + std::to_string(next_sequence());
            envelope.session_id = "security-error";
            envelope.channel = "control";
            envelope.kind = "delivery_nack";
            envelope.source = config_.worker_id;
            envelope.sequence = next_sequence();
            envelope.created_at = utc_now();
            envelope.payload_type = "delivery_nack";
            envelope.payload = {
                {"message_id", envelope.message_id},
                {"code", code},
                {"message", message.substr(0, 512)},
                {"retryable", retryable},
                {"processed_at", utc_now()},
                {"metadata", nlohmann::json::object()}};
            envelope.metadata = nlohmann::json::object();
            envelope.validate();
            connection_->send_json(envelope.to_json());
        } catch (...) {
            stop_requested_ = true;
        }
    }

    std::shared_ptr<handoffkit::csp::TlsConnection> connection_;
    WorkerConfig config_;
    handoffkit::csp::ReplayProtection& replay_;
    handoffkit::csp::DurableScheduler* scheduler_{nullptr};
    handoffkit::csp::DurableReplayProtection* durable_replay_{nullptr};
    handoffkit::csp::CapabilityPolicy policy_;
    std::mutex output_mutex_;
    std::mutex request_mutex_;
    std::unordered_map<std::string, handoffkit::csp::MessageEnvelope> requests_;
    std::atomic<std::uint64_t> sequence_{0};
    std::atomic_bool stop_requested_{false};
    std::string replay_persist_error_;
    handoffkit::ml::MlCspWorker worker_;
};

class TlsWorkerServer {
public:
    explicit TlsWorkerServer(WorkerConfig config)
        : config_(std::move(config)),
          replay_(make_replay(config_)),
          scheduler_(make_scheduler(config_)),
          listener_(make_listener(config_)) {}

    static std::unique_ptr<handoffkit::csp::DurableReplayProtection> make_replay(
        const WorkerConfig& config) {
        if (!config.replay_state_path.has_value()) return nullptr;
        return std::make_unique<handoffkit::csp::DurableReplayProtection>(
            *config.replay_state_path);
    }

    static std::unique_ptr<handoffkit::csp::DurableScheduler> make_scheduler(
        const WorkerConfig& config) {
        if (!config.durable_state_path.has_value()) return nullptr;
        handoffkit::csp::DurableSchedulerOptions options;
        options.state_path = *config.durable_state_path;
        options.queue_capacity = config.queue_capacity;
        options.auto_resume = config.auto_resume;
        return std::make_unique<handoffkit::csp::DurableScheduler>(std::move(options));
    }

    static handoffkit::csp::TlsServer make_listener(const WorkerConfig& config) {
        if (!config.tls_transport.has_value()) {
            throw std::invalid_argument("TLS worker requires tls transport configuration");
        }
        if (!config.tls_transport->security.require_mtls) {
            throw std::invalid_argument("TLS worker requires mTLS");
        }
        return handoffkit::csp::TlsServer::listen(
            config.bind_host,
            config.port,
            *config.tls_transport);
    }

    int run() {
        for (;;) {
            try {
                auto connection = listener_.accept();
                TlsWorkerSession session(
                    std::move(connection),
                    config_,
                    replay_->protection(),
                    scheduler_.get(),
                    replay_.get());
                session.run();
            } catch (const handoffkit::csp::SecurityError& error) {
                if (error.code() == "tls_accept_timeout") continue;
                std::cerr << "handoffkit-cpp-ml-worker TLS: " << error.code()
                          << ": " << error.what();
                if (!error.details().is_null() && !error.details().empty()) {
                    std::cerr << " details=" << error.details().dump();
                }
                std::cerr << '\n';
            }
        }
    }

private:
    WorkerConfig config_;
    std::unique_ptr<handoffkit::csp::DurableReplayProtection> replay_;
    std::unique_ptr<handoffkit::csp::DurableScheduler> scheduler_;
    handoffkit::csp::TlsServer listener_;
};

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc != 3 || (std::string(argv[1]) != "--policy" &&
                          std::string(argv[1]) != "--tls-policy")) {
            std::cerr << "usage: handoffkit-cpp-ml-worker --policy POLICY.json\n"
                      << "       handoffkit-cpp-ml-worker --tls-policy TLS_POLICY.json\n";
            return 2;
        }
        const bool tls_mode = std::string(argv[1]) == "--tls-policy";
        auto config = load_config(argv[2], tls_mode);
        if (tls_mode) return TlsWorkerServer(std::move(config)).run();
        auto* protocol_buffer = std::cout.rdbuf();
        std::cout.rdbuf(std::cerr.rdbuf());
        return NdjsonWorker(std::move(config), protocol_buffer).run();
    } catch (const std::exception& error) {
        std::cerr << "handoffkit-cpp-ml-worker: " << error.what() << '\n';
        return 1;
    }
}
