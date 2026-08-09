#include <handoffkit/csp/durable_scheduler.hpp>

#include <algorithm>
#include <chrono>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <system_error>

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

[[noreturn]] void fail_state(const std::string& message) {
    throw std::runtime_error("durable scheduler state: " + message);
}

#if defined(HANDOFFKIT_WITH_CRYPTO)
std::string hex_lower(const unsigned char* data, std::size_t size) {
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (std::size_t index = 0; index < size; ++index) {
        output << std::setw(2) << static_cast<unsigned int>(data[index]);
    }
    return output.str();
}
#endif

bool regular_non_symlink(const std::filesystem::path& path) {
    std::error_code error;
    const auto status = std::filesystem::symlink_status(path, error);
    return !error && std::filesystem::is_regular_file(status) &&
           !std::filesystem::is_symlink(status);
}

bool requests_exactly_once(const DistributedJob& job) {
    return job.metadata.is_object() &&
           job.metadata.contains("require_exactly_once") &&
           (!job.metadata.at("require_exactly_once").is_boolean() ||
            job.metadata.at("require_exactly_once").get<bool>());
}

void ensure_private_file(const std::filesystem::path& path) {
    if (!std::filesystem::exists(path)) return;
    if (!regular_non_symlink(path)) fail_state("state path must be a regular non-symlink file");
#ifndef _WIN32
    const auto permissions = std::filesystem::status(path).permissions();
    if ((permissions & (std::filesystem::perms::group_read |
                        std::filesystem::perms::group_write |
                        std::filesystem::perms::group_exec |
                        std::filesystem::perms::others_read |
                        std::filesystem::perms::others_write |
                        std::filesystem::perms::others_exec)) != std::filesystem::perms::none) {
        fail_state("state file grants group or other permissions");
    }
#endif
}

void ensure_parent(const std::filesystem::path& path) {
    if (path.empty()) fail_state("state path is required");
    const auto parent = path.parent_path();
    std::error_code error;
    if (!parent.empty()) std::filesystem::create_directories(parent, error);
    if (error) fail_state("state parent cannot be created");
    if (!parent.empty() && !std::filesystem::is_directory(std::filesystem::status(parent, error))) {
        fail_state("state parent must be a directory");
    }
}

std::string path_token();

