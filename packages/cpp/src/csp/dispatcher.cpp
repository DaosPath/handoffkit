#include <handoffkit/csp/dispatcher.hpp>

#include <chrono>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

#if defined(HANDOFFKIT_WITH_CRYPTO)
#include <openssl/evp.h>
#endif

namespace handoffkit::csp {
namespace {

[[noreturn]] void replay_state_fail(const std::string& message) {
    throw SecurityError("replay_state_invalid", "durable replay state: " + message);
}

bool regular_private_file(const std::filesystem::path& path) {
    std::error_code error;
    const auto status = std::filesystem::symlink_status(path, error);
    if (error || !std::filesystem::is_regular_file(status) || std::filesystem::is_symlink(status)) {
        return false;
    }
#ifndef _WIN32
    const auto permissions = std::filesystem::status(path, error).permissions();
    if (error || (permissions & (std::filesystem::perms::group_read |
                                 std::filesystem::perms::group_write |
                                 std::filesystem::perms::group_exec |
                                 std::filesystem::perms::others_read |
                                 std::filesystem::perms::others_write |
                                 std::filesystem::perms::others_exec)) != std::filesystem::perms::none) {
        return false;
    }
#endif
    return true;
}

void ensure_replay_parent(const std::filesystem::path& path) {
    if (path.empty()) replay_state_fail("state path is required");
    std::error_code error;
    if (!path.parent_path().empty()) std::filesystem::create_directories(path.parent_path(), error);
    if (error) replay_state_fail("state parent cannot be created");
    if (std::filesystem::exists(path) && !regular_private_file(path)) {
        replay_state_fail("state path must be a private regular file");
    }
}

#if defined(HANDOFFKIT_WITH_CRYPTO)
std::string replay_hex(const unsigned char* data, unsigned int size) {
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int index = 0; index < size; ++index) {
        output << std::setw(2) << static_cast<unsigned int>(data[index]);
    }
    return output.str();
}

std::string replay_checksum(const nlohmann::json& payload) {
    const auto encoded = payload.dump();
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int size = 0;
    if (EVP_Digest(
            encoded.data(), encoded.size(), digest, &size, EVP_sha256(), nullptr) != 1 ||
        size != 32) {
        replay_state_fail("SHA-256 provider failed");
    }
    return "sha256:" + replay_hex(digest, size);
}
#endif

std::string replay_token() {
    return std::to_string(static_cast<unsigned long long>(
        std::chrono::high_resolution_clock::now().time_since_epoch().count()));
}

void flush_replay_file(const std::filesystem::path& path) {
#ifdef _WIN32
    const auto handle = CreateFileW(
        path.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) replay_state_fail("state file cannot be flushed");
    const auto ok = FlushFileBuffers(handle) != 0;
    CloseHandle(handle);
    if (!ok) replay_state_fail("state file flush failed");
#else
    const auto descriptor = ::open(path.c_str(), O_RDONLY);
    if (descriptor < 0 || ::fsync(descriptor) != 0) {
        if (descriptor >= 0) ::close(descriptor);
        replay_state_fail("state file flush failed");
    }
    ::close(descriptor);
#endif
}

[[maybe_unused]] void write_replay_state(
    const std::filesystem::path& destination,
    const std::string& encoded,
    std::size_t max_bytes) {
    if (encoded.size() > max_bytes) replay_state_fail("encoded state exceeds configured size");
    ensure_replay_parent(destination);
    const auto temporary = destination.parent_path() /
        ("." + destination.filename().string() + "." + replay_token() + ".tmp");
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) replay_state_fail("temporary state cannot be opened");
        output << encoded;
        output.flush();
        if (!output) replay_state_fail("state write failed");
    }
#ifndef _WIN32
    std::error_code permissions_error;
    std::filesystem::permissions(
        temporary,
        std::filesystem::perms::owner_read | std::filesystem::perms::owner_write,
        std::filesystem::perm_options::replace,
        permissions_error);
    if (permissions_error) {
        std::filesystem::remove(temporary);
        replay_state_fail("state permissions cannot be restricted");
    }
