#ifndef HANDOFFKIT_CSP_DISPATCHER_HPP
#define HANDOFFKIT_CSP_DISPATCHER_HPP

#include <handoffkit/csp/contracts.hpp>
#include <handoffkit/csp/security.hpp>
#include <handoffkit/csp/tls_transport.hpp>
#include <handoffkit/error.hpp>

#include <functional>
#include <filesystem>
#include <memory>
#include <mutex>
#include <nlohmann/json.hpp>

namespace handoffkit::csp {

struct DispatcherOptions {
    bool reject_declared_capability_claims{true};
};

/// Checksummed, private, atomically replaced replay state for long-lived
/// secure listeners. It persists cryptographic replay markers only; business
/// deduplication remains a separate scheduler concern.
class DurableReplayProtection {
public:
    explicit DurableReplayProtection(
        std::filesystem::path state_path,
        std::size_t max_state_bytes = 1024U * 1024U);

    [[nodiscard]] ReplayProtection& protection() noexcept { return protection_; }
    [[nodiscard]] const ReplayProtection& protection() const noexcept { return protection_; }
    void persist();
    /// Create a validated, private, atomically replaced replay backup.
    void backup(const std::filesystem::path& destination);
    /// Restore a validated replay backup and atomically replace live state.
    void restore(const std::filesystem::path& source);

private:
    std::filesystem::path state_path_;
    std::size_t max_state_bytes_;
    ReplayProtection protection_;
    mutable std::mutex persist_mutex_;
};

/// Authenticated HK-CSP receive path for the C++ TLS transport.
///
/// The execution order is fixed: receive frame, decode/validate envelope,
/// authenticate the certificate-bound peer, check replay, authorize locally,
/// then invoke the handler. Peer JSON never supplies capabilities.
class CspDispatcher {
public:
    using Handler = std::function<Result<nlohmann::json>(
        const PeerIdentity&, const MessageEnvelope&)>;

    CspDispatcher(TlsConnection& connection,
                  ReplayProtection& replay,
                  CapabilityPolicy policy = CapabilityPolicy{},
                  DispatcherOptions options = {});

    [[nodiscard]] Result<nlohmann::json> receive_and_dispatch(const Handler& handler);

private:
    TlsConnection& connection_;
    ReplayProtection& replay_;
    CapabilityPolicy policy_;
    DispatcherOptions options_;
};

}  // namespace handoffkit::csp

#endif