void flush_file(const std::filesystem::path& path) {
#ifdef _WIN32
    const auto handle = CreateFileW(
        path.wstring().c_str(),
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (handle == INVALID_HANDLE_VALUE) fail_state("state file cannot be reopened for flush");
    const auto flushed = FlushFileBuffers(handle) != 0;
    CloseHandle(handle);
    if (!flushed) fail_state("state file flush failed");
#else
    int file_flags = O_RDONLY;
#ifdef O_CLOEXEC
    file_flags |= O_CLOEXEC;
#endif
    const auto descriptor = ::open(path.c_str(), file_flags);
    if (descriptor < 0) fail_state("state file cannot be reopened for flush");
    const auto flushed = ::fsync(descriptor) == 0;
    ::close(descriptor);
    if (!flushed) fail_state("state file flush failed");
#endif
}

void replace_state_atomically(
    const std::filesystem::path& temporary,
    const std::filesystem::path& destination) {
#ifdef _WIN32
    if (!MoveFileExW(
            temporary.wstring().c_str(),
            destination.wstring().c_str(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        fail_state("state replacement failed");
    }
#else
    std::error_code error;
    std::filesystem::rename(temporary, destination, error);
    if (error) fail_state("state replacement failed");
    const auto parent = destination.parent_path();
    if (!parent.empty()) {
        int directory_flags = O_RDONLY;
#ifdef O_DIRECTORY
        directory_flags |= O_DIRECTORY;
#endif
#ifdef O_CLOEXEC
        directory_flags |= O_CLOEXEC;
#endif
        const auto descriptor = ::open(parent.c_str(), directory_flags);
        if (descriptor < 0) fail_state("state directory cannot be reopened for flush");
        const auto flushed = ::fsync(descriptor) == 0;
        ::close(descriptor);
        if (!flushed) fail_state("state directory flush failed");
    }
#endif
}

std::string read_bounded_state(
    const std::filesystem::path& path,
    std::size_t max_bytes) {
    ensure_private_file(path);
    std::ifstream input(path, std::ios::binary);
    if (!input) fail_state("state cannot be read");
    input.seekg(0, std::ios::end);
    const auto length = input.tellg();
    if (length < 0 || static_cast<std::uintmax_t>(length) > max_bytes) {
        fail_state("state exceeds configured size");
    }
    input.seekg(0, std::ios::beg);
    std::string encoded(static_cast<std::size_t>(length), '\0');
    input.read(encoded.data(), static_cast<std::streamsize>(encoded.size()));
    if (!input && !encoded.empty()) fail_state("state cannot be read");
    return encoded;
}

nlohmann::json decode_checked_state(
    const std::string& encoded) {
    nlohmann::json value;
    try {
        value = nlohmann::json::parse(encoded);
    } catch (const std::exception& error) {
        fail_state(std::string("state cannot be decoded: ") + error.what());
    }
    if (!value.is_object() || value.value("format", "") != durable_scheduler_state_format) {
        fail_state("state format is unsupported");
    }
    const auto version = value.value("format_version", 0U);
    if (version != 0U && version != durable_scheduler_state_version) {
        fail_state("state version is unsupported");
    }
    auto payload = value;
    const auto checksum = payload.value("checksum", "");
    payload.erase("checksum");
    if (checksum.empty() || checksum != DurableScheduler::checksum_for_payload(payload)) {
        fail_state("state checksum mismatch");
    }
    return value;
}

void write_state_atomically(
    const std::filesystem::path& destination,
    const std::string& encoded,
    std::size_t max_bytes) {
    if (encoded.size() > max_bytes) fail_state("encoded state exceeds configured size");
    ensure_parent(destination);
    if (std::filesystem::exists(destination)) ensure_private_file(destination);
    const auto temporary = destination.parent_path() /
        ("." + destination.filename().string() + "." + path_token() + ".tmp");
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) fail_state("temporary state cannot be opened");
        output << encoded;
        output.flush();
        if (!output) fail_state("state write failed before commit");
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
        fail_state("state permissions cannot be restricted");
    }
#endif
    try {
        flush_file(temporary);
        replace_state_atomically(temporary, destination);
    } catch (...) {
        std::error_code cleanup_error;
        std::filesystem::remove(temporary, cleanup_error);
        throw;
    }
}

std::string path_token() {
    const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
    return std::to_string(static_cast<unsigned long long>(now));
}

std::string timestamp_from_time(std::chrono::system_clock::time_point value) {
    const auto seconds = std::chrono::time_point_cast<std::chrono::seconds>(value);
    const auto time = std::chrono::system_clock::to_time_t(seconds);
    std::tm utc{};
#ifdef _WIN32
    if (gmtime_s(&utc, &time) != 0) fail_state("could not format timestamp");
#else
    if (gmtime_r(&time, &utc) == nullptr) fail_state("could not format timestamp");
#endif
    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return output.str();
}

}  // namespace

DurableScheduler::DurableScheduler(DurableSchedulerOptions options)
    : options_(std::move(options)) {
    if (options_.max_state_bytes < 1024 || options_.queue_capacity == 0) {
        fail_state("bounds are invalid");
    }
    if (options_.require_exactly_once) {
        throw SecurityError(
            "exactly_once_unavailable",
            "C++ durable scheduler has no transactional external-effect provider; refusing fallback to at-least-once.");
    }
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    fail_state("SHA-256 provider is unavailable; configure HANDOFFKIT_WITH_CRYPTO=ON");
#endif
    load_or_initialize();
}

std::string DurableScheduler::checksum_for_payload(const nlohmann::json& payload) {
#if defined(HANDOFFKIT_WITH_CRYPTO)
    const auto canonical = payload.dump();
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int size = 0;
    if (EVP_Digest(canonical.data(), canonical.size(), digest, &size, EVP_sha256(), nullptr) != 1 || size != 32) {
        fail_state("OpenSSL SHA-256 failed");
    }
    return "sha256:" + hex_lower(digest, size);
#else
    (void)payload;
    fail_state("SHA-256 provider is unavailable");
#endif
}

