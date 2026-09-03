#ifndef HANDOFFKIT_CSP_DURABLE_SCHEDULER_HPP
#define HANDOFFKIT_CSP_DURABLE_SCHEDULER_HPP

#include <handoffkit/csp/contracts.hpp>
#include <handoffkit/csp/security.hpp>
#include <handoffkit/error.hpp>

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace handoffkit::csp {

inline constexpr std::string_view durable_scheduler_state_format = "handoffkit.scheduler.state";
inline constexpr std::uint32_t durable_scheduler_state_version = 1;

struct DurableSchedulerOptions {
    std::filesystem::path state_path;
    std::size_t max_state_bytes{8U * 1024U * 1024U};
    std::size_t queue_capacity{128};
    bool auto_resume{false};
    /// Fail closed instead of silently using at-least-once when a caller asks
    /// for an exactly-once external-effect guarantee. No such transaction
    /// provider is shipped by the C++ scheduler yet.
    bool require_exactly_once{false};
};

struct DurableSchedulerStatus {
    std::size_t queued{0};
    std::size_t inflight{0};
    std::size_t interrupted{0};
    std::uint64_t completed{0};
    std::uint64_t failed{0};
    std::uint64_t generation{0};
};

/// Durable distributed-job scheduler for the C++ runtime.
///
/// The state envelope is the same `handoffkit.scheduler.state` format used by
/// the other runtimes. Restart converts inflight assignments to interrupted
/// records. `auto_resume` is explicitly at-least-once and never an exactly-once
/// side-effect guarantee. `require_exactly_once` rejects construction with the
/// structured `exactly_once_unavailable` error; it never falls back.
class DurableScheduler {
public:
    using Handler = std::function<Result<nlohmann::json>(
        const DistributedJob&, std::uint32_t attempt)>;

    explicit DurableScheduler(DurableSchedulerOptions options);
    ~DurableScheduler() = default;

    DurableScheduler(const DurableScheduler&) = delete;
    DurableScheduler& operator=(const DurableScheduler&) = delete;
    DurableScheduler(DurableScheduler&&) = delete;
    DurableScheduler& operator=(DurableScheduler&&) = delete;

    [[nodiscard]] Result<void> enqueue(const DistributedJob& job, std::uint32_t attempt = 1);
    /// Move an admitted job into the durable inflight set before an
    /// asynchronous native worker starts it.
    [[nodiscard]] Result<void> claim(const DistributedJob& job, std::uint32_t attempt = 1);
    /// Commit an asynchronous worker success and remove its inflight record.
    [[nodiscard]] Result<void> complete(std::string_view job_id);
    /// Commit an asynchronous worker failure and remove its inflight record.
    [[nodiscard]] Result<void> fail(std::string_view job_id);
    /// Return queued jobs available for a caller to submit after startup.
    [[nodiscard]] std::vector<DistributedJob> recoverable_jobs() const;
    [[nodiscard]] Result<std::optional<nlohmann::json>> run_one(const Handler& handler);
    [[nodiscard]] Result<void> retry_interrupted();
    /// Copy a validated state envelope to a private atomic destination.
    [[nodiscard]] Result<void> backup(const std::filesystem::path& destination) const;
    /// Validate and atomically install a state backup, then reload this scheduler.
    [[nodiscard]] Result<void> restore(const std::filesystem::path& source);

    [[nodiscard]] DurableSchedulerStatus status() const noexcept;
    [[nodiscard]] nlohmann::json state_json() const;

    /// Canonical checksum helper used by conformance tests and operators.
    [[nodiscard]] static std::string checksum_for_payload(const nlohmann::json& payload);

private:
    struct Queued {
        DistributedJob job;
        std::uint32_t attempt{1};
    };
    struct AssignmentRecord {
        JobAssignment assignment;
        DistributedJob job;
    };
    struct InterruptedRecord {
        AssignmentRecord record;
        std::string reason{"scheduler_restart"};
    };
    struct Seen {
        std::string idempotency_key;
        std::string job_id;
    };

    DurableSchedulerOptions options_;
    std::vector<Queued> queued_;
    std::vector<AssignmentRecord> inflight_;
    std::vector<InterruptedRecord> interrupted_;
    std::vector<Seen> seen_;
    std::uint64_t completed_{0};
    std::uint64_t failed_{0};
    std::uint64_t generation_{0};
    mutable std::mutex mutex_;

    void load_or_initialize();
    void load_state(const nlohmann::json& value);
    void persist();
    void quarantine(const std::string& reason);
    [[nodiscard]] nlohmann::json payload_json() const;
    [[nodiscard]] static std::string now_rfc3339();
    [[nodiscard]] static nlohmann::json queued_json(const Queued& value);
    [[nodiscard]] static Queued queued_from_json(const nlohmann::json& value);
    [[nodiscard]] static nlohmann::json assignment_json(const AssignmentRecord& value);
    [[nodiscard]] static AssignmentRecord assignment_from_json(const nlohmann::json& value);
    [[nodiscard]] static nlohmann::json interrupted_json(const InterruptedRecord& value);
    [[nodiscard]] static InterruptedRecord interrupted_from_json(const nlohmann::json& value);
    [[nodiscard]] static nlohmann::json seen_json(const Seen& value);
    [[nodiscard]] static Seen seen_from_json(const nlohmann::json& value);
    [[nodiscard]] bool has_seen(const DistributedJob& job) const;
    [[nodiscard]] std::size_t live_count() const noexcept;
};

}  // namespace handoffkit::csp

#endif
