#pragma once

#include <handoffkit/csp/secure_memory.hpp>
#include <handoffkit/csp/security.hpp>

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace handoffkit::csp {

struct ArtifactSigningCredential {
    std::string signer_identity;
    std::string public_key_pem;
    std::int64_t valid_from{0};
    std::int64_t valid_until{0};
    bool revoked{false};

    [[nodiscard]] std::string fingerprint() const;
};

class ArtifactTrustPolicy {
public:
    explicit ArtifactTrustPolicy(
        std::vector<ArtifactSigningCredential> credentials,
        std::unordered_set<std::string> allowed_algorithms = {"ed25519"},
        std::int64_t max_future_skew_seconds = 10);

    [[nodiscard]] const ArtifactSigningCredential* credential_for(
        const std::string& fingerprint) const;
    [[nodiscard]] bool algorithm_allowed(const std::string& algorithm) const;
    [[nodiscard]] std::int64_t max_future_skew_seconds() const noexcept;

private:
    std::unordered_map<std::string, ArtifactSigningCredential> credentials_;
    std::unordered_set<std::string> allowed_algorithms_;
    std::int64_t max_future_skew_seconds_;
};

class ArtifactSigner {
public:
    ArtifactSigner(std::string private_key_pem, std::string signer_identity);

    [[nodiscard]] SignedArtifact sign(
        const std::string& artifact_id,
        std::string_view data,
        std::int64_t created_at = 0) const;

private:
    SecureBuffer private_key_pem_;
    std::string signer_identity_;
};

[[nodiscard]] bool artifact_signature_provider_available() noexcept;
[[nodiscard]] std::string artifact_public_key_fingerprint(
    const std::string& public_key_pem);

void verify_signed_artifact(
    std::string_view data,
    const SignedArtifact& artifact,
    const ArtifactTrustPolicy& policy,
    std::int64_t now = 0);

}  // namespace handoffkit::csp
