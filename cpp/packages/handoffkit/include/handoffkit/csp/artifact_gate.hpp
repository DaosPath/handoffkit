#pragma once

#include <handoffkit/csp/artifact_security.hpp>
#include <handoffkit/csp/contracts.hpp>

#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

namespace handoffkit::csp {

enum class ArtifactSignatureRequirement {
    Optional,
    Required,
};

struct ArtifactIngestionPolicy {
    bool hash_required{true};
    ArtifactSignatureRequirement signature_requirement{ArtifactSignatureRequirement::Optional};
    std::unordered_set<std::string> trusted_producers;
    std::unordered_set<std::string> trusted_signers;
    std::unordered_set<std::string> allowed_media_types;
    std::uint64_t max_size_bytes{64ULL * 1024ULL * 1024ULL};
    std::vector<std::filesystem::path> allowed_roots;
    std::filesystem::path snapshot_directory;
    std::optional<std::filesystem::path> quarantine_directory;
    std::shared_ptr<const ArtifactTrustPolicy> signature_policy;

    void validate() const;
};

class VerifiedArtifact {
public:
    VerifiedArtifact(VerifiedArtifact&&) noexcept = default;
    VerifiedArtifact& operator=(VerifiedArtifact&&) noexcept = default;
    VerifiedArtifact(const VerifiedArtifact&) = delete;
    VerifiedArtifact& operator=(const VerifiedArtifact&) = delete;
    ~VerifiedArtifact() = default;

    [[nodiscard]] const ArtifactRef& original() const noexcept;
    [[nodiscard]] const ArtifactRef& snapshot() const noexcept;
    [[nodiscard]] const std::filesystem::path& snapshot_path() const noexcept;

private:
    struct SnapshotState;

    friend class ArtifactIngestionGate;
    VerifiedArtifact(
        ArtifactRef original,
        ArtifactRef snapshot,
        std::shared_ptr<SnapshotState> state);

    ArtifactRef original_;
    ArtifactRef snapshot_;
    std::shared_ptr<SnapshotState> state_;
};

class ArtifactIngestionGate {
public:
    explicit ArtifactIngestionGate(ArtifactIngestionPolicy policy);

    [[nodiscard]] VerifiedArtifact ingest(
        const ArtifactRef& artifact,
        std::int64_t now = 0) const;

    [[nodiscard]] const ArtifactIngestionPolicy& policy() const noexcept;

private:
    ArtifactIngestionPolicy policy_;
};

}  // namespace handoffkit::csp