void DurableScheduler::load_or_initialize() {
    ensure_parent(options_.state_path);
    ensure_private_file(options_.state_path);
    if (!std::filesystem::exists(options_.state_path)) {
        persist();
        return;
    }
    std::string encoded;
    {
        std::ifstream input(options_.state_path, std::ios::binary);
        if (!input) fail_state("state cannot be read");
        input.seekg(0, std::ios::end);
        const auto length = input.tellg();
        if (length < 0 || static_cast<std::uintmax_t>(length) > options_.max_state_bytes) {
            quarantine("state exceeds configured size");
            fail_state("state exceeds configured size");
        }
        input.seekg(0, std::ios::beg);
        encoded.assign(static_cast<std::size_t>(length), '\0');
        input.read(encoded.data(), static_cast<std::streamsize>(encoded.size()));
        if (!input && !encoded.empty()) fail_state("state cannot be read");
    }
    try {
        load_state(nlohmann::json::parse(encoded));
    } catch (const std::exception& error) {
        quarantine(error.what());
        throw;
    }
}

void DurableScheduler::load_state(const nlohmann::json& value) {
    if (!value.is_object() || !value.contains("format") || !value.contains("format_version") ||
        value.value("format", "") != durable_scheduler_state_format) {
        fail_state("format is unsupported");
    }
    auto payload = value;
    const auto checksum = payload.value("checksum", "");
    payload.erase("checksum");
    const auto version = payload.value("format_version", 0U);
    bool migrated = false;
    if (version == 0) {
        const std::vector<std::string> allowed = {
            "completed", "failed", "format", "format_version", "generation", "inflight", "queued", "seen"};
        for (const auto& key : payload.items()) {
            if (std::find(allowed.begin(), allowed.end(), key.key()) == allowed.end()) {
                fail_state("legacy state contains unsupported fields");
            }
        }
        if (!payload.contains("inflight") || !payload.contains("queued") || !payload.contains("seen") ||
            !payload.contains("completed") || !payload.contains("failed") || !payload.contains("generation")) {
            fail_state("legacy state is incomplete");
        }
        if (checksum.empty() || checksum != checksum_for_payload(payload)) fail_state("legacy checksum mismatch");
        payload["format_version"] = durable_scheduler_state_version;
        payload["interrupted"] = nlohmann::json::array();
        migrated = true;
    } else if (version != durable_scheduler_state_version) {
        fail_state("state version is unsupported");
    } else {
        if (checksum.empty() || checksum != checksum_for_payload(payload)) fail_state("checksum mismatch");
    }

    if (!payload.contains("queued") || !payload.at("queued").is_array() ||
        !payload.contains("inflight") || !payload.at("inflight").is_array() ||
        !payload.contains("interrupted") || !payload.at("interrupted").is_array() ||
        !payload.contains("seen") || !payload.at("seen").is_array()) {
        fail_state("state collections are invalid");
    }
    generation_ = payload.value("generation", 0ULL);
    completed_ = payload.value("completed", 0ULL);
    failed_ = payload.value("failed", 0ULL);
    for (const auto& item : payload.at("queued")) queued_.push_back(queued_from_json(item));
    for (const auto& item : payload.at("inflight")) inflight_.push_back(assignment_from_json(item));
    for (const auto& item : payload.at("interrupted")) interrupted_.push_back(interrupted_from_json(item));
    for (const auto& item : payload.at("seen")) seen_.push_back(seen_from_json(item));
    if (live_count() > options_.queue_capacity) fail_state("state exceeds queue capacity");

    if (!inflight_.empty()) {
        for (auto& record : inflight_) interrupted_.push_back({std::move(record), "scheduler_restart"});
        inflight_.clear();
        persist();
    }
    if (migrated) persist();
    if (options_.auto_resume && !interrupted_.empty()) {
        std::sort(interrupted_.begin(), interrupted_.end(), [](const auto& left, const auto& right) {
            if (left.record.job.job_id != right.record.job.job_id) return left.record.job.job_id < right.record.job.job_id;
            return left.record.assignment.attempt < right.record.assignment.attempt;
        });
        if (queued_.size() + interrupted_.size() > options_.queue_capacity) {
            fail_state("auto-resume would exceed queue capacity");
        }
        for (auto& value : interrupted_) {
            queued_.push_back({value.record.job, value.record.assignment.attempt + 1});
        }
        interrupted_.clear();
        persist();
    }
}

