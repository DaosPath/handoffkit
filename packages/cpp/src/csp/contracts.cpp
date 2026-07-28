#include <handoffkit/csp/contracts.hpp>

#include <stdexcept>

namespace handoffkit::csp {
namespace {

nlohmann::json object_or_empty(const nlohmann::json& value) {
    return value.is_object() ? value : nlohmann::json::object();
}

std::optional<std::string> optional_string(const nlohmann::json& value, const char* key) {
    if (!value.contains(key) || value.at(key).is_null()) return std::nullopt;
    return value.at(key).get<std::string>();
}

nlohmann::json optional_json(const std::optional<std::string>& value) {
    return value ? nlohmann::json(*value) : nlohmann::json(nullptr);
}

std::string runtime_mode_name(RuntimeMode mode) {
    switch (mode) {
        case RuntimeMode::classic: return "classic";
        case RuntimeMode::session: return "session";
        case RuntimeMode::distributed: return "distributed";
    }
    throw std::invalid_argument("unknown runtime mode");
}

RuntimeMode runtime_mode_from_name(const std::string& value) {
    if (value == "classic") return RuntimeMode::classic;
    if (value == "session") return RuntimeMode::session;
    if (value == "distributed") return RuntimeMode::distributed;
    throw std::invalid_argument("unknown runtime mode: " + value);
}

std::string overflow_name(OverflowPolicy policy) {
    return policy == OverflowPolicy::reject ? "reject" : "block";
}

OverflowPolicy overflow_from_name(const std::string& value) {
    if (value == "block") return OverflowPolicy::block;
    if (value == "reject") return OverflowPolicy::reject;
    throw std::invalid_argument("unknown overflow policy: " + value);
}

std::vector<ArtifactRef> artifacts_from_json(const nlohmann::json& value) {
    std::vector<ArtifactRef> artifacts;
    for (const auto& item : value) artifacts.push_back(ArtifactRef::from_json(item));
    return artifacts;
}

nlohmann::json artifacts_to_json(const std::vector<ArtifactRef>& artifacts) {
    auto value = nlohmann::json::array();
    for (const auto& artifact : artifacts) value.push_back(artifact.to_json());
    return value;
}

}  // namespace

std::string negotiate_version(std::string_view remote) {
    const auto local_major = protocol_version.substr(0, protocol_version.find('.'));
    const auto remote_major = remote.substr(0, remote.find('.'));
    if (remote_major != local_major) {
        throw std::invalid_argument("unsupported HK-CSP protocol version " + std::string(remote));
    }
    return std::string(protocol_version);
}

nlohmann::json RetryPolicy::to_json() const {
    return {{"max_attempts", max_attempts}, {"base_delay_ms", base_delay_ms}, {"max_delay_ms", max_delay_ms}};
}

RetryPolicy RetryPolicy::from_json(const nlohmann::json& value) {
    return {value.value("max_attempts", 3U), value.value("base_delay_ms", 100ULL), value.value("max_delay_ms", 2000ULL)};
}

nlohmann::json SessionConfig::to_json() const {
    return {
        {"session_id", session_id},
        {"runtime_mode", runtime_mode_name(runtime_mode)},
        {"channel_capacity", channel_capacity},
        {"max_message_bytes", max_message_bytes},
        {"ack_timeout_ms", ack_timeout_ms},
        {"dedup_capacity", dedup_capacity},
        {"retry_policy", retry_policy.to_json()},
        {"deadline", optional_json(deadline)},
        {"metadata", object_or_empty(metadata)},
    };
}

SessionConfig SessionConfig::from_json(const nlohmann::json& value) {
    SessionConfig config;
    config.session_id = value.at("session_id").get<std::string>();
    config.runtime_mode = runtime_mode_from_name(value.value("runtime_mode", "session"));
    config.channel_capacity = value.value("channel_capacity", default_channel_capacity);
    config.max_message_bytes = value.value("max_message_bytes", default_max_message_bytes);
    config.ack_timeout_ms = value.value("ack_timeout_ms", 30000ULL);
    config.dedup_capacity = value.value("dedup_capacity", 4096U);
    config.retry_policy = RetryPolicy::from_json(value.value("retry_policy", nlohmann::json::object()));
    config.deadline = optional_string(value, "deadline");
    config.metadata = object_or_empty(value.value("metadata", nlohmann::json::object()));
    return config;
}

nlohmann::json ChannelConfig::to_json() const {
    return {
        {"name", name},
        {"capacity", capacity},
        {"overflow_policy", overflow_name(overflow_policy)},
        {"requires_ack", requires_ack},
        {"metadata", object_or_empty(metadata)},
    };
}

ChannelConfig ChannelConfig::from_json(const nlohmann::json& value) {
    ChannelConfig config;
    config.name = value.at("name").get<std::string>();
    config.capacity = value.value("capacity", default_channel_capacity);
    config.overflow_policy = overflow_from_name(value.value("overflow_policy", "block"));
    config.requires_ack = value.value("requires_ack", false);
    config.metadata = object_or_empty(value.value("metadata", nlohmann::json::object()));
    return config;
}

void MessageEnvelope::validate() const {
    negotiate_version(protocol_version_value);
    for (const auto* value : {&message_id, &session_id, &channel, &kind, &source, &payload_type}) {
        if (value->empty()) throw std::invalid_argument("HK-CSP envelope contains an empty required field");
    }
    if (attempt == 0) throw std::invalid_argument("HK-CSP attempt must be at least 1");
}

std::size_t MessageEnvelope::encoded_size() const { return to_json().dump().size(); }

MessageEnvelope MessageEnvelope::next_attempt() const {
    auto next = *this;
    ++next.attempt;
    return next;
}

nlohmann::json MessageEnvelope::to_json() const {
    return {
        {"protocol_version", protocol_version_value}, {"message_id", message_id},
        {"session_id", session_id}, {"channel", channel}, {"kind", kind}, {"source", source},
        {"target", optional_json(target)}, {"sequence", sequence}, {"created_at", created_at},
        {"deadline", optional_json(deadline)}, {"correlation_id", optional_json(correlation_id)},
        {"causation_id", optional_json(causation_id)}, {"idempotency_key", optional_json(idempotency_key)},
        {"attempt", attempt}, {"requires_ack", requires_ack}, {"payload_type", payload_type},
        {"payload", payload}, {"metadata", object_or_empty(metadata)},
    };
}

MessageEnvelope MessageEnvelope::from_json(const nlohmann::json& value) {
    MessageEnvelope envelope;
    envelope.protocol_version_value = value.value("protocol_version", std::string(protocol_version));
    envelope.message_id = value.at("message_id").get<std::string>();
    envelope.session_id = value.at("session_id").get<std::string>();
    envelope.channel = value.at("channel").get<std::string>();
    envelope.kind = value.at("kind").get<std::string>();
    envelope.source = value.at("source").get<std::string>();
    envelope.target = optional_string(value, "target");
    envelope.sequence = value.at("sequence").get<std::uint64_t>();
    envelope.created_at = value.at("created_at").get<std::string>();
    envelope.deadline = optional_string(value, "deadline");
    envelope.correlation_id = optional_string(value, "correlation_id");
    envelope.causation_id = optional_string(value, "causation_id");
    envelope.idempotency_key = optional_string(value, "idempotency_key");
    envelope.attempt = value.value("attempt", 1U);
    envelope.requires_ack = value.value("requires_ack", false);
    envelope.payload_type = value.at("payload_type").get<std::string>();
    envelope.payload = value.at("payload");
    envelope.metadata = object_or_empty(value.value("metadata", nlohmann::json::object()));
    envelope.validate();
    return envelope;
}

nlohmann::json DeliveryAck::to_json() const {
    return {{"message_id", message_id}, {"processed_at", processed_at}, {"metadata", object_or_empty(metadata)}};
}

DeliveryAck DeliveryAck::from_json(const nlohmann::json& value) {
    return {value.at("message_id").get<std::string>(), value.at("processed_at").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
}

nlohmann::json DeliveryNack::to_json() const {
    return {{"message_id", message_id}, {"code", code}, {"message", message}, {"retryable", retryable}, {"processed_at", processed_at}, {"metadata", object_or_empty(metadata)}};
}

DeliveryNack DeliveryNack::from_json(const nlohmann::json& value) {
    return {value.at("message_id").get<std::string>(), value.at("code").get<std::string>(), value.at("message").get<std::string>(), value.value("retryable", false), value.at("processed_at").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
}

nlohmann::json ProcessError::to_json() const {
    return {{"code", code}, {"message", message}, {"process_id", process_id}, {"retryable", retryable}, {"details", object_or_empty(details)}, {"timestamp", timestamp}};
}

ProcessError ProcessError::from_json(const nlohmann::json& value) {
    return {value.at("code").get<std::string>(), value.at("message").get<std::string>(), value.at("process_id").get<std::string>(), value.value("retryable", false), object_or_empty(value.value("details", nlohmann::json::object())), value.at("timestamp").get<std::string>()};
}

nlohmann::json WorkerCapabilities::to_json() const {
    return {{"worker_id", worker_id}, {"runtime", runtime}, {"os", os}, {"architecture", architecture}, {"cpu_cores", cpu_cores}, {"memory_bytes", memory_bytes}, {"cuda", cuda}, {"cuda_devices", cuda_devices}, {"profiles", profiles}, {"operations", operations}, {"metadata", object_or_empty(metadata)}};
}

WorkerCapabilities WorkerCapabilities::from_json(const nlohmann::json& value) {
    WorkerCapabilities result;
    result.worker_id = value.at("worker_id").get<std::string>();
    result.runtime = value.at("runtime").get<std::string>();
    result.os = value.at("os").get<std::string>();
    result.architecture = value.at("architecture").get<std::string>();
    result.cpu_cores = value.at("cpu_cores").get<std::uint32_t>();
    result.memory_bytes = value.at("memory_bytes").get<std::uint64_t>();
    result.cuda = value.value("cuda", false);
    result.cuda_devices = value.value("cuda_devices", std::vector<std::string>{});
    result.profiles = value.value("profiles", std::vector<std::string>{});
    result.operations = value.value("operations", std::vector<std::string>{});
    result.metadata = object_or_empty(value.value("metadata", nlohmann::json::object()));
    return result;
}

nlohmann::json ArtifactRef::to_json() const {
    return {{"artifact_id", artifact_id}, {"uri", uri}, {"sha256", sha256}, {"size_bytes", size_bytes}, {"media_type", media_type}, {"metadata", object_or_empty(metadata)}};
}

ArtifactRef ArtifactRef::from_json(const nlohmann::json& value) {
    return {value.at("artifact_id").get<std::string>(), value.at("uri").get<std::string>(), value.at("sha256").get<std::string>(), value.at("size_bytes").get<std::uint64_t>(), value.at("media_type").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
}

nlohmann::json TrainingJob::to_json() const {
    return {{"job_id", job_id}, {"dataset", dataset.to_json()}, {"output", output}, {"config", object_or_empty(config)}, {"requested_capabilities", requested_capabilities}, {"deadline", optional_json(deadline)}, {"idempotency_key", idempotency_key}, {"metadata", object_or_empty(metadata)}};
}

TrainingJob TrainingJob::from_json(const nlohmann::json& value) {
    return {value.at("job_id").get<std::string>(), ArtifactRef::from_json(value.at("dataset")), value.at("output").get<std::string>(), object_or_empty(value.value("config", nlohmann::json::object())), value.value("requested_capabilities", std::vector<std::string>{}), optional_string(value, "deadline"), value.at("idempotency_key").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
}

nlohmann::json EvaluationJob::to_json() const {
    return {{"job_id", job_id}, {"model", model.to_json()}, {"dataset", dataset.to_json()}, {"output", output}, {"config", object_or_empty(config)}, {"requested_capabilities", requested_capabilities}, {"deadline", optional_json(deadline)}, {"idempotency_key", idempotency_key}, {"metadata", object_or_empty(metadata)}};
}

EvaluationJob EvaluationJob::from_json(const nlohmann::json& value) {
    return {value.at("job_id").get<std::string>(), ArtifactRef::from_json(value.at("model")), ArtifactRef::from_json(value.at("dataset")), value.at("output").get<std::string>(), object_or_empty(value.value("config", nlohmann::json::object())), value.value("requested_capabilities", std::vector<std::string>{}), optional_string(value, "deadline"), value.at("idempotency_key").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
}

nlohmann::json JobProgress::to_json() const {
    return {{"job_id", job_id}, {"phase", phase}, {"status", status}, {"step", step}, {"total_steps", total_steps}, {"progress", progress}, {"loss", loss ? nlohmann::json(*loss) : nlohmann::json(nullptr)}, {"metrics", object_or_empty(metrics)}, {"message", message}, {"timestamp", timestamp}, {"artifacts", artifacts_to_json(artifacts)}};
}

JobProgress JobProgress::from_json(const nlohmann::json& value) {
    JobProgress result;
    result.job_id = value.at("job_id").get<std::string>();
    result.phase = value.at("phase").get<std::string>();
    result.status = value.at("status").get<std::string>();
    result.step = value.at("step").get<std::uint64_t>();
    result.total_steps = value.at("total_steps").get<std::uint64_t>();
    result.progress = value.at("progress").get<double>();
    if (value.contains("loss") && !value.at("loss").is_null()) result.loss = value.at("loss").get<double>();
    result.metrics = object_or_empty(value.value("metrics", nlohmann::json::object()));
    result.message = value.value("message", "");
    result.timestamp = value.at("timestamp").get<std::string>();
    result.artifacts = artifacts_from_json(value.value("artifacts", nlohmann::json::array()));
    return result;
}

}  // namespace handoffkit::csp