#endif
    try {
        flush_replay_file(temporary);
#ifdef _WIN32
        if (!MoveFileExW(
                temporary.wstring().c_str(), destination.wstring().c_str(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
            replay_state_fail("state replacement failed");
        }
#else
        std::error_code error;
        std::filesystem::rename(temporary, destination, error);
        if (error) replay_state_fail("state replacement failed");
        if (!destination.parent_path().empty()) {
            const auto descriptor = ::open(destination.parent_path().c_str(), O_RDONLY);
            if (descriptor < 0 || ::fsync(descriptor) != 0) {
                if (descriptor >= 0) ::close(descriptor);
                replay_state_fail("state directory flush failed");
            }
            ::close(descriptor);
        }
#endif
    } catch (...) {
        std::error_code cleanup_error;
        std::filesystem::remove(temporary, cleanup_error);
        throw;
    }
}

[[maybe_unused]] std::string read_replay_state(const std::filesystem::path& path, std::size_t max_bytes) {
    ensure_replay_parent(path);
    std::ifstream input(path, std::ios::binary);
    if (!input) replay_state_fail("state cannot be read");
    input.seekg(0, std::ios::end);
    const auto length = input.tellg();
    if (length < 0 || static_cast<std::uintmax_t>(length) > max_bytes) {
        replay_state_fail("state exceeds configured size");
    }
    input.seekg(0, std::ios::beg);
    std::string encoded(static_cast<std::size_t>(length), '\0');
    input.read(encoded.data(), static_cast<std::streamsize>(encoded.size()));
    if (!input && !encoded.empty()) replay_state_fail("state cannot be read");
    return encoded;
}

#if defined(HANDOFFKIT_WITH_CRYPTO)
nlohmann::json load_replay_payload(
    const std::filesystem::path& path,
    std::size_t max_bytes) {
    auto envelope = nlohmann::json::parse(read_replay_state(path, max_bytes));
    if (!envelope.is_object() || !envelope.contains("checksum")) {
        replay_state_fail("state envelope is invalid");
    }
    const auto checksum = envelope.at("checksum").get<std::string>();
    envelope.erase("checksum");
    if (checksum != replay_checksum(envelope)) {
        replay_state_fail("state checksum mismatch");
    }
    const auto version = envelope.value("format_version", 0);
    if (version == 0) {
        // The v0 replay envelope had the same bounded maps but did not carry
        // an explicit current schema marker. Normalize it before restore and
        // persist a v1 envelope below.
        envelope["format_version"] = 1;
    } else if (version != 1) {
        replay_state_fail("unsupported replay state format version");
    }
    return envelope;
}
#endif

}  // namespace

DurableReplayProtection::DurableReplayProtection(
    std::filesystem::path state_path,
    std::size_t max_state_bytes)
    : state_path_(std::move(state_path)), max_state_bytes_(max_state_bytes) {
    if (max_state_bytes_ < 1024) replay_state_fail("configured size is too small");
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    throw SecurityError(
        "replay_store_unavailable",
        "durable replay state requires HANDOFFKIT_WITH_CRYPTO=ON");
#else
    ensure_replay_parent(state_path_);
    if (!std::filesystem::exists(state_path_)) {
        persist();
        return;
    }
    try {
        const auto encoded = read_replay_state(state_path_, max_state_bytes_);
        auto envelope = load_replay_payload(state_path_, max_state_bytes_);
        const auto legacy = nlohmann::json::parse(encoded).value("format_version", 0) == 0;
        protection_.restore_json(envelope);
        if (legacy) persist();
    } catch (...) {
        const auto quarantine = state_path_.parent_path() /
            (state_path_.filename().string() + ".quarantine-" + replay_token());
        std::error_code error;
        std::filesystem::rename(state_path_, quarantine, error);
        if (error) throw;
        throw;
    }
#endif
}

void DurableReplayProtection::persist() {
    std::lock_guard lock(persist_mutex_);
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    throw SecurityError(
        "replay_store_unavailable",
        "durable replay state requires HANDOFFKIT_WITH_CRYPTO=ON");
#else
    auto payload = protection_.snapshot_json();
    auto envelope = payload;
    envelope["checksum"] = replay_checksum(payload);
    write_replay_state(state_path_, envelope.dump(), max_state_bytes_);
#endif
}