void DurableScheduler::quarantine(const std::string& reason) {
    if (!std::filesystem::exists(options_.state_path)) return;
    const auto destination = options_.state_path.parent_path() /
        (options_.state_path.filename().string() + ".quarantine-" + path_token());
    std::error_code error;
    std::filesystem::rename(options_.state_path, destination, error);
    if (error) {
        throw std::runtime_error("durable scheduler state: invalid state could not be quarantined: " + reason);
    }
}

nlohmann::json DurableScheduler::payload_json() const {
    nlohmann::json queued = nlohmann::json::array();
    for (const auto& item : queued_) queued.push_back(queued_json(item));
    nlohmann::json inflight = nlohmann::json::array();
    for (const auto& item : inflight_) inflight.push_back(assignment_json(item));
    nlohmann::json interrupted = nlohmann::json::array();
    for (const auto& item : interrupted_) interrupted.push_back(interrupted_json(item));
    nlohmann::json seen = nlohmann::json::array();
    for (const auto& item : seen_) seen.push_back(seen_json(item));
    return {
        {"completed", completed_},
        {"failed", failed_},
        {"format", durable_scheduler_state_format},
        {"format_version", durable_scheduler_state_version},
        {"generation", generation_},
        {"inflight", std::move(inflight)},
        {"interrupted", std::move(interrupted)},
        {"queued", std::move(queued)},
        {"seen", std::move(seen)},
    };
}

void DurableScheduler::persist() {
    ensure_parent(options_.state_path);
    auto payload = payload_json();
    payload["generation"] = generation_ + 1;
    auto envelope = payload;
    envelope["checksum"] = checksum_for_payload(payload);
    const auto encoded = envelope.dump();
    write_state_atomically(options_.state_path, encoded, options_.max_state_bytes);
    generation_ = payload.at("generation").get<std::uint64_t>();
}

Result<void> DurableScheduler::enqueue(const DistributedJob& job, std::uint32_t attempt) {
    std::lock_guard lock(mutex_);
    try {
        job.validate();
        if (requests_exactly_once(job)) {
            return Result<void>::failure(Error::security_unavailable(
                "exactly_once_unavailable",
                "Exactly-once external effects are unavailable; refusing fallback to at-least-once."));
        }
        if (attempt == 0) return Result<void>::failure(Error::invalid_argument("attempt must be at least 1", "attempt"));
        if (has_seen(job)) return Result<void>::success();
        if (live_count() >= options_.queue_capacity) {
            return Result<void>::failure(Error::validation_failed("durable scheduler queue capacity exhausted", "queue"));
        }
        queued_.push_back({job, attempt});
        seen_.push_back({job.idempotency_key, job.job_id});
        try {
            persist();
        } catch (...) {
            queued_.pop_back();
            seen_.pop_back();
            throw;
        }
        return Result<void>::success();
    } catch (const std::exception& error) {
        return Result<void>::failure(Error::parse_error(error.what()));
    }
}

