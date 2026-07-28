#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace handoffkit::csp {

inline constexpr std::string_view protocol_version = "1.0";
inline constexpr std::size_t default_channel_capacity = 64;
inline constexpr std::size_t default_max_message_bytes = 8U * 1024U * 1024U;

enum class RuntimeMode { classic, session, distributed };
enum class OverflowPolicy { block, reject };

std::string negotiate_version(std::string_view remote);

struct RetryPolicy {
    std::uint32_t max_attempts = 3;
    std::uint64_t base_delay_ms = 100;
    std::uint64_t max_delay_ms = 2000;
    nlohmann::json to_json() const;
    static RetryPolicy from_json(const nlohmann::json& value);
};

struct SessionConfig {
    std::string session_id;
    RuntimeMode runtime_mode = RuntimeMode::session;
    std::size_t channel_capacity = default_channel_capacity;
    std::size_t max_message_bytes = default_max_message_bytes;
    std::uint64_t ack_timeout_ms = 30000;
    std::size_t dedup_capacity = 4096;
    RetryPolicy retry_policy;
    std::optional<std::string> deadline;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    static SessionConfig from_json(const nlohmann::json& value);
};

struct ChannelConfig {
    std::string name;
    std::size_t capacity = default_channel_capacity;
    OverflowPolicy overflow_policy = OverflowPolicy::block;
    bool requires_ack = false;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    static ChannelConfig from_json(const nlohmann::json& value);
};

struct MessageEnvelope {
    std::string protocol_version_value = std::string(protocol_version);
    std::string message_id;
    std::string session_id;
    std::string channel;
    std::string kind;
    std::string source;
    std::optional<std::string> target;
    std::uint64_t sequence = 0;
    std::string created_at;
    std::optional<std::string> deadline;
    std::optional<std::string> correlation_id;
    std::optional<std::string> causation_id;
    std::optional<std::string> idempotency_key;
    std::uint32_t attempt = 1;
    bool requires_ack = false;
    std::string payload_type;
    nlohmann::json payload;
    nlohmann::json metadata = nlohmann::json::object();

    void validate() const;
    std::size_t encoded_size() const;
    MessageEnvelope next_attempt() const;
    nlohmann::json to_json() const;
    static MessageEnvelope from_json(const nlohmann::json& value);
};

struct DeliveryAck {
    std::string message_id;
    std::string processed_at;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    static DeliveryAck from_json(const nlohmann::json& value);
};

struct DeliveryNack {
    std::string message_id;
    std::string code;
    std::string message;
    bool retryable = false;
    std::string processed_at;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    static DeliveryNack from_json(const nlohmann::json& value);
};

struct ProcessError {
    std::string code;
    std::string message;
    std::string process_id;
    bool retryable = false;
    nlohmann::json details = nlohmann::json::object();
    std::string timestamp;
    nlohmann::json to_json() const;
    static ProcessError from_json(const nlohmann::json& value);
};

struct WorkerCapabilities {
    std::string worker_id;
    std::string runtime;
    std::string os;
    std::string architecture;
    std::uint32_t cpu_cores = 0;
    std::uint64_t memory_bytes = 0;
    bool cuda = false;
    std::vector<std::string> cuda_devices;
    std::vector<std::string> profiles;
    std::vector<std::string> operations;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    static WorkerCapabilities from_json(const nlohmann::json& value);
};

struct ArtifactRef {
    std::string artifact_id;
    std::string uri;
    std::string sha256;
    std::uint64_t size_bytes = 0;
    std::string media_type;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    static ArtifactRef from_json(const nlohmann::json& value);
};

struct TrainingJob {
    std::string job_id;
    ArtifactRef dataset;
    std::string output;
    nlohmann::json config = nlohmann::json::object();
    std::vector<std::string> requested_capabilities;
    std::optional<std::string> deadline;
    std::string idempotency_key;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    static TrainingJob from_json(const nlohmann::json& value);
};

struct EvaluationJob {
    std::string job_id;
    ArtifactRef model;
    ArtifactRef dataset;
    std::string output;
    nlohmann::json config = nlohmann::json::object();
    std::vector<std::string> requested_capabilities;
    std::optional<std::string> deadline;
    std::string idempotency_key;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    static EvaluationJob from_json(const nlohmann::json& value);
};

struct JobProgress {
    std::string job_id;
    std::string phase;
    std::string status;
    std::uint64_t step = 0;
    std::uint64_t total_steps = 0;
    double progress = 0.0;
    std::optional<double> loss;
    nlohmann::json metrics = nlohmann::json::object();
    std::string message;
    std::string timestamp;
    std::vector<ArtifactRef> artifacts;
    nlohmann::json to_json() const;
    static JobProgress from_json(const nlohmann::json& value);
};

}  // namespace handoffkit::csp
