#include <handoffkit/csp/contracts.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <regex>
#include <stdexcept>
#include <utility>

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

std::string edge_profile_name(EdgeProfile profile) {
    switch (profile) {
        case EdgeProfile::edge_small: return "edge-small";
        case EdgeProfile::edge_standard: return "edge-standard";
        case EdgeProfile::server: return "server";
    }
    throw std::invalid_argument("unknown edge profile");
}

EdgeProfile edge_profile_from_name(const std::string& value) {
    if (value == "edge-small") return EdgeProfile::edge_small;
    if (value == "edge-standard") return EdgeProfile::edge_standard;
    if (value == "server") return EdgeProfile::server;
    throw std::invalid_argument("unknown edge profile: " + value);
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

bool blank(std::string_view value) {
    return std::all_of(value.begin(), value.end(), [](unsigned char character) {
        return std::isspace(character) != 0;
    });
}

void require_text(std::string_view field, std::string_view value) {
    if (value.empty() || blank(value)) {
        throw std::invalid_argument(std::string(field) + " must not be empty");
    }
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

std::int64_t parse_timestamp(std::string_view field, std::string_view value) {
    static const std::regex pattern(
        R"(^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(Z|([+-])([0-9]{2}):([0-9]{2}))$)"
    );
    std::smatch match;
    const std::string timestamp(value);
    if (!std::regex_match(timestamp, match, pattern)) {
        throw std::invalid_argument(std::string(field) + " must be an RFC 3339 timestamp");
    }

    const int year = std::stoi(match[1].str());
    const unsigned month = static_cast<unsigned>(std::stoul(match[2].str()));
    const unsigned day = static_cast<unsigned>(std::stoul(match[3].str()));
    const unsigned hour = static_cast<unsigned>(std::stoul(match[4].str()));
    const unsigned minute = static_cast<unsigned>(std::stoul(match[5].str()));
    const unsigned second = static_cast<unsigned>(std::stoul(match[6].str()));
    static constexpr unsigned days_in_month[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    const unsigned maximum_day = month == 2 && leap
                                     ? 29U
                                     : (month >= 1 && month <= 12 ? days_in_month[month - 1] : 0U);
    if (day == 0 || day > maximum_day || hour > 23 || minute > 59 || second > 59) {
        throw std::invalid_argument(std::string(field) + " must be an RFC 3339 timestamp");
    }

    std::string fraction = match[7].str();
    fraction.resize(9, '0');
    if (fraction.size() > 9) fraction.resize(9);
    const std::int64_t nanoseconds = fraction.empty() ? 0 : std::stoll(fraction);

    std::int64_t offset_seconds = 0;
    if (match[8].str() != "Z") {
        const auto offset_hour = std::stoll(match[10].str());
        const auto offset_minute = std::stoll(match[11].str());
        if (offset_hour > 23 || offset_minute > 59) {
            throw std::invalid_argument(std::string(field) + " must be an RFC 3339 timestamp");
        }
        offset_seconds = (offset_hour * 60 + offset_minute) * 60;
        if (match[9].str() == "-") offset_seconds = -offset_seconds;
    }

    const auto epoch_seconds =
        days_from_civil(year, month, day) * 86400 + static_cast<std::int64_t>(hour) * 3600 +
        static_cast<std::int64_t>(minute) * 60 + second - offset_seconds;
    return epoch_seconds * 1000000000 + nanoseconds;
}

void validate_timestamp(std::string_view field, std::string_view value) {
    static_cast<void>(parse_timestamp(field, value));
}

std::size_t json_depth(const nlohmann::json& value) {
    if (!value.is_array() && !value.is_object()) return 1;
    std::size_t depth = 1;
    for (const auto& item : value) depth = std::max(depth, 1 + json_depth(item));
    return depth;
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

std::string validation_error_code(std::string_view message) {
    const std::string value(message);
    if (value.find("protocol version") != std::string::npos) return "unsupported_version";
    if (value.find("RFC 3339") != std::string::npos) return "invalid_timestamp";
    if (value.find("deadline must not") != std::string::npos) return "invalid_deadline";
    if (value.find("must not be empty") != std::string::npos) return "empty_field";
    if (value.find("at least") != std::string::npos) return "below_minimum";
    if (value.find("must not exceed") != std::string::npos) return "above_maximum";
    if (value.find("nesting depth") != std::string::npos) return "nesting_too_deep";
    if (value.find("message exceeds") != std::string::npos) return "message_too_large";
    if (value.find("sha256") != std::string::npos) return "invalid_sha256";
    if (value.find("between 0 and 1") != std::string::npos) return "invalid_progress";
    return "invalid_contract";
}

std::int64_t timestamp_epoch_seconds(std::string_view field, std::string_view value) {
    return parse_timestamp(field, value) / 1'000'000'000;
}

void RetryPolicy::validate() const {
    if (max_attempts == 0) throw std::invalid_argument("max_attempts must be at least 1");
    if (max_attempts > 100) throw std::invalid_argument("max_attempts must not exceed 100");
    if (base_delay_ms > max_delay_ms) throw std::invalid_argument("retry delays are invalid");
}

nlohmann::json RetryPolicy::to_json() const {
    return {{"max_attempts", max_attempts}, {"base_delay_ms", base_delay_ms}, {"max_delay_ms", max_delay_ms}};
}

RetryPolicy RetryPolicy::from_json(const nlohmann::json& value) {
    RetryPolicy result{value.value("max_attempts", 3U), value.value("base_delay_ms", 100ULL), value.value("max_delay_ms", 2000ULL)};
    result.validate();
    return result;
}

void EdgeRuntimeProfile::validate() const {
    if (channel_capacity == 0 || max_frame_bytes == 0 || pending_ack_limit == 0 ||
        dedup_capacity == 0 || durable_replay_capacity == 0 || connection_limit == 0 ||
        heartbeat_seconds == 0 || timeout.connect_ms == 0 || timeout.io_ms == 0 ||
        timeout.ack_ms == 0 || artifact_limit_bytes == 0 || memory_budget_bytes == 0 ||
        durable_state_limit_bytes == 0) {
        throw std::invalid_argument("edge runtime limits must be positive");
    }
    if (max_frame_bytes < 1024 || max_frame_bytes > default_max_message_bytes) {
        throw std::invalid_argument("edge max_frame_bytes is invalid");
    }
    reconnect.validate();
    if ((logging.level != "warning" && logging.level != "info") ||
        logging.include_payloads || !logging.redact_paths) {
        throw std::invalid_argument("edge logging policy is unsafe");
    }
    if (security_profile != "standard") {
        throw std::invalid_argument("edge profiles require the standard security profile");
    }
}

nlohmann::json EdgeRuntimeProfile::to_json() const {
    validate();
    return {
        {"name", edge_profile_name(name)},
        {"channel_capacity", channel_capacity},
        {"max_frame_bytes", max_frame_bytes},
        {"pending_ack_limit", pending_ack_limit},
        {"dedup_capacity", dedup_capacity},
        {"durable_replay_capacity", durable_replay_capacity},
        {"connection_limit", connection_limit},
        {"heartbeat_seconds", heartbeat_seconds},
        {"reconnect", reconnect.to_json()},
        {"timeout",
         {{"connect_ms", timeout.connect_ms},
          {"io_ms", timeout.io_ms},
          {"ack_ms", timeout.ack_ms}}},
        {"artifact_limit_bytes", artifact_limit_bytes},
        {"memory_budget_bytes", memory_budget_bytes},
        {"durable_state_limit_bytes", durable_state_limit_bytes},
        {"logging",
         {{"level", logging.level},
          {"include_payloads", logging.include_payloads},
          {"redact_paths", logging.redact_paths}}},
        {"security_profile", security_profile},
    };
}

EdgeRuntimeProfile EdgeRuntimeProfile::for_profile(EdgeProfile profile) {
    EdgeRuntimeProfile result;
    result.name = profile;
    result.logging.include_payloads = false;
    result.logging.redact_paths = true;
    result.security_profile = "standard";
    switch (profile) {
        case EdgeProfile::edge_small:
            result.channel_capacity = 16;
            result.max_frame_bytes = 1048576;
            result.pending_ack_limit = 32;
            result.dedup_capacity = 512;
            result.durable_replay_capacity = 2048;
            result.connection_limit = 8;
            result.heartbeat_seconds = 30;
            result.reconnect = {5, 250, 5000};
            result.timeout = {5000, 15000, 10000};
            result.artifact_limit_bytes = 16777216;
            result.memory_budget_bytes = 268435456;
            result.durable_state_limit_bytes = 8388608;
            result.logging.level = "warning";
            break;
        case EdgeProfile::edge_standard:
            result.channel_capacity = 64;
            result.max_frame_bytes = 4194304;
            result.pending_ack_limit = 128;
            result.dedup_capacity = 2048;
            result.durable_replay_capacity = 10000;
            result.connection_limit = 32;
            result.heartbeat_seconds = 15;
            result.reconnect = {5, 100, 3000};
            result.timeout = {5000, 30000, 30000};
            result.artifact_limit_bytes = 67108864;
            result.memory_budget_bytes = 1073741824;
            result.durable_state_limit_bytes = 33554432;
            result.logging.level = "info";
            break;
        case EdgeProfile::server:
            result.channel_capacity = 256;
            result.max_frame_bytes = 8388608;
            result.pending_ack_limit = 1024;
            result.dedup_capacity = 16384;
            result.durable_replay_capacity = 100000;
            result.connection_limit = 256;
            result.heartbeat_seconds = 10;
            result.reconnect = {8, 50, 2000};
            result.timeout = {5000, 60000, 60000};
            result.artifact_limit_bytes = 536870912;
            result.memory_budget_bytes = 4294967296ULL;
            result.durable_state_limit_bytes = 268435456;
            result.logging.level = "info";
            break;
    }
    result.validate();
    return result;
}

EdgeRuntimeProfile EdgeRuntimeProfile::from_json(const nlohmann::json& value) {
    EdgeRuntimeProfile result;
    result.name = edge_profile_from_name(value.at("name").get<std::string>());
    result.channel_capacity = value.at("channel_capacity").get<std::size_t>();
    result.max_frame_bytes = value.at("max_frame_bytes").get<std::size_t>();
    result.pending_ack_limit = value.at("pending_ack_limit").get<std::size_t>();
    result.dedup_capacity = value.at("dedup_capacity").get<std::size_t>();
    result.durable_replay_capacity = value.at("durable_replay_capacity").get<std::size_t>();
    result.connection_limit = value.at("connection_limit").get<std::size_t>();
    result.heartbeat_seconds = value.at("heartbeat_seconds").get<std::uint64_t>();
    result.reconnect = RetryPolicy::from_json(value.at("reconnect"));
    result.timeout = {
        value.at("timeout").at("connect_ms").get<std::uint64_t>(),
        value.at("timeout").at("io_ms").get<std::uint64_t>(),
        value.at("timeout").at("ack_ms").get<std::uint64_t>(),
    };
    result.artifact_limit_bytes = value.at("artifact_limit_bytes").get<std::uint64_t>();
    result.memory_budget_bytes = value.at("memory_budget_bytes").get<std::uint64_t>();
    result.durable_state_limit_bytes =
        value.at("durable_state_limit_bytes").get<std::uint64_t>();
    result.logging = {
        value.at("logging").at("level").get<std::string>(),
        value.at("logging").at("include_payloads").get<bool>(),
        value.at("logging").at("redact_paths").get<bool>(),
    };
    result.security_profile = value.at("security_profile").get<std::string>();
    result.validate();
    return result;
}

void SessionConfig::validate() const {
    require_text("session_id", session_id);
    if (channel_capacity == 0) throw std::invalid_argument("channel_capacity must be at least 1");
    if (max_message_bytes < 1024) throw std::invalid_argument("max_message_bytes must be at least 1024");
    if (max_message_bytes > default_max_message_bytes) {
        throw std::invalid_argument("max_message_bytes must not exceed 8388608");
    }
    if (ack_timeout_ms == 0 || dedup_capacity == 0) {
        throw std::invalid_argument("ack_timeout_ms and dedup_capacity must be at least 1");
    }
    retry_policy.validate();
    if (deadline) validate_timestamp("deadline", *deadline);
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
    config.validate();
    return config;
}

SessionConfig EdgeRuntimeProfile::session_config(std::string session_id) const {
    validate();
    SessionConfig config;
    config.session_id = std::move(session_id);
    config.channel_capacity = channel_capacity;
    config.max_message_bytes = max_frame_bytes;
    config.ack_timeout_ms = timeout.ack_ms;
    config.dedup_capacity = dedup_capacity;
    config.retry_policy = reconnect;
    config.metadata = {{"edge_profile", edge_profile_name(name)}};
    config.validate();
    return config;
}

void ChannelConfig::validate() const {
    require_text("name", name);
    if (capacity == 0) throw std::invalid_argument("capacity must be at least 1");
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
    config.validate();
    return config;
}

void MessageEnvelope::validate() const {
    negotiate_version(protocol_version_value);
    require_text("message_id", message_id);
    require_text("session_id", session_id);
    require_text("channel", channel);
    require_text("kind", kind);
    require_text("source", source);
    require_text("payload_type", payload_type);
    if (attempt == 0) throw std::invalid_argument("HK-CSP attempt must be at least 1");
    validate_timestamp("created_at", created_at);
    if (deadline) validate_timestamp("deadline", *deadline);
    for (const auto* value : {&target, &correlation_id, &causation_id, &idempotency_key}) {
        if (*value && blank(**value)) throw std::invalid_argument("optional field must not be empty");
    }
    if (json_depth(payload) > 64 || json_depth(metadata) > 64) {
        throw std::invalid_argument("JSON nesting depth must not exceed 64");
    }
    if (encoded_size() > default_max_message_bytes) {
        throw std::invalid_argument("message exceeds 8388608 bytes");
    }
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

void DeliveryAck::validate() const {
    require_text("message_id", message_id);
    validate_timestamp("processed_at", processed_at);
}

DeliveryAck DeliveryAck::from_json(const nlohmann::json& value) {
    DeliveryAck result{value.at("message_id").get<std::string>(), value.at("processed_at").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
    result.validate();
    return result;
}

nlohmann::json DeliveryNack::to_json() const {
    return {{"message_id", message_id}, {"code", code}, {"message", message}, {"retryable", retryable}, {"processed_at", processed_at}, {"metadata", object_or_empty(metadata)}};
}

void DeliveryNack::validate() const {
    require_text("message_id", message_id);
    require_text("code", code);
    validate_timestamp("processed_at", processed_at);
}

DeliveryNack DeliveryNack::from_json(const nlohmann::json& value) {
    DeliveryNack result{value.at("message_id").get<std::string>(), value.at("code").get<std::string>(), value.at("message").get<std::string>(), value.value("retryable", false), value.at("processed_at").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
    result.validate();
    return result;
}

nlohmann::json ProcessError::to_json() const {
    return {{"code", code}, {"message", message}, {"process_id", process_id}, {"retryable", retryable}, {"details", object_or_empty(details)}, {"timestamp", timestamp}};
}

void ProcessError::validate() const {
    require_text("code", code);
    require_text("process_id", process_id);
    validate_timestamp("timestamp", timestamp);
}

ProcessError ProcessError::from_json(const nlohmann::json& value) {
    ProcessError result{value.at("code").get<std::string>(), value.at("message").get<std::string>(), value.at("process_id").get<std::string>(), value.value("retryable", false), object_or_empty(value.value("details", nlohmann::json::object())), value.at("timestamp").get<std::string>()};
    result.validate();
    return result;
}

nlohmann::json WorkerCapabilities::to_json() const {
    return {{"worker_id", worker_id}, {"runtime", runtime}, {"os", os}, {"architecture", architecture}, {"cpu_cores", cpu_cores}, {"memory_bytes", memory_bytes}, {"cuda", cuda}, {"cuda_devices", cuda_devices}, {"profiles", profiles}, {"operations", operations}, {"metadata", object_or_empty(metadata)}};
}

void WorkerCapabilities::validate() const {
    require_text("worker_id", worker_id);
    require_text("runtime", runtime);
    require_text("os", os);
    require_text("architecture", architecture);
    if (cpu_cores == 0) throw std::invalid_argument("cpu_cores must be at least 1");
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
    result.validate();
    return result;
}

nlohmann::json WorkerHeartbeat::to_json() const {
    return {{"worker_id", worker_id}, {"sequence", sequence}, {"active_jobs", active_jobs}, {"load", load}, {"timestamp", timestamp}, {"metadata", object_or_empty(metadata)}};
}

void WorkerHeartbeat::validate() const {
    require_text("worker_id", worker_id);
    if (!std::isfinite(load) || load < 0.0 || load > 1.0) {
        throw std::invalid_argument("load must be between 0 and 1");
    }
    validate_timestamp("timestamp", timestamp);
}

WorkerHeartbeat WorkerHeartbeat::from_json(const nlohmann::json& value) {
    WorkerHeartbeat result{value.at("worker_id").get<std::string>(), value.at("sequence").get<std::uint64_t>(), value.at("active_jobs").get<std::uint32_t>(), value.at("load").get<double>(), value.at("timestamp").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
    result.validate();
    return result;
}

nlohmann::json DistributedJob::to_json() const {
    return {{"job_id", job_id}, {"operation", operation}, {"payload", payload}, {"requested_capabilities", requested_capabilities}, {"idempotency_key", idempotency_key}, {"deadline", optional_json(deadline)}, {"metadata", object_or_empty(metadata)}};
}

DistributedJob DistributedJob::from_json(const nlohmann::json& value) {
    DistributedJob result{value.at("job_id").get<std::string>(), value.at("operation").get<std::string>(), value.at("payload"), value.value("requested_capabilities", std::vector<std::string>{}), value.at("idempotency_key").get<std::string>(), optional_string(value, "deadline"), object_or_empty(value.value("metadata", nlohmann::json::object()))};
    result.validate();
    return result;
}

void DistributedJob::validate() const {
    require_text("job_id", job_id);
    require_text("operation", operation);
    require_text("idempotency_key", idempotency_key);
    for (const auto& capability : requested_capabilities) {
        require_text("requested_capabilities item", capability);
    }
    if (deadline) validate_timestamp("deadline", *deadline);
}

nlohmann::json JobAssignment::to_json() const {
    return {{"assignment_id", assignment_id}, {"job_id", job_id}, {"worker_id", worker_id}, {"attempt", attempt}, {"assigned_at", assigned_at}, {"lease_deadline", lease_deadline}, {"payload", payload}, {"metadata", object_or_empty(metadata)}};
}

JobAssignment JobAssignment::from_json(const nlohmann::json& value) {
    JobAssignment result{value.at("assignment_id").get<std::string>(), value.at("job_id").get<std::string>(), value.at("worker_id").get<std::string>(), value.at("attempt").get<std::uint32_t>(), value.at("assigned_at").get<std::string>(), value.at("lease_deadline").get<std::string>(), value.at("payload"), object_or_empty(value.value("metadata", nlohmann::json::object()))};
    result.validate();
    return result;
}

void JobAssignment::validate() const {
    require_text("assignment_id", assignment_id);
    require_text("job_id", job_id);
    require_text("worker_id", worker_id);
    if (attempt == 0) throw std::invalid_argument("attempt must be at least 1");
    const auto assigned = parse_timestamp("assigned_at", assigned_at);
    const auto lease = parse_timestamp("lease_deadline", lease_deadline);
    if (lease < assigned) {
        throw std::invalid_argument("lease_deadline must not be earlier than assigned_at");
    }
}

nlohmann::json ArtifactRef::to_json() const {
    return {{"artifact_id", artifact_id}, {"uri", uri}, {"sha256", sha256}, {"size_bytes", size_bytes}, {"media_type", media_type}, {"metadata", object_or_empty(metadata)}};
}

ArtifactRef ArtifactRef::from_json(const nlohmann::json& value) {
    ArtifactRef result{value.at("artifact_id").get<std::string>(), value.at("uri").get<std::string>(), value.at("sha256").get<std::string>(), value.at("size_bytes").get<std::uint64_t>(), value.at("media_type").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
    result.validate();
    return result;
}

void ArtifactRef::validate() const {
    require_text("artifact_id", artifact_id);
    require_text("uri", uri);
    require_text("media_type", media_type);
    if (sha256.size() != 64 ||
        !std::all_of(sha256.begin(), sha256.end(), [](unsigned char character) {
            return std::isxdigit(character) != 0;
        })) {
        throw std::invalid_argument("sha256 must contain exactly 64 hexadecimal characters");
    }
}

nlohmann::json TrainingJob::to_json() const {
    return {{"job_id", job_id}, {"dataset", dataset.to_json()}, {"output", output}, {"config", object_or_empty(config)}, {"requested_capabilities", requested_capabilities}, {"deadline", optional_json(deadline)}, {"idempotency_key", idempotency_key}, {"metadata", object_or_empty(metadata)}};
}

TrainingJob TrainingJob::from_json(const nlohmann::json& value) {
    TrainingJob result{value.at("job_id").get<std::string>(), ArtifactRef::from_json(value.at("dataset")), value.at("output").get<std::string>(), object_or_empty(value.value("config", nlohmann::json::object())), value.value("requested_capabilities", std::vector<std::string>{}), optional_string(value, "deadline"), value.at("idempotency_key").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
    result.validate();
    return result;
}

void TrainingJob::validate() const {
    require_text("job_id", job_id);
    require_text("output", output);
    require_text("idempotency_key", idempotency_key);
    dataset.validate();
    if (deadline) validate_timestamp("deadline", *deadline);
}

nlohmann::json EvaluationJob::to_json() const {
    return {{"job_id", job_id}, {"model", model.to_json()}, {"dataset", dataset.to_json()}, {"output", output}, {"config", object_or_empty(config)}, {"requested_capabilities", requested_capabilities}, {"deadline", optional_json(deadline)}, {"idempotency_key", idempotency_key}, {"metadata", object_or_empty(metadata)}};
}

EvaluationJob EvaluationJob::from_json(const nlohmann::json& value) {
    EvaluationJob result{value.at("job_id").get<std::string>(), ArtifactRef::from_json(value.at("model")), ArtifactRef::from_json(value.at("dataset")), value.at("output").get<std::string>(), object_or_empty(value.value("config", nlohmann::json::object())), value.value("requested_capabilities", std::vector<std::string>{}), optional_string(value, "deadline"), value.at("idempotency_key").get<std::string>(), object_or_empty(value.value("metadata", nlohmann::json::object()))};
    result.validate();
    return result;
}

void EvaluationJob::validate() const {
    require_text("job_id", job_id);
    require_text("output", output);
    require_text("idempotency_key", idempotency_key);
    model.validate();
    dataset.validate();
    if (deadline) validate_timestamp("deadline", *deadline);
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
    result.validate();
    return result;
}

void JobProgress::validate() const {
    require_text("job_id", job_id);
    require_text("phase", phase);
    require_text("status", status);
    validate_timestamp("timestamp", timestamp);
    if (!std::isfinite(progress) || progress < 0.0 || progress > 1.0) {
        throw std::invalid_argument("progress must be between 0 and 1");
    }
    if (step > total_steps) throw std::invalid_argument("step must not exceed total_steps");
    for (const auto& artifact : artifacts) artifact.validate();
}

}  // namespace handoffkit::csp
