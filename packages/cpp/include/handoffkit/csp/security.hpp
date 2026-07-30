#ifndef HANDOFFKIT_CSP_SECURITY_HPP
#define HANDOFFKIT_CSP_SECURITY_HPP

#include <chrono>
#include <algorithm>
#include <cctype>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <nlohmann/json.hpp>

namespace handoffkit::csp {

class SecurityError : public std::runtime_error {
public:
    SecurityError(std::string code, std::string message,
                  nlohmann::json details = nlohmann::json::object())
        : std::runtime_error(std::move(message)),
          code_(std::move(code)),
          details_(std::move(details)) {}

    [[nodiscard]] const std::string& code() const noexcept { return code_; }
    [[nodiscard]] const nlohmann::json& details() const noexcept { return details_; }

private:
    std::string code_;
    nlohmann::json details_;
};

enum class SecurityProfile {
    Local,
    Standard,
    HybridPq,
    Research
};

inline std::string to_string(SecurityProfile profile) {
    switch (profile) {
        case SecurityProfile::Local: return "local";
        case SecurityProfile::Standard: return "standard";
        case SecurityProfile::HybridPq: return "hybrid-pq";
        case SecurityProfile::Research: return "research";
    }
    return "local";
}

inline SecurityProfile security_profile_from_string(const std::string& str) {
    if (str == "local") return SecurityProfile::Local;
    if (str == "standard") return SecurityProfile::Standard;
    if (str == "hybrid-pq") return SecurityProfile::HybridPq;
    if (str == "research") return SecurityProfile::Research;
    throw std::invalid_argument("invalid security profile: " + str);
}

inline SecurityProfile negotiate_security_profile(
    SecurityProfile required,
    SecurityProfile offered,
    const std::vector<SecurityProfile>& supported) {
    if (required != offered) {
        throw SecurityError(
            "security_profile_mismatch",
            "Required and offered security profiles do not match.",
            {{"required", to_string(required)}, {"offered", to_string(offered)}});
    }
    if (std::find(supported.begin(), supported.end(), required) == supported.end()) {
        throw SecurityError(
            "security_profile_unavailable",
            "The exact security profile has no active provider.",
            {{"profile", to_string(required)}});
    }
    return required;
}

struct SecurityConfig {
    SecurityProfile profile{SecurityProfile::Local};
    bool require_mtls{false};
    bool allow_insecure_loopback{false};
    std::string trust_domain{"handoffkit.internal"};
    std::optional<std::string> ca_cert_path;
    std::optional<std::string> cert_path;
    std::optional<std::string> key_path;
    std::uint64_t replay_window_seconds{300};
    std::uint64_t max_clock_skew_seconds{10};

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"profile", to_string(profile)},
            {"require_mtls", require_mtls},
            {"allow_insecure_loopback", allow_insecure_loopback},
            {"trust_domain", trust_domain},
            {"replay_window_seconds", replay_window_seconds},
            {"max_clock_skew_seconds", max_clock_skew_seconds}};
    }

    static SecurityConfig from_json(const nlohmann::json& value) {
        SecurityConfig config;
        config.profile = security_profile_from_string(value.value("profile", "local"));
        config.require_mtls = value.value("require_mtls", false);
        config.allow_insecure_loopback = value.value("allow_insecure_loopback", false);
        config.trust_domain = value.value("trust_domain", "handoffkit.internal");
        config.replay_window_seconds = value.value("replay_window_seconds", 300ULL);
        config.max_clock_skew_seconds = value.value("max_clock_skew_seconds", 10ULL);
        if (config.trust_domain.empty()) {
            throw SecurityError("invalid_security_config", "trust_domain must not be empty");
        }
        if (config.replay_window_seconds == 0 || config.replay_window_seconds > 3600) {
            throw SecurityError(
                "invalid_security_config", "replay_window_seconds must be between 1 and 3600");
        }
        if (config.max_clock_skew_seconds > 60) {
            throw SecurityError(
                "invalid_security_config", "max_clock_skew_seconds must not exceed 60");
        }
        return config;
    }

    void validate_listen_address(const std::string& host) const {
        bool is_loopback = (host == "127.0.0.1" || host == "localhost" || host == "::1");
        if ((profile == SecurityProfile::Local || profile == SecurityProfile::Research) &&
            !is_loopback) {
            throw SecurityError(
                "insecure_public_bind",
                "Profile '" + to_string(profile) +
                    "' cannot listen on non-loopback interface '" + host + "'");
        }
    }

    void validate_cpp_transport_support() const {
        if (profile == SecurityProfile::Standard) {
            throw SecurityError(
                "tls_backend_unavailable",
                "The C++ runtime does not currently ship a maintained TLS transport backend.");
        }
        if (profile == SecurityProfile::HybridPq) {
            throw SecurityError(
                "hybrid_pq_unavailable",
                "The C++ runtime has no provider-backed hybrid-PQ TLS transport.");
        }
    }
};

