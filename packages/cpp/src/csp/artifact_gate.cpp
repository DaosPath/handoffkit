#include <handoffkit/csp/artifact_gate.hpp>

#if defined(HANDOFFKIT_WITH_CRYPTO)
#include <openssl/evp.h>
#include <openssl/rand.h>
#endif

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <utility>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace handoffkit::csp {
namespace {

class SourceHandle {
public:
#if defined(_WIN32)
    explicit SourceHandle(HANDLE handle) : handle_(handle) {}
    ~SourceHandle() {
        if (handle_ != INVALID_HANDLE_VALUE) CloseHandle(handle_);
    }
    SourceHandle(SourceHandle&& other) noexcept : handle_(std::exchange(other.handle_, INVALID_HANDLE_VALUE)) {}
    HANDLE get() const noexcept { return handle_; }

private:
    HANDLE handle_{INVALID_HANDLE_VALUE};
#else
    explicit SourceHandle(int handle) : handle_(handle) {}
    ~SourceHandle() {
        if (handle_ >= 0) close(handle_);
    }
    SourceHandle(SourceHandle&& other) noexcept : handle_(std::exchange(other.handle_, -1)) {}
    int get() const noexcept { return handle_; }

private:
    int handle_{-1};
#endif
    SourceHandle(const SourceHandle&) = delete;
    SourceHandle& operator=(const SourceHandle&) = delete;
};

std::filesystem::path path_from_file_uri(const std::string& uri) {
    constexpr std::string_view prefix = "file://";
    if (!uri.starts_with(prefix)) {
        throw SecurityError(
            "artifact_uri_unsupported", "Artifact ingestion accepts only local file:// URIs.");
    }
    auto value = uri.substr(prefix.size());
#if defined(_WIN32)
    if (value.size() >= 3 && value[0] == '/' && value[2] == ':') value.erase(value.begin());
#endif
    if (value.empty()) {
        throw SecurityError("artifact_uri_invalid", "Artifact file URI has no path.");
    }
    return std::filesystem::path(value);
}

std::string file_uri(const std::filesystem::path& path) {
    const auto value = std::filesystem::absolute(path).generic_string();
#if defined(_WIN32)
    return "file:///" + value;
#else
    return "file://" + value;
#endif
}

bool path_has_prefix(
    const std::filesystem::path& candidate,
    const std::filesystem::path& root) {
    auto candidate_part = candidate.begin();
    for (auto root_part = root.begin(); root_part != root.end(); ++root_part, ++candidate_part) {
        if (candidate_part == candidate.end()) return false;
#if defined(_WIN32)
        auto left = candidate_part->wstring();
        auto right = root_part->wstring();
        std::transform(left.begin(), left.end(), left.begin(), ::towlower);
        std::transform(right.begin(), right.end(), right.begin(), ::towlower);
        if (left != right) return false;
#else
        if (*candidate_part != *root_part) return false;
#endif
    }
    return true;
}

std::filesystem::path canonical_existing(const std::filesystem::path& path, const char* code) {
    std::error_code error;
    auto canonical = std::filesystem::canonical(path, error);
    if (error) throw SecurityError(code, "Artifact path cannot be resolved.");
    return canonical;
}

void require_allowed_path(
    const std::filesystem::path& canonical,
    const std::vector<std::filesystem::path>& roots) {
    for (const auto& root : roots) {
        if (path_has_prefix(canonical, root)) return;
    }
    throw SecurityError(
        "artifact_path_denied", "Artifact path is outside every locally allowed root.");
}

SourceHandle open_source(const std::filesystem::path& path, std::uint64_t& size) {
#if defined(_WIN32)
    const auto handle = CreateFileW(
        path.c_str(),
        GENERIC_READ,
        FILE_SHARE_READ,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN,
        nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
        throw SecurityError("artifact_unavailable", "Artifact cannot be opened.");
    }
    SourceHandle source(handle);
    BY_HANDLE_FILE_INFORMATION info{};
    if (!GetFileInformationByHandle(handle, &info) ||
        (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
        (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
        throw SecurityError(
            "artifact_symlink_denied", "Artifact must be a non-reparse regular file.");
    }
    ULARGE_INTEGER length{};
    length.HighPart = info.nFileSizeHigh;
    length.LowPart = info.nFileSizeLow;
    size = length.QuadPart;
    return source;
#else
    int flags = O_RDONLY | O_CLOEXEC;
#if defined(O_NOFOLLOW)
    flags |= O_NOFOLLOW;
#endif
    const auto handle = open(path.c_str(), flags);
    if (handle < 0) throw SecurityError("artifact_unavailable", "Artifact cannot be opened.");
    SourceHandle source(handle);
    struct stat info {};
    if (fstat(handle, &info) != 0 || !S_ISREG(info.st_mode)) {
        throw SecurityError("artifact_symlink_denied", "Artifact must be a regular file.");
    }
    if (info.st_size < 0) throw SecurityError("artifact_unavailable", "Artifact size is invalid.");
    size = static_cast<std::uint64_t>(info.st_size);
    return source;
#endif
}

std::vector<unsigned char> read_source(
    SourceHandle& source,
    std::uint64_t expected_size,
    std::uint64_t max_size) {
    if (expected_size > max_size || expected_size > std::numeric_limits<std::size_t>::max()) {
        throw SecurityError("artifact_too_large", "Artifact exceeds the configured size limit.");
    }
    std::vector<unsigned char> data;
    data.reserve(static_cast<std::size_t>(expected_size));
    std::array<unsigned char, 64 * 1024> buffer{};
    for (;;) {
#if defined(_WIN32)
        DWORD count = 0;
        if (!ReadFile(
                source.get(),
                buffer.data(),
                static_cast<DWORD>(buffer.size()),
                &count,
                nullptr)) {
            throw SecurityError("artifact_unavailable", "Artifact cannot be read.");
        }
        if (count == 0) break;
        const auto bytes_read = static_cast<std::size_t>(count);
#else
        const auto count = read(source.get(), buffer.data(), buffer.size());
        if (count < 0) throw SecurityError("artifact_unavailable", "Artifact cannot be read.");
        if (count == 0) break;
        const auto bytes_read = static_cast<std::size_t>(count);
#endif
        if (data.size() > static_cast<std::size_t>(max_size) - bytes_read) {
            throw SecurityError("artifact_too_large", "Artifact grew beyond the configured limit.");
        }
        data.insert(data.end(), buffer.begin(), buffer.begin() + bytes_read);
    }
    if (data.size() != expected_size) {
        throw SecurityError("artifact_changed", "Artifact changed while it was being ingested.");
    }
    return data;
}

std::string sha256_hex(const std::vector<unsigned char>& data) {
#if defined(HANDOFFKIT_WITH_CRYPTO)
    std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
    unsigned int size = 0;
    if (EVP_Digest(
            data.data(), data.size(), digest.data(), &size, EVP_sha256(), nullptr) != 1 ||
        size != 32) {
        throw SecurityError("crypto_provider_error", "OpenSSL SHA-256 failed.");
    }
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int index = 0; index < size; ++index) {
        output << std::setw(2) << static_cast<unsigned int>(digest[index]);
    }
    return output.str();
#else
    (void)data;
    throw SecurityError(
        "artifact_gate_provider_unavailable",
        "C++ artifact ingestion requires HANDOFFKIT_WITH_CRYPTO=ON.");
#endif
}

std::string random_token() {
#if defined(HANDOFFKIT_WITH_CRYPTO)
    std::array<unsigned char, 16> bytes{};
    if (RAND_bytes(bytes.data(), static_cast<int>(bytes.size())) != 1) {
        throw SecurityError("crypto_provider_error", "OpenSSL random generation failed.");
    }
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (const auto value : bytes) output << std::setw(2) << static_cast<unsigned int>(value);
    return output.str();
#else
    throw SecurityError(
        "artifact_gate_provider_unavailable",
        "C++ artifact ingestion requires HANDOFFKIT_WITH_CRYPTO=ON.");
#endif
}

void make_private_directory(const std::filesystem::path& directory) {
    std::error_code error;
    std::filesystem::create_directories(directory, error);
    if (error) {
        throw SecurityError("artifact_snapshot_failed", "Artifact snapshot directory is unavailable.");
    }
#if !defined(_WIN32)
    std::filesystem::permissions(
        directory,
        std::filesystem::perms::owner_all,
        std::filesystem::perm_options::replace,
        error);
    if (error) {
        throw SecurityError("artifact_snapshot_failed", "Artifact snapshot permissions are unsafe.");
    }
#endif
}

std::filesystem::path write_snapshot(
    const std::filesystem::path& directory,
    const std::vector<unsigned char>& data) {
    make_private_directory(directory);
    const auto token = random_token();
    const auto temporary = directory / ("." + token + ".tmp");
    const auto destination = directory / (token + ".artifact");
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) {
            throw SecurityError("artifact_snapshot_failed", "Artifact snapshot cannot be created.");
        }
        output.write(
            reinterpret_cast<const char*>(data.data()),
            static_cast<std::streamsize>(data.size()));
        output.flush();
        if (!output) {
            std::error_code ignored;
            std::filesystem::remove(temporary, ignored);
            throw SecurityError("artifact_snapshot_failed", "Artifact snapshot cannot be written.");
        }
    }
#if !defined(_WIN32)
    std::error_code permission_error;
    std::filesystem::permissions(
        temporary,
        std::filesystem::perms::owner_read | std::filesystem::perms::owner_write,
        std::filesystem::perm_options::replace,
        permission_error);
    if (permission_error) {
        std::filesystem::remove(temporary, permission_error);
        throw SecurityError("artifact_snapshot_failed", "Artifact snapshot permissions are unsafe.");
    }
#endif
    std::error_code error;
    std::filesystem::rename(temporary, destination, error);
    if (error) {
        std::filesystem::remove(temporary, error);
        throw SecurityError("artifact_snapshot_failed", "Artifact snapshot cannot be committed.");
    }
    return destination;
}

std::string producer_identity(const ArtifactRef& artifact) {
    if (!artifact.metadata.is_object()) return {};
    const auto found = artifact.metadata.find("producer_identity");
    return found != artifact.metadata.end() && found->is_string() ? found->get<std::string>() : "";
}

std::optional<SignedArtifact> signed_metadata(const ArtifactRef& artifact) {
    if (!artifact.metadata.is_object()) return std::nullopt;
    const auto found = artifact.metadata.find("signed_artifact");
    if (found == artifact.metadata.end() || found->is_null()) return std::nullopt;
    if (!found->is_object()) {
        throw SecurityError("invalid_signed_artifact", "signed_artifact metadata must be an object.");
    }
    return SignedArtifact::from_json(*found);
}

void quarantine_failure(
    const ArtifactIngestionPolicy& policy,
    const ArtifactRef& artifact,
    const SecurityError& error) noexcept {
    if (!policy.quarantine_directory.has_value()) return;
    try {
        make_private_directory(*policy.quarantine_directory);
        const auto token = random_token();
        const auto temporary = *policy.quarantine_directory / ("." + token + ".tmp");
        const auto destination = *policy.quarantine_directory / (token + ".json");
        const auto record = nlohmann::json{
            {"artifact_id", artifact.artifact_id},
            {"code", error.code()},
            {"quarantined_at", std::chrono::duration_cast<std::chrono::seconds>(
                                   std::chrono::system_clock::now().time_since_epoch())
                                   .count()}};
        {
            std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
            output << record.dump();
            output.flush();
            if (!output) return;
        }
        std::error_code ignored;
        std::filesystem::rename(temporary, destination, ignored);
        if (ignored) std::filesystem::remove(temporary, ignored);
    } catch (...) {
        // Quarantine is evidence only. The original security error remains fail-closed.
    }
}

}  // namespace

