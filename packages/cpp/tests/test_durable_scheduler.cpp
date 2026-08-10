#include <handoffkit/csp/durable_scheduler.hpp>
#include <handoffkit/csp/dispatcher.hpp>

#include <cassert>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <future>
#include <iostream>
#include <optional>
#include <thread>

using namespace handoffkit;
using namespace handoffkit::csp;

namespace {

DistributedJob job(std::string id = "job-cpp") {
    DistributedJob value;
    value.job_id = std::move(id);
    value.operation = "evaluate";
    value.payload = {{"input", "artifact://cpp"}};
    value.requested_capabilities = {"evaluate"};
    value.idempotency_key = value.job_id + "-idempotency";
    value.metadata = nlohmann::json::object();
    return value;
}

void write_json(const std::filesystem::path& path, const nlohmann::json& value) {
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    assert(output);
    output << value.dump();
}

nlohmann::json read_json(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    assert(input);
    return nlohmann::json::parse(input);
}

void test_restart_converts_inflight_and_retry_is_at_least_once() {
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    std::cout << "[SKIP] C++ durable scheduler requires crypto provider\n";
    return;
#else
    const auto root = std::filesystem::temp_directory_path() / "handoffkit-cpp-durable-scheduler";
    std::filesystem::remove_all(root);
    const auto path = root / "scheduler.json";
    DurableScheduler scheduler({path, 1024 * 1024, 8, false});
    assert(scheduler.enqueue(job()));
    std::promise<void> entered;
    std::promise<void> release;
    auto entered_future = entered.get_future();
    auto release_future = release.get_future();
    std::thread worker([&] {
        auto result = scheduler.run_one([&](const DistributedJob&, std::uint32_t) {
            entered.set_value();
            release_future.wait();
            return Result<nlohmann::json>::success({{"ok", true}});
        });
        assert(result);
    });
    entered_future.wait();
    DurableScheduler recovered({path, 1024 * 1024, 8, false});
    assert(recovered.status().inflight == 0);
    assert(recovered.status().interrupted == 1);
    assert(recovered.retry_interrupted());
    auto retried = recovered.run_one([](const DistributedJob&, std::uint32_t attempt) {
        assert(attempt == 2);
        return Result<nlohmann::json>::success({{"attempt", attempt}});
    });
    assert(retried && retried.value().has_value());
    release.set_value();
    worker.join();
    std::filesystem::remove_all(root);
    std::cout << "[PASS] C++ durable scheduler restart and at-least-once retry\n";
#endif
}

void test_v0_migration_and_auto_resume() {
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    return;
#else
    const auto root = std::filesystem::temp_directory_path() / "handoffkit-cpp-durable-migration";
    std::filesystem::remove_all(root);
    const auto path = root / "scheduler.json";
    DurableScheduler seed({path, 1024 * 1024, 8, false});
    auto state = seed.state_json();
    state.erase("interrupted");
    state["format_version"] = 0;
    auto legacy_payload = state;
    legacy_payload.erase("checksum");
    state["checksum"] = DurableScheduler::checksum_for_payload(legacy_payload);
    write_json(path, state);
    DurableScheduler migrated({path, 1024 * 1024, 8, false});
    assert(migrated.state_json().at("format_version") == 1);
    assert(migrated.state_json().contains("interrupted"));

    assert(migrated.enqueue(job("job-backup")));
    const auto backup_path = root / "scheduler.backup.json";
    assert(migrated.backup(backup_path));
    const auto restored_path = root / "scheduler-restored.json";
    DurableScheduler restored({restored_path, 1024 * 1024, 8, false});
    assert(restored.restore(backup_path));
    assert(restored.status().queued == 1);

    auto auto_state = migrated.state_json();
    const auto timestamp = "2026-01-01T00:00:00Z";
    JobAssignment assignment{
        "assignment-auto", "job-auto", "cpp-runtime", 1, timestamp, timestamp,
        {{"input", "artifact://auto"}}, nlohmann::json::object()};
    auto_state["inflight"] = nlohmann::json::array();
    auto_state["interrupted"] = nlohmann::json::array({
        {{"assignment", assignment.to_json()}, {"job", job("job-auto").to_json()}, {"reason", "scheduler_restart"}}});
    auto_state["queued"] = nlohmann::json::array();
    auto_state["seen"] = nlohmann::json::array();
    auto payload = auto_state;
    payload.erase("checksum");
    auto_state["checksum"] = DurableScheduler::checksum_for_payload(payload);
    write_json(path, auto_state);
    DurableScheduler resumed({path, 1024 * 1024, 8, true});
    assert(resumed.status().interrupted == 0);
    assert(resumed.status().queued == 1);
    auto result = resumed.run_one([](const DistributedJob&, std::uint32_t attempt) {
        assert(attempt == 2);
        return Result<nlohmann::json>::success({{"resumed", true}});
    });
    assert(result && result.value().has_value());
    std::filesystem::remove_all(root);
    std::cout << "[PASS] C++ durable scheduler v0 migration and opt-in auto-resume\n";
#endif
}

void test_exactly_once_fails_closed() {
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    return;
#else
    const auto root = std::filesystem::temp_directory_path() / "handoffkit-cpp-exactly-once";
    std::filesystem::remove_all(root);
    bool rejected = false;
    try {
        DurableScheduler scheduler({root / "scheduler.json", 1024 * 1024, 8, false, true});
        (void)scheduler;
    } catch (const SecurityError& error) {
        rejected = error.code() == "exactly_once_unavailable";
    }
    assert(rejected);

    DurableScheduler scheduler({root / "metadata-exactly-once.json", 1024 * 1024, 8, false});
    auto requested = job("job-exactly-once");
    requested.metadata["require_exactly_once"] = true;
    auto result = scheduler.enqueue(requested);
    assert(!result);
    assert(result.error().structured_code == "exactly_once_unavailable");
    std::filesystem::remove_all(root);
    std::cout << "[PASS] C++ exactly-once request fails closed without a transaction provider\n";
#endif
}

void test_async_claim_completion_and_failure() {
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    return;
#else
    const auto root = std::filesystem::temp_directory_path() / "handoffkit-cpp-durable-async";
    std::filesystem::remove_all(root);
    DurableScheduler scheduler({root / "scheduler.json", 1024 * 1024, 8, false});
    assert(scheduler.enqueue(job("job-async-complete")));
    assert(scheduler.claim(job("job-async-complete")));
    assert(scheduler.status().inflight == 1);
    assert(scheduler.complete("job-async-complete"));
    assert(scheduler.status().inflight == 0);
    assert(scheduler.status().completed == 1);

    assert(scheduler.enqueue(job("job-async-fail")));
    assert(scheduler.claim(job("job-async-fail")));
    assert(scheduler.fail("job-async-fail"));
    assert(scheduler.status().inflight == 0);
    assert(scheduler.status().failed == 1);
    std::filesystem::remove_all(root);
    std::cout << "[PASS] C++ asynchronous scheduler claim/complete/fail ledger transitions\n";
#endif
}

void test_durable_replay_survives_restart_and_quarantines_corruption() {
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    std::cout << "[SKIP] C++ durable replay requires crypto provider\n";
    return;
#else
    const auto root = std::filesystem::temp_directory_path() / "handoffkit-cpp-durable-replay";
    std::filesystem::remove_all(root);
    const auto path = root / "replay.json";
    {
        DurableReplayProtection replay(path);
        replay.protection().check_and_record("peer-a", "session-a", 1, "nonce-a");
        replay.persist();
        replay.backup(root / "replay.backup.json");
    }
    {
        DurableReplayProtection replay(path);
        bool duplicate = false;
        try {
            replay.protection().check_and_record("peer-a", "session-a", 1, "nonce-a");
        } catch (const SecurityError& error) {
            duplicate = error.code() == "replay_sequence";
        }
        assert(duplicate);
        replay.protection().check_and_record("peer-a", "session-b", 1, "nonce-a");
        replay.protection().check_and_record("peer-b", "session-a", 1, "nonce-a");
        replay.persist();
    }
    {
        const auto restored_path = root / "replay-restored.json";
        DurableReplayProtection restored(restored_path);
        restored.restore(root / "replay.backup.json");
        bool duplicate = false;
        try {
            restored.protection().check_and_record("peer-a", "session-a", 1, "nonce-a");
        } catch (const SecurityError& error) {
            duplicate = error.code() == "replay_sequence";
        }
        assert(duplicate);
    }
    {
        // v0 carried the same bounded payload without the current marker;
        // opening it must migrate and atomically rewrite it as v1.
        nlohmann::json legacy = read_json(path);
        auto payload = legacy;
        payload.erase("checksum");
        payload["format_version"] = 0;
        legacy["format_version"] = 0;
        legacy["checksum"] = DurableScheduler::checksum_for_payload(payload);
        write_json(path, legacy);
        std::optional<DurableReplayProtection> migrated;
        migrated.emplace(path);
        const auto rewritten = read_json(path);
        assert(rewritten.at("format_version") == 1);
        static_cast<void>(migrated);
    }
    {
        std::ofstream output(path, std::ios::binary | std::ios::trunc);
        assert(output);
        output << "{\"format\":\"handoffkit.replay.state\",\"format_version\":1}";
    }
    bool quarantined = false;
    try {
        DurableReplayProtection invalid(path);
    } catch (const SecurityError& error) {
        quarantined = error.code() == "replay_state_invalid";
    }
    assert(quarantined);
    bool found_quarantine = false;
    for (const auto& entry : std::filesystem::directory_iterator(root)) {
        if (entry.path().filename().string().find("replay.json.quarantine-") == 0) {
            found_quarantine = true;
            break;
        }
    }
    assert(found_quarantine);
    std::filesystem::remove_all(root);
    std::cout << "[PASS] C++ durable replay restart, backup/restore, v0 migration, peer/session scopes, checksum quarantine\n";
#endif
}

void test_no_crypto_replay_store_fails_closed() {
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    const auto path = std::filesystem::temp_directory_path() /
        "handoffkit-cpp-no-crypto-replay.json";
    std::filesystem::remove(path);
    bool rejected = false;
    try {
        DurableReplayProtection replay(path);
        static_cast<void>(replay);
    } catch (const SecurityError& error) {
        rejected = error.code() == "replay_store_unavailable";
    }
    assert(rejected);
    std::filesystem::remove(path);
    std::cout << "[PASS] C++ durable replay fails closed without crypto provider\n";
#endif
}

}  // namespace

int main() {
    test_restart_converts_inflight_and_retry_is_at_least_once();
    test_v0_migration_and_auto_resume();
    test_exactly_once_fails_closed();
    test_async_claim_completion_and_failure();
    test_durable_replay_survives_restart_and_quarantines_corruption();
    test_no_crypto_replay_store_fails_closed();
    std::cout << "All C++ durable scheduler tests passed\n";
    return 0;
}