struct PeerIdentity {
    std::string peer_id;
    std::string node_id;
    std::string trust_domain{"handoffkit.internal"};
    std::optional<std::string> worker_id;
    std::string credential_fingerprint;
    std::vector<std::string> capabilities;
    std::int64_t issued_at{0};
    std::int64_t expires_at{0};

    [[nodiscard]] bool is_valid_at(std::int64_t timestamp = 0) const {
        std::int64_t ts = timestamp;
        if (ts == 0) {
            ts = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
        }
        if (expires_at > 0 && ts > expires_at) return false;
        if (issued_at > 0 && ts < (issued_at - 60)) return false;
        return true;
    }

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"peer_id", peer_id},
            {"node_id", node_id},
            {"worker_id", worker_id ? nlohmann::json(*worker_id) : nlohmann::json(nullptr)},
            {"trust_domain", trust_domain},
            {"credential_fingerprint", credential_fingerprint},
            {"capabilities", capabilities},
            {"issued_at", issued_at},
            {"expires_at", expires_at}};
    }

    static PeerIdentity from_json(const nlohmann::json& value) {
        PeerIdentity identity;
        identity.peer_id = value.value("peer_id", "");
        identity.node_id = value.value("node_id", "");
        identity.trust_domain = value.value("trust_domain", "handoffkit.internal");
        if (value.contains("worker_id") && !value.at("worker_id").is_null()) {
            identity.worker_id = value.at("worker_id").get<std::string>();
        }
        identity.credential_fingerprint = value.value("credential_fingerprint", "");
        identity.capabilities = value.value("capabilities", std::vector<std::string>{});
        identity.issued_at = value.value("issued_at", std::int64_t{0});
        identity.expires_at = value.value("expires_at", std::int64_t{0});
        if (identity.peer_id.empty() || identity.node_id.empty() || identity.trust_domain.empty()) {
            throw SecurityError(
                "invalid_peer_identity", "peer_id, node_id, and trust_domain must not be empty");
        }
        return identity;
    }
};

struct SignedArtifact {
    std::string artifact_id;
    std::string content_hash;
    std::string signature;
    std::string algorithm;
    std::string signer_identity;
    std::string key_fingerprint;
    std::int64_t created_at{0};

    void validate() const {
        const auto is_lower_hex = [](const std::string& value, std::size_t size) {
            return value.size() == size &&
                   std::all_of(value.begin(), value.end(), [](unsigned char character) {
                       return std::isdigit(character) != 0 ||
                              (character >= static_cast<unsigned char>('a') &&
                               character <= static_cast<unsigned char>('f'));
                   });
        };
        if (artifact_id.empty() || signer_identity.empty()) {
            throw SecurityError(
                "invalid_signed_artifact", "artifact_id and signer_identity must not be empty");
        }
        if (algorithm != "ed25519") {
            throw SecurityError(
                "artifact_algorithm_unsupported",
                "unsupported artifact signature algorithm: " + algorithm);
        }
        if (!is_lower_hex(content_hash, 64)) {
            throw SecurityError(
                "invalid_signed_artifact",
                "content_hash must be a lowercase SHA-256 digest");
        }
        if (!key_fingerprint.starts_with("sha256:") ||
            !is_lower_hex(key_fingerprint.substr(7), 64)) {
            throw SecurityError(
                "invalid_signed_artifact",
                "key_fingerprint must be a canonical SHA-256 fingerprint");
        }
        if (created_at < 0) {
            throw SecurityError("invalid_signed_artifact", "created_at must not be negative");
        }
    }

    [[nodiscard]] nlohmann::json to_json() const {
        validate();
        return {
            {"artifact_id", artifact_id},
            {"content_hash", content_hash},
            {"signature", signature},
            {"algorithm", algorithm},
            {"signer_identity", signer_identity},
            {"key_fingerprint", key_fingerprint},
            {"created_at", created_at}};
    }

    static SignedArtifact from_json(const nlohmann::json& value) {
        SignedArtifact artifact{
            value.at("artifact_id").get<std::string>(),
            value.at("content_hash").get<std::string>(),
            value.at("signature").get<std::string>(),
            value.at("algorithm").get<std::string>(),
            value.at("signer_identity").get<std::string>(),
            value.at("key_fingerprint").get<std::string>(),
            value.at("created_at").get<std::int64_t>()};
        artifact.validate();
        return artifact;
    }

    [[nodiscard]] std::string canonical_payload() const {
        validate();
        return nlohmann::json{
            {"algorithm", algorithm},
            {"artifact_id", artifact_id},
            {"content_hash", content_hash},
            {"created_at", created_at},
            {"key_fingerprint", key_fingerprint},
            {"signer_identity", signer_identity}}
            .dump();
    }
};