void DurableReplayProtection::backup(const std::filesystem::path& destination) {
    std::lock_guard lock(persist_mutex_);
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    static_cast<void>(destination);
    throw SecurityError(
        "replay_store_unavailable",
        "durable replay state requires HANDOFFKIT_WITH_CRYPTO=ON");
#else
    const auto payload = protection_.snapshot_json();
    auto envelope = payload;
    envelope["checksum"] = replay_checksum(payload);
    write_replay_state(destination, envelope.dump(), max_state_bytes_);
#endif
}

void DurableReplayProtection::restore(const std::filesystem::path& source) {
    std::lock_guard lock(persist_mutex_);
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    static_cast<void>(source);
    throw SecurityError(
        "replay_store_unavailable",
        "durable replay state requires HANDOFFKIT_WITH_CRYPTO=ON");
#else
    const auto payload = load_replay_payload(source, max_state_bytes_);
    protection_.restore_json(payload);
    const auto normalized = protection_.snapshot_json();
    auto envelope = normalized;
    envelope["checksum"] = replay_checksum(normalized);
    write_replay_state(state_path_, envelope.dump(), max_state_bytes_);
#endif
}

CspDispatcher::CspDispatcher(TlsConnection& connection,
                             ReplayProtection& replay,
                             CapabilityPolicy policy,
                             DispatcherOptions options)
    : connection_(connection), replay_(replay), policy_(std::move(policy)), options_(options) {}

Result<nlohmann::json> CspDispatcher::receive_and_dispatch(const Handler& handler) {
    if (!handler) return Result<nlohmann::json>::failure(Error::invalid_argument("handler is required", "handler"));
    try {
        const auto raw = connection_.receive_json();
        auto envelope = MessageEnvelope::from_json(raw);
        const auto& identity = connection_.peer_identity();
        if (!identity.is_valid_at()) {
            throw SecurityError("authentication_failed", "TLS peer certificate identity is expired or not yet valid");
        }
        if (envelope.source != identity.peer_id) {
            throw SecurityError(
                "tls_identity_mismatch",
                "HK-CSP envelope source does not match the certificate-bound peer identity",
                {{"declared_source", envelope.source}, {"certificate_peer_id", identity.peer_id}});
        }
        if (options_.reject_declared_capability_claims && envelope.metadata.contains("capabilities")) {
            throw SecurityError(
                "capability_claim_rejected",
                "capabilities must come from local certificate policy, not peer JSON");
        }
        std::optional<std::string> nonce;
        if (envelope.metadata.contains("nonce")) {
            if (!envelope.metadata.at("nonce").is_string()) {
                throw SecurityError("replay_nonce_invalid", "HK-CSP nonce metadata must be a string");
            }
            nonce = envelope.metadata.at("nonce").get<std::string>();
        }
        const auto created_at = timestamp_epoch_seconds("created_at", envelope.created_at);
        replay_.check_and_record(
            identity.credential_fingerprint,
            envelope.session_id,
            envelope.sequence,
            nonce,
            created_at);
        const auto operation = envelope.payload_type.empty() ? envelope.kind : envelope.payload_type;
        std::optional<std::string> compatibility_operation;
        if (operation == "training_job") compatibility_operation = "job:training";
        else if (operation == "evaluation_job") compatibility_operation = "job:evaluation";
        else if (operation == "job_cancel") compatibility_operation = "job:cancel";
        else if (operation == "worker_capabilities") compatibility_operation = "worker:inspect";
        else if (operation == "session_close") compatibility_operation = "session:close";
        const bool authorized = policy_.is_operation_authorized(operation, &identity) ||
            (compatibility_operation.has_value() &&
             policy_.is_operation_authorized(*compatibility_operation, &identity));
        if (!authorized) {
            throw SecurityError(
                "authorization_denied",
                "certificate-bound peer is not authorized for the requested operation",
                {{"operation", operation}, {"peer_id", identity.peer_id}});
        }
        return handler(identity, envelope);
    } catch (const SecurityError&) {
        throw;
    } catch (const std::exception& error) {
        return Result<nlohmann::json>::failure(Error::parse_error(error.what()));
    }
}

}  // namespace handoffkit::csp
