#ifndef HANDOFFKIT_CSP_SECURITY_HPP
#define HANDOFFKIT_CSP_SECURITY_HPP

#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace handoffkit::csp {

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

    void validate_listen_address(const std::string& host) const {
        if ((host == "0.0.0.0" || host == "::") && allow_insecure_loopback) {
            throw std::invalid_argument("allow_insecure_loopback cannot be used with public bind (0.0.0.0)");
        }
        bool is_loopback = (host == "127.0.0.1" || host == "localhost" || host == "::1");
        if (profile == SecurityProfile::Local && !is_loopback && !allow_insecure_loopback) {
            throw std::invalid_argument("Profile 'local' cannot listen on non-loopback interface '" + host + "' without allow_insecure_loopback=true");
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
        if (peer && !peer->capabilities.empty()) {
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
            throw std::runtime_error("Peer identity '" + peer.peer_id + "' has expired or is invalid.");
        }
        std::string op = "job:" + job_type;
        if (!is_operation_authorized(op, &peer) && !is_operation_authorized(job_type, &peer)) {
            throw std::runtime_error("Peer '" + peer.peer_id + "' is not authorized to execute job type '" + job_type + "'.");
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
                throw std::runtime_error("Message timestamp is older than replay window.");
            }
            if (*created_at_ts > (now + static_cast<std::int64_t>(max_skew_seconds_))) {
                throw std::runtime_error("Message timestamp is in the future beyond max clock skew.");
            }
        }

        auto it = last_sequences_.find(session_id);
        if (it != last_sequences_.end() && sequence <= it->second) {
            throw std::runtime_error("Sequence is not strictly monotonic for session " + session_id);
        }
        last_sequences_[session_id] = sequence;

        if (nonce.has_value() && !nonce->empty()) {
            if (seen_nonces_.find(*nonce) != seen_nonces_.end()) {
                throw std::runtime_error("Duplicate nonce detected: " + *nonce);
            }
            if (seen_nonces_.size() >= max_seen_nonces_) {
                seen_nonces_.erase(seen_nonces_.begin());
            }
            seen_nonces_[*nonce] = now;
        }
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