struct VerifiedArtifact::SnapshotState {
    explicit SnapshotState(std::filesystem::path value) : path(std::move(value)) {}
    ~SnapshotState() {
        std::error_code ignored;
        std::filesystem::remove(path, ignored);
    }
    std::filesystem::path path;
};

VerifiedArtifact::VerifiedArtifact(
    ArtifactRef original,
    ArtifactRef snapshot,
    std::shared_ptr<SnapshotState> state)
    : original_(std::move(original)), snapshot_(std::move(snapshot)), state_(std::move(state)) {}

const ArtifactRef& VerifiedArtifact::original() const noexcept { return original_; }
const ArtifactRef& VerifiedArtifact::snapshot() const noexcept { return snapshot_; }
const std::filesystem::path& VerifiedArtifact::snapshot_path() const noexcept {
    return state_->path;
}

void ArtifactIngestionPolicy::validate() const {
    if (!hash_required) {
        throw SecurityError(
            "artifact_policy_invalid", "Artifact ingestion cannot disable SHA-256 verification.");
    }
    if (max_size_bytes == 0) {
        throw SecurityError("artifact_policy_invalid", "Artifact max_size_bytes must be positive.");
    }
    if (allowed_roots.empty()) {
        throw SecurityError("artifact_policy_invalid", "Artifact policy requires an allowed root.");
    }
    if (snapshot_directory.empty()) {
        throw SecurityError(
            "artifact_policy_invalid", "Artifact policy requires a snapshot directory.");
    }
    if (signature_requirement == ArtifactSignatureRequirement::Required && !signature_policy) {
        throw SecurityError(
            "artifact_policy_invalid", "Required signatures need a local trust policy.");
    }
}

