#include <handoffkit/csp/native_compute.hpp>

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>

#define REQUIRE(condition)                                                        \
    do {                                                                          \
        if (!(condition)) {                                                       \
            std::cerr << "requirement failed at line " << __LINE__ << ": "       \
                      << #condition << '\n';                                      \
            abort();                                                              \
        }                                                                         \
    } while (false)

namespace {

std::filesystem::path contracts_root() {
#ifdef HANDOFFKIT_CONTRACTS_DIR
    return std::filesystem::path(HANDOFFKIT_CONTRACTS_DIR);
#else
    abort();
#endif
}

nlohmann::json read_json(const std::filesystem::path& path) {
    std::ifstream input(path);
    REQUIRE(input.good());
    return nlohmann::json::parse(input);
}

handoffkit::csp::ArtifactRef artifact(const std::string& id) {
    return {
        "artifact-" + id,
        "file:///verified/" + id,
        std::string(64, 'a'),
        1,
        "application/octet-stream",
        nlohmann::json::object(),
    };
}

}  // namespace

int main() {
    using namespace handoffkit::csp;
    const auto fixture = read_json(
        contracts_root() / "test-fixtures" / "security" / "edge-runtime-profiles-v1.json");
    REQUIRE(fixture.at("format") == "handoffkit.edge-profiles");
    REQUIRE(fixture.at("format_version") == 1);

    for (const auto& expected : fixture.at("profiles")) {
        const auto decoded = EdgeRuntimeProfile::from_json(expected);
        REQUIRE(decoded.to_json() == expected);
        const auto preset = EdgeRuntimeProfile::for_profile(decoded.name);
        REQUIRE(preset.to_json() == expected);
        const auto session = preset.session_config("edge-session");
        REQUIRE(session.channel_capacity == preset.channel_capacity);
        REQUIRE(session.max_message_bytes == preset.max_frame_bytes);
        REQUIRE(session.ack_timeout_ms == preset.timeout.ack_ms);
        REQUIRE(session.dedup_capacity == preset.dedup_capacity);
        REQUIRE(session.metadata.at("edge_profile") == expected.at("name"));
    }

    auto unsafe = EdgeRuntimeProfile::for_profile(EdgeProfile::edge_small);
    unsafe.security_profile = "local";
    try {
        unsafe.validate();
        REQUIRE(false);
    } catch (const std::invalid_argument&) {
    }

    auto bounded = EdgeRuntimeProfile::for_profile(EdgeProfile::edge_small);
    bounded.channel_capacity = 1;
    std::mutex mutex;
    std::condition_variable condition;
    bool started = false;
    bool release = false;
    NativeComputePool pool(
        bounded,
        1,
        [](const auto&) {},
        [](const auto&) {});
    const auto first = pool.submit({
        "first",
        "message-first",
        [&](auto&) {
            std::unique_lock lock(mutex);
            started = true;
            condition.notify_all();
            condition.wait(lock, [&] { return release; });
            return artifact("first");
        },
        std::nullopt,
    });
    REQUIRE(first.accepted);
    {
        std::unique_lock lock(mutex);
        REQUIRE(condition.wait_for(lock, std::chrono::seconds(2), [&] { return started; }));
    }
    const auto second = pool.submit({
        "second", "message-second", [](auto&) { return artifact("second"); }, std::nullopt});
    REQUIRE(second.accepted);
    const auto third = pool.submit({
        "third", "message-third", [](auto&) { return artifact("third"); }, std::nullopt});
    REQUIRE(!third.accepted);
    REQUIRE(third.nack.has_value());
    REQUIRE(third.nack->code == "backpressure");
    {
        std::lock_guard lock(mutex);
        release = true;
    }
    condition.notify_all();
    pool.shutdown(ShutdownMode::drain);
    return 0;
}