class CapabilityPolicy {
public:
    explicit CapabilityPolicy(
        std::optional<std::vector<std::string>> allowed_operations = std::nullopt) {
        if (allowed_operations.has_value()) {
            allowed_ops_ = std::unordered_set<std::string>(
                allowed_operations->begin(), allowed_operations->end());
        }
    }

    [[nodiscard]] bool is_operation_authorized(
        const std::string& operation,
        const PeerIdentity* peer = nullptr) const {
        if (allowed_ops_.has_value() && allowed_ops_->find(operation) == allowed_ops_->end()) {
            return false;
        }
        if (peer) {
            for (const auto& cap : peer->capabilities) {
                if (cap == "*" || cap == operation) return true;
                auto colon = operation.find(':');
                if (colon != std::string::npos) {
                    std::string prefix = operation.substr(0, colon) + ":*";
                    if (cap == prefix) return true;
                }
            }
            return false;
        }
        return true;
    }

    void authorize_job(const std::string& job_type, const PeerIdentity& peer) const {
        if (!peer.is_valid_at()) {
            throw SecurityError(
                "authentication_failed",
                "Peer identity '" + peer.peer_id + "' has expired or is invalid.");
        }
        std::string op = "job:" + job_type;
        if (!is_operation_authorized(op, &peer) && !is_operation_authorized(job_type, &peer)) {
            throw SecurityError(
                "authorization_denied",
                "Peer '" + peer.peer_id +
                    "' is not authorized to execute job type '" + job_type + "'.");
        }
    }

private:
    std::optional<std::unordered_set<std::string>> allowed_ops_;
};

class ReplayProtection {
public:
    ReplayProtection(std::uint64_t window_seconds = 300,
                     std::uint64_t max_skew_seconds = 10,
                     std::size_t max_seen_nonces = 10000)
        : window_seconds_(window_seconds),
          max_skew_seconds_(max_skew_seconds),
          max_seen_nonces_(max_seen_nonces) {}

    void check_and_record(const std::string& session_id,
                          std::uint64_t sequence,
                          const std::optional<std::string>& nonce = std::nullopt,
                          std::optional<std::int64_t> created_at_ts = std::nullopt) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto now = std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();

        if (created_at_ts.has_value()) {
            if (*created_at_ts < (now - static_cast<std::int64_t>(window_seconds_))) {
                throw SecurityError(
                    "replay_timestamp_stale", "Message timestamp is older than replay window.");
            }
            if (*created_at_ts > (now + static_cast<std::int64_t>(max_skew_seconds_))) {
                throw SecurityError(
                    "replay_timestamp_future",
                    "Message timestamp is in the future beyond max clock skew.");
            }
        }

        auto it = last_sequences_.find(session_id);
        if (it != last_sequences_.end() && sequence <= it->second) {
            throw SecurityError(
                "replay_sequence",
                "Sequence is not strictly monotonic for session " + session_id);
        }
        if (nonce.has_value() && !nonce->empty()) {
            for (auto iterator = seen_nonces_.begin(); iterator != seen_nonces_.end();) {
                if (iterator->second < now - static_cast<std::int64_t>(window_seconds_)) {
                    iterator = seen_nonces_.erase(iterator);
                } else {
                    ++iterator;
                }
            }
            const auto nonce_key = session_id + '\0' + *nonce;
            if (seen_nonces_.find(nonce_key) != seen_nonces_.end()) {
                throw SecurityError("replay_nonce", "Duplicate nonce detected: " + *nonce);
            }
        }

        // Process-local state advances only after every check succeeds.
        last_sequences_[session_id] = sequence;
        if (nonce.has_value() && !nonce->empty()) {
            if (seen_nonces_.size() >= max_seen_nonces_) {
                seen_nonces_.erase(seen_nonces_.begin());
            }
            seen_nonces_[session_id + '\0' + *nonce] = now;
        }
    }

    void check_and_record(const std::string& peer_scope,
                          const std::string& session_id,
                          std::uint64_t sequence,
                          const std::optional<std::string>& nonce = std::nullopt,
                          std::optional<std::int64_t> created_at_ts = std::nullopt) {
        check_and_record(
            peer_scope + '\0' + session_id, sequence, nonce, created_at_ts);
    }

private:
    std::uint64_t window_seconds_;
    std::uint64_t max_skew_seconds_;
    std::size_t max_seen_nonces_;
    std::mutex mutex_;
    std::unordered_map<std::string, std::int64_t> seen_nonces_;
    std::unordered_map<std::string, std::uint64_t> last_sequences_;
};

} // namespace handoffkit::csp

#endif // HANDOFFKIT_CSP_SECURITY_HPP
