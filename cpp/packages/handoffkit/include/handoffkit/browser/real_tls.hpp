#pragma once

#include <handoffkit/browser/real.hpp>
#include <handoffkit/csp/contracts.hpp>
#include <handoffkit/csp/tls_transport.hpp>

#include <cstdint>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <optional>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <utility>

namespace handoffkit {
namespace browser {

class BrowserRealTlsClient {
public:
    BrowserRealTlsClient(
        handoffkit::csp::TlsConnection connection,
        handoffkit::csp::PeerIdentity identity)
        : connection_(std::move(connection)), identity_(std::move(identity)) {
        const auto& local = connection_.local_identity();
        if (identity_.peer_id != local.peer_id || identity_.node_id != local.node_id ||
            identity_.worker_id != local.worker_id || identity_.trust_domain != local.trust_domain ||
            identity_.credential_fingerprint != local.credential_fingerprint) {
            throw handoffkit::csp::SecurityError(
                "tls_local_identity_mismatch",
                "Browser Real client identity does not match its configured certificate");
        }
        identity_.issued_at = local.issued_at;
        identity_.expires_at = local.expires_at;
        if (identity_.peer_id.empty() || identity_.node_id.empty() ||
            identity_.credential_fingerprint.empty()) {
            throw std::invalid_argument(
                "TLS client identity requires peer_id, node_id, and fingerprint");
        }
    }

    nlohmann::json send(const nlohmann::json& command) {
        sequence_ += 1;
        std::random_device rd;
        std::uniform_int_distribution<int> dist(0, 255);
        std::ostringstream nonce;
        nonce << std::hex << std::setfill('0');
        for (int i = 0; i < 16; i += 1) nonce << std::setw(2) << dist(rd);
        const std::string nonceHex = nonce.str();
        const auto timestamp = now_rfc3339();
        const auto session_id = command.value("session_id", "sess-tls");
        const auto transcript = handoffkit::csp::SecurityTranscript::build({
            .protocol_version = "1.0",
            .requested_profile = handoffkit::csp::SecurityProfile::Standard,
            .selected_profile = handoffkit::csp::SecurityProfile::Standard,
            .sender = identity_,
            .receiver = connection_.peer_identity(),
            .tls_version = connection_.negotiated_protocol(),
            .negotiated_group = std::nullopt,
            .session_id = session_id,
            .handshake_nonce = nonceHex,
            .timestamp = timestamp,
        });
        const auto idempotency = command.value("idempotency_key", std::string{});
        nlohmann::json envelope = {
            {"protocol_version", "1.0"},
            {"message_id", "msg-" + std::to_string(sequence_)},
            {"session_id", session_id},
            {"channel", "browser.control"},
            {"kind", "request"},
            {"source", identity_.peer_id},
            {"sequence", sequence_},
            {"created_at", timestamp},
            {"deadline", nullptr},
            {"correlation_id", nullptr},
            {"causation_id", nullptr},
            {"idempotency_key", idempotency.empty() ? nlohmann::json(nullptr) : nlohmann::json(idempotency)},
            {"payload_type", "browser.command"},
            {"payload", command},
            {"attempt", 1},
            {"requires_ack", false},
            {"metadata", {
                {"nonce", nonceHex},
                {"security_nonce", nonceHex},
                {"operation", "browser:control"},
                {"certificate_fingerprint", identity_.credential_fingerprint},
                {"peer_identity", identity_.to_json()},
                {"security_transcript", transcript.to_json()}
            }},
        };
        connection_.send_json(envelope);
        const auto response = connection_.receive_json();
        validate_response(response, envelope);
        if (response.contains("payload")) return response["payload"];
        return response;
    }

    [[nodiscard]] const handoffkit::csp::PeerIdentity& authenticated_peer() const {
        return connection_.peer_identity();
    }

    [[nodiscard]] const handoffkit::csp::PeerIdentity& local_identity() const noexcept {
        return identity_;
    }

    [[nodiscard]] std::string negotiated_protocol() const {
        return connection_.negotiated_protocol();
    }

    void close() noexcept { connection_.close(); }