Result<void> DurableScheduler::claim(const DistributedJob& job, std::uint32_t attempt) {
    std::lock_guard lock(mutex_);
    try {
        job.validate();
        if (requests_exactly_once(job)) {
            return Result<void>::failure(Error::security_unavailable(
                "exactly_once_unavailable",
                "Exactly-once external effects are unavailable; refusing fallback to at-least-once."));
        }
        if (attempt == 0) {
            return Result<void>::failure(Error::invalid_argument("attempt must be at least 1", "attempt"));
        }
        const auto found = std::find_if(queued_.begin(), queued_.end(), [&](const auto& value) {
            return value.job.job_id == job.job_id;
        });
        if (found == queued_.end()) {
            return Result<void>::failure(
                Error::validation_failed("job is not queued or was already claimed", "job_id"));
        }
        Queued queued = std::move(*found);
        queued_.erase(found);
        const auto timestamp = now_rfc3339();
        AssignmentRecord record{
            JobAssignment{
                "cpp-assignment-" + queued.job.job_id + "-" + std::to_string(attempt) +
                    "-" + std::to_string(generation_ + 1),
                queued.job.job_id,
                "cpp-runtime",
                attempt,
                timestamp,
                timestamp,
                queued.job.payload,
                {{"operation", queued.job.operation}}},
            queued.job};
        record.assignment.validate();
        inflight_.push_back(std::move(record));
        try {
            persist();
        } catch (...) {
            inflight_.pop_back();
            queued_.push_back(std::move(queued));
            throw;
        }
        return Result<void>::success();
    } catch (const std::exception& error) {
        return Result<void>::failure(Error::parse_error(error.what(), "claim"));
    }
}

Result<void> DurableScheduler::complete(std::string_view job_id) {
    std::lock_guard lock(mutex_);
    try {
        const auto found = std::find_if(inflight_.begin(), inflight_.end(), [&](const auto& value) {
            return value.job.job_id == job_id;
        });
        if (found == inflight_.end()) {
            return Result<void>::failure(
                Error::validation_failed("job is not inflight", "job_id"));
        }
        auto record = std::move(*found);
        inflight_.erase(found);
        ++completed_;
        try {
            persist();
        } catch (...) {
            --completed_;
            inflight_.push_back(std::move(record));
            throw;
        }
        return Result<void>::success();
    } catch (const std::exception& error) {
        return Result<void>::failure(Error::parse_error(error.what(), "complete"));
    }
}

Result<void> DurableScheduler::fail(std::string_view job_id) {
    std::lock_guard lock(mutex_);
    try {
        const auto found = std::find_if(inflight_.begin(), inflight_.end(), [&](const auto& value) {
            return value.job.job_id == job_id;
        });
        if (found == inflight_.end()) {
            return Result<void>::failure(
                Error::validation_failed("job is not inflight", "job_id"));
        }
        auto record = std::move(*found);
        inflight_.erase(found);
        ++failed_;
        try {
            persist();
        } catch (...) {
            --failed_;
            inflight_.push_back(std::move(record));
            throw;
        }
        return Result<void>::success();
    } catch (const std::exception& error) {
        return Result<void>::failure(Error::parse_error(error.what(), "fail"));
    }
}

std::vector<DistributedJob> DurableScheduler::recoverable_jobs() const {
    std::lock_guard lock(mutex_);
    std::vector<DistributedJob> jobs;
    jobs.reserve(queued_.size());
    for (const auto& value : queued_) jobs.push_back(value.job);
    return jobs;
}