ArtifactIngestionGate::ArtifactIngestionGate(ArtifactIngestionPolicy policy)
    : policy_(std::move(policy)) {
    policy_.validate();
    for (auto& root : policy_.allowed_roots) {
        root = canonical_existing(root, "artifact_policy_invalid");
    }
    std::error_code error;
    policy_.snapshot_directory = std::filesystem::absolute(policy_.snapshot_directory, error);
    if (error) throw SecurityError("artifact_policy_invalid", "Snapshot directory is invalid.");
    if (policy_.quarantine_directory.has_value()) {
        *policy_.quarantine_directory =
            std::filesystem::absolute(*policy_.quarantine_directory, error);
        if (error) throw SecurityError("artifact_policy_invalid", "Quarantine directory is invalid.");
    }
}

VerifiedArtifact ArtifactIngestionGate::ingest(
    const ArtifactRef& artifact,
    std::int64_t now) const {
    try {
        artifact.validate();
        if (!policy_.allowed_media_types.empty() &&
            !policy_.allowed_media_types.contains(artifact.media_type)) {
            throw SecurityError(
                "artifact_media_type_denied", "Artifact media type is not locally allowlisted.");
        }
        const auto canonical = canonical_existing(
            path_from_file_uri(artifact.uri), "artifact_unavailable");
        require_allowed_path(canonical, policy_.allowed_roots);
        std::uint64_t opened_size = 0;
        auto source = open_source(canonical, opened_size);
        if (opened_size > policy_.max_size_bytes) {
            throw SecurityError("artifact_too_large", "Artifact exceeds the configured size limit.");
        }
        if (opened_size != artifact.size_bytes) {
            throw SecurityError(
                "artifact_size_mismatch", "Artifact size does not match ArtifactRef.");
        }
        auto data = read_source(source, opened_size, policy_.max_size_bytes);
        auto expected_hash = artifact.sha256;
        std::transform(
            expected_hash.begin(),
            expected_hash.end(),
            expected_hash.begin(),
            [](unsigned char value) { return static_cast<char>(std::tolower(value)); });
        const auto actual_hash = sha256_hex(data);
        if (actual_hash != expected_hash) {
            throw SecurityError(
                "artifact_integrity_mismatch", "Artifact SHA-256 does not match ArtifactRef.");
        }

        const auto signature = signed_metadata(artifact);
        if (!signature.has_value() &&
            policy_.signature_requirement == ArtifactSignatureRequirement::Required) {
            throw SecurityError(
                "artifact_signature_required", "Artifact policy requires an Ed25519 signature.");
        }
        if (signature.has_value()) {
            if (signature->artifact_id != artifact.artifact_id) {
                throw SecurityError(
                    "artifact_signature_mismatch", "Signed artifact ID does not match ArtifactRef.");
            }
            if (!policy_.trusted_signers.empty() &&
                !policy_.trusted_signers.contains(signature->signer_identity)) {
                throw SecurityError(
                    "artifact_signer_denied", "Artifact signer is not locally authorized.");
            }
            if (!policy_.signature_policy) {
                throw SecurityError(
                    "artifact_signature_policy_missing",
                    "Signed artifact metadata cannot be consumed without a trust policy.");
            }
            verify_signed_artifact(
                std::string_view(
                    reinterpret_cast<const char*>(data.data()), data.size()),
                *signature,
                *policy_.signature_policy,
                now);
        }
        const auto declared_producer = producer_identity(artifact);
        if (!declared_producer.empty() && signature.has_value() &&
            declared_producer != signature->signer_identity) {
            throw SecurityError(
                "artifact_producer_mismatch",
                "Declared producer identity does not match the verified signer identity.");
        }
        if (!policy_.trusted_producers.empty() &&
            (!signature.has_value() ||
             !policy_.trusted_producers.contains(signature->signer_identity))) {
            throw SecurityError(
                "artifact_producer_denied",
                "Artifact producer is not established by an authorized signature.");
        }

        const auto snapshot_path = write_snapshot(policy_.snapshot_directory, data);
        ArtifactRef snapshot = artifact;
        snapshot.uri = file_uri(snapshot_path);
        snapshot.sha256 = actual_hash;
        snapshot.metadata["ingestion_verified"] = true;
        snapshot.metadata["ingestion_snapshot"] = true;
        auto state = std::make_shared<VerifiedArtifact::SnapshotState>(snapshot_path);
        return VerifiedArtifact(artifact, std::move(snapshot), std::move(state));
    } catch (const SecurityError& error) {
        quarantine_failure(policy_, artifact, error);
        throw;
    }
}

const ArtifactIngestionPolicy& ArtifactIngestionGate::policy() const noexcept { return policy_; }

}  // namespace handoffkit::csp