    static BrowserRealTlsClient connect(const std::string& host,
                                        std::uint16_t port,
                                        handoffkit::csp::TlsTransportConfig config,
                                        handoffkit::csp::PeerIdentity identity) {
        return BrowserRealTlsClient(
            handoffkit::csp::TlsClient::connect(host, port, std::move(config)),
            std::move(identity));
    }

private:
    static bool same_identity(const handoffkit::csp::PeerIdentity& left,
                              const handoffkit::csp::PeerIdentity& right) {
        return left.peer_id == right.peer_id && left.node_id == right.node_id &&
               left.worker_id == right.worker_id && left.trust_domain == right.trust_domain &&
               left.credential_fingerprint == right.credential_fingerprint &&
               left.capabilities == right.capabilities;
    }

    void validate_response(const nlohmann::json& raw,
                           const nlohmann::json& request) {
        const auto response = handoffkit::csp::MessageEnvelope::from_json(raw);
        if (response.kind != "response" || response.channel != "browser.control" ||
            response.payload_type != "browser.event") {
            throw handoffkit::csp::SecurityError(
                "browser_response_invalid", "Browser Real response envelope is invalid");
        }
        if (!response.correlation_id.has_value() ||
            *response.correlation_id != request.at("message_id").get<std::string>()) {
            throw handoffkit::csp::SecurityError(
                "browser_response_correlation_invalid",
                "Browser Real response correlation_id does not match request message_id");
        }
        if (response.source != connection_.peer_identity().peer_id) {
            throw handoffkit::csp::SecurityError(
                "browser_response_identity_mismatch",
                "Browser Real response source does not match authenticated TLS peer");
        }
        const auto nonce = response.metadata.value("security_nonce", std::string{});
        if (nonce.empty() || !seen_response_nonces_.insert(nonce).second) {
            throw handoffkit::csp::SecurityError(
                "browser_response_replay_detected",
                "Browser Real response nonce was missing or already observed");
        }
        if (response.sequence == 0 || response.sequence <= last_response_sequence_) {
            throw handoffkit::csp::SecurityError(
                "browser_response_replay_detected",
                "Browser Real response sequence is not strictly increasing");
        }
        last_response_sequence_ = response.sequence;
        if (response.metadata.value("operation", std::string{}) != "browser:control") {
            throw handoffkit::csp::SecurityError(
                "browser_response_operation_invalid",
                "Browser Real response operation is not browser:control");
        }
        const auto declared = response.metadata.value("peer_identity", nlohmann::json::object());
        const auto peer = handoffkit::csp::PeerIdentity::from_json(declared);
        if (!same_identity(peer, connection_.peer_identity())) {
            throw handoffkit::csp::SecurityError(
                "browser_response_identity_mismatch",
                "Browser Real response peer_identity does not match certificate identity");
        }
        const auto transcript = response.metadata.value(
            "security_transcript", nlohmann::json::object());
        (void)handoffkit::csp::SecurityTranscript::verify(transcript, {
            .protocol_version = response.protocol_version_value,
            .requested_profile = handoffkit::csp::SecurityProfile::Standard,
            .selected_profile = handoffkit::csp::SecurityProfile::Standard,
            .sender = connection_.peer_identity(),
            .receiver = identity_,
            .tls_version = connection_.negotiated_protocol(),
            .negotiated_group = std::nullopt,
            .session_id = response.session_id,
            .handshake_nonce = nonce,
            .timestamp = response.created_at,
        });
    }

    static std::string now_rfc3339() {
        const auto now = std::chrono::system_clock::now();
        const auto epoch = std::chrono::system_clock::to_time_t(now);
        std::tm utc{};
#ifdef _WIN32
        if (gmtime_s(&utc, &epoch) != 0) throw std::runtime_error("could not format UTC time");
#else
        if (gmtime_r(&epoch, &utc) == nullptr) throw std::runtime_error("could not format UTC time");
#endif
        std::ostringstream output;
        output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%S") << ".000Z";
        return output.str();
    }

    handoffkit::csp::TlsConnection connection_;
    handoffkit::csp::PeerIdentity identity_;
    std::uint64_t sequence_{0};
    std::uint64_t last_response_sequence_{0};
    std::unordered_set<std::string> seen_response_nonces_;
};

}  // namespace browser
}  // namespace handoffkit