Result<std::optional<nlohmann::json>> DurableScheduler::run_one(const Handler& handler) {
    if (!handler) return Result<std::optional<nlohmann::json>>::failure(Error::invalid_argument("handler is required", "handler"));
    Queued queued;
    AssignmentRecord record;
    {
        std::lock_guard lock(mutex_);
        if (queued_.empty()) return Result<std::optional<nlohmann::json>>::success(std::nullopt);
        queued = std::move(queued_.front());
        queued_.erase(queued_.begin());
        const auto timestamp = now_rfc3339();
        record = AssignmentRecord{
            JobAssignment{
                "cpp-assignment-" + queued.job.job_id + "-" + std::to_string(queued.attempt) + "-" + std::to_string(generation_ + 1),
                queued.job.job_id,
                "cpp-runtime",
                queued.attempt,
                timestamp,
                timestamp,
                queued.job.payload,
                {{"operation", queued.job.operation}}},
            queued.job};
        try {
            record.assignment.validate();
            inflight_.push_back(record);
            persist();
        } catch (const std::exception& error) {
            queued_.insert(queued_.begin(), std::move(queued));
            return Result<std::optional<nlohmann::json>>::failure(Error::parse_error(error.what()));
        }
    }
    try {
        auto result = handler(record.job, record.assignment.attempt);
        std::lock_guard lock(mutex_);
        const auto found = std::find_if(inflight_.begin(), inflight_.end(), [&](const auto& value) {
            return value.job.job_id == record.job.job_id &&
                   value.assignment.assignment_id == record.assignment.assignment_id;
        });
        if (found == inflight_.end()) {
            return Result<std::optional<nlohmann::json>>::failure(
                Error::validation_failed("scheduler assignment disappeared", "job_id"));
        }
        auto completed_record = std::move(*found);
        inflight_.erase(found);
        if (!result) {
            ++failed_;
            try {
                persist();
            } catch (...) {
                --failed_;
                inflight_.push_back(std::move(completed_record));
                throw;
            }
            return Result<std::optional<nlohmann::json>>::failure(result.error());
        }
        ++completed_;
        try {
            persist();
        } catch (...) {
            --completed_;
            inflight_.push_back(std::move(completed_record));
            throw;
        }
        return Result<std::optional<nlohmann::json>>::success(std::optional<nlohmann::json>(std::move(result.value())));
    } catch (const std::exception& error) {
        std::lock_guard lock(mutex_);
        const auto found = std::find_if(inflight_.begin(), inflight_.end(), [&](const auto& value) {
            return value.job.job_id == record.job.job_id &&
                   value.assignment.assignment_id == record.assignment.assignment_id;
        });
        if (found != inflight_.end()) {
            auto failed_record = std::move(*found);
            inflight_.erase(found);
            ++failed_;
            try { persist(); } catch (...) {
                --failed_;
                inflight_.push_back(std::move(failed_record));
            }
        }
        return Result<std::optional<nlohmann::json>>::failure(Error::provider_failed(error.what()));
    }
}

Result<void> DurableScheduler::retry_interrupted() {
    std::lock_guard lock(mutex_);
    if (queued_.size() + interrupted_.size() > options_.queue_capacity) {
        return Result<void>::failure(Error::validation_failed("retry would exceed durable scheduler queue capacity", "queue"));
    }
    std::sort(interrupted_.begin(), interrupted_.end(), [](const auto& left, const auto& right) {
        if (left.record.job.job_id != right.record.job.job_id) return left.record.job.job_id < right.record.job.job_id;
        return left.record.assignment.attempt < right.record.assignment.attempt;
    });
    for (auto& value : interrupted_) queued_.push_back({value.record.job, value.record.assignment.attempt + 1});
    interrupted_.clear();
    try {
        persist();
    } catch (const std::exception& error) {
        return Result<void>::failure(Error::parse_error(error.what()));
    }
    return Result<void>::success();
}

Result<void> DurableScheduler::backup(const std::filesystem::path& destination) const {
    std::lock_guard lock(mutex_);
    try {
        if (destination.empty() || std::filesystem::absolute(destination) ==
                                      std::filesystem::absolute(options_.state_path)) {
            return Result<void>::failure(
                Error::invalid_argument("backup destination must differ from the scheduler state", "destination"));
        }
        const auto encoded = read_bounded_state(options_.state_path, options_.max_state_bytes);
        static_cast<void>(decode_checked_state(encoded));
        write_state_atomically(destination, encoded, options_.max_state_bytes);
        return Result<void>::success();
    } catch (const std::exception& error) {
        return Result<void>::failure(Error::parse_error(error.what(), "backup"));
    }
}

