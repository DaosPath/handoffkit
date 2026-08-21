#ifndef HANDOFFKIT_CSP_TLS_TRANSPORT_HPP
#define HANDOFFKIT_CSP_TLS_TRANSPORT_HPP

#include <handoffkit/csp/security.hpp>

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

namespace handoffkit::csp {

/// C++ TLS provider capabilities are compile-time/provider-derived, never an enum claim.
struct TlsCapabilities {
    bool tls13_supported{false};
    bool mtls_supported{false};
    bool hostname_verification{false};
    bool trust_roots_supported{false};
    bool crl_supported{false};
    bool ocsp_supported{false};
    bool ocsp_fetch_supported{false};
    bool hybrid_pq_supported{false};

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"tls13_supported", tls13_supported},
            {"mtls_supported", mtls_supported},
            {"hostname_verification", hostname_verification},
            {"trust_roots_supported", trust_roots_supported},
            {"crl_supported", crl_supported},
            {"ocsp_supported", ocsp_supported},
            {"ocsp_fetch_supported", ocsp_fetch_supported},
            {"hybrid_pq_supported", hybrid_pq_supported},
        };
    }
};

/// Returns the capabilities of the active C++ TLS provider/build.
[[nodiscard]] TlsCapabilities detect_cpp_tls_capabilities() noexcept;

/// Local authorization policy applied after certificate authentication.
/// The map key is the locally calculated sha256:<hex> certificate fingerprint.
struct TlsPeerPolicy {
    std::optional<std::string> expected_peer_id;
    std::optional<std::string> expected_node_id;
    std::optional<std::string> expected_worker_id;
    std::unordered_map<std::string, std::vector<std::string>> capabilities_by_fingerprint;
};

struct TlsTransportConfig {
    SecurityConfig security;
    TlsPeerPolicy peer_policy;
    std::string server_name;
    std::size_t max_frame_bytes{8U * 1024U * 1024U};
    std::chrono::milliseconds timeout{5000};
};

class TlsConnection {
public:
    TlsConnection() = default;
    TlsConnection(TlsConnection&&) noexcept;
    TlsConnection& operator=(TlsConnection&&) noexcept;
    TlsConnection(const TlsConnection&) = delete;
    TlsConnection& operator=(const TlsConnection&) = delete;
    ~TlsConnection();

    [[nodiscard]] bool valid() const noexcept;
    [[nodiscard]] const PeerIdentity& peer_identity() const;
    /// Identity parsed locally from this endpoint's configured certificate.
    /// Throws when provider cannot expose the local credential identity.
    [[nodiscard]] const PeerIdentity& local_identity() const;
    [[nodiscard]] std::string negotiated_protocol() const;
    [[nodiscard]] std::string negotiated_group() const;

    void send_json(const nlohmann::json& value);
    [[nodiscard]] nlohmann::json receive_json();
    void close() noexcept;

private:
    struct Impl;
    explicit TlsConnection(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> impl_;

    friend class TlsClient;
    friend class TlsServer;
};

class TlsServer {
public:
    TlsServer() = default;
    TlsServer(TlsServer&&) noexcept;
    TlsServer& operator=(TlsServer&&) noexcept;
    TlsServer(const TlsServer&) = delete;
    TlsServer& operator=(const TlsServer&) = delete;
    ~TlsServer();

    static TlsServer listen(std::string bind_host,
                            std::uint16_t port,
                            TlsTransportConfig config);
    [[nodiscard]] std::uint16_t port() const noexcept;
    [[nodiscard]] TlsConnection accept();
    /// Build and atomically install a new provider context. Existing
    /// connections keep their context; subsequent accepts use the new one.
    void reload(TlsTransportConfig config);
    void close() noexcept;

private:
    struct Impl;
    explicit TlsServer(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> impl_;
};

class TlsClient {
public:
    static TlsConnection connect(std::string host,
                                 std::uint16_t port,
                                 TlsTransportConfig config);
};

}  // namespace handoffkit::csp

#endif