Result<void> DurableScheduler::restore(const std::filesystem::path& source) {
    std::lock_guard lock(mutex_);
    try {
        if (source.empty() || std::filesystem::absolute(source) ==
                                  std::filesystem::absolute(options_.state_path)) {
            return Result<void>::failure(
                Error::invalid_argument("restore source must differ from the scheduler state", "source"));
        }
        const auto encoded = read_bounded_state(source, options_.max_state_bytes);
        const auto value = decode_checked_state(encoded);
        // Decode every record before replacing the live file. This keeps
        // malformed but checksummed records from becoming the active state.
        std::size_t live = 0;
        if (value.value("format_version", 0U) == 0U) {
            if (!value.contains("queued") || !value.contains("inflight") ||
                !value.contains("seen")) {
                fail_state("legacy state is incomplete");
            }
        }
        if (value.contains("queued")) {
            for (const auto& item : value.at("queued")) {
                static_cast<void>(queued_from_json(item));
                ++live;
            }
        }
        if (value.contains("inflight")) {
            for (const auto& item : value.at("inflight")) {
                static_cast<void>(assignment_from_json(item));
                ++live;
            }
        }
        if (value.contains("interrupted")) {
            for (const auto& item : value.at("interrupted")) {
                static_cast<void>(interrupted_from_json(item));
                ++live;
            }
        }
        if (value.contains("seen")) {
            for (const auto& item : value.at("seen")) static_cast<void>(seen_from_json(item));
        }
        if (live > options_.queue_capacity) fail_state("state exceeds queue capacity");
        write_state_atomically(options_.state_path, encoded, options_.max_state_bytes);
        queued_.clear();
        inflight_.clear();
        interrupted_.clear();
        seen_.clear();
        completed_ = 0;
        failed_ = 0;
        generation_ = 0;
        load_state(value);
        return Result<void>::success();
    } catch (const std::exception& error) {
        return Result<void>::failure(Error::parse_error(error.what(), "restore"));
    }
}

DurableSchedulerStatus DurableScheduler::status() const noexcept {
    std::lock_guard lock(mutex_);
    return {queued_.size(), inflight_.size(), interrupted_.size(), completed_, failed_, generation_};
}

nlohmann::json DurableScheduler::state_json() const {
    std::lock_guard lock(mutex_);
    auto payload = payload_json();
    auto envelope = payload;
    envelope["checksum"] = checksum_for_payload(payload);
    return envelope;
}

std::string DurableScheduler::now_rfc3339() {
    return timestamp_from_time(std::chrono::system_clock::now());
}

nlohmann::json DurableScheduler::queued_json(const Queued& value) {
    return {{"attempt", value.attempt}, {"job", value.job.to_json()}};
}

DurableScheduler::Queued DurableScheduler::queued_from_json(const nlohmann::json& value) {
    return {DistributedJob::from_json(value.at("job")), value.at("attempt").get<std::uint32_t>()};
}

nlohmann::json DurableScheduler::assignment_json(const AssignmentRecord& value) {
    return {{"assignment", value.assignment.to_json()}, {"job", value.job.to_json()}};
}

DurableScheduler::AssignmentRecord DurableScheduler::assignment_from_json(const nlohmann::json& value) {
    return {JobAssignment::from_json(value.at("assignment")), DistributedJob::from_json(value.at("job"))};
}

nlohmann::json DurableScheduler::interrupted_json(const InterruptedRecord& value) {
    return {{"assignment", value.record.assignment.to_json()}, {"job", value.record.job.to_json()}, {"reason", value.reason}};
}

DurableScheduler::InterruptedRecord DurableScheduler::interrupted_from_json(const nlohmann::json& value) {
    if (value.value("reason", "") != "scheduler_restart") fail_state("interrupted reason is invalid");
    return {assignment_from_json(value), "scheduler_restart"};
}

nlohmann::json DurableScheduler::seen_json(const Seen& value) {
    return {{"idempotency_key", value.idempotency_key}, {"job_id", value.job_id}};
}

DurableScheduler::Seen DurableScheduler::seen_from_json(const nlohmann::json& value) {
    return {value.at("idempotency_key").get<std::string>(), value.at("job_id").get<std::string>()};
}

bool DurableScheduler::has_seen(const DistributedJob& job) const {
    return std::any_of(seen_.begin(), seen_.end(), [&](const auto& value) {
        return value.idempotency_key == job.idempotency_key || value.job_id == job.job_id;
    });
}

std::size_t DurableScheduler::live_count() const noexcept {
    return queued_.size() + inflight_.size() + interrupted_.size();
}

}  // namespace handoffkit::csp
