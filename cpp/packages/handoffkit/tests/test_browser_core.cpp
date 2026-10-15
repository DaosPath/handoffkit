#include <handoffkit/browser/core.hpp>
#include <handoffkit/browser/real.hpp>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

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

}  // namespace

int main() {
    using handoffkit::browser::core::parse_core_model;
    using handoffkit::browser::core::CoreError;
    const auto vectors = read_json(contracts_root() / "conformance" / "browser-core-v1.json");
    const std::vector<std::pair<std::string, std::string>> models{
        {"browser_error", "BrowserError"},
        {"browser_capabilities", "BrowserCapabilities"},
        {"browser_policy", "BrowserPolicy"},
        {"browser_session_request", "BrowserSessionRequest"},
        {"browser_session_state", "BrowserSessionState"},
        {"browser_command", "BrowserCommand"},
        {"browser_event", "BrowserEvent"},
        {"search_request", "SearchRequest"},
        {"search_result", "SearchResult"},
        {"page_snapshot", "PageSnapshot"},
        {"document_record", "DocumentRecord"},
        {"provider_trace", "ProviderTrace"},
        {"research_job", "ResearchJob"},
        {"research_progress", "ResearchProgress"},
        {"research_result", "ResearchResult"},
    };
    for (const auto& [key, name] : models) {
        const auto expected = vectors.at("vectors").at(key);
        const auto parsed = parse_core_model(name, expected);
        if (parsed != expected) {
            std::cerr << "round-trip mismatch for " << name << '\n'
                      << parsed.dump(2) << "\nvs\n" << expected.dump(2) << '\n';
            abort();
        }
    }
    for (const auto& negative : vectors.at("negative")) {
        bool threw = false;
        try {
            static_cast<void>(parse_core_model(negative.at("model").get<std::string>(), negative.at("input")));
        } catch (const CoreError& error) {
            threw = true;
            REQUIRE(error.code() == negative.at("error_code").get<std::string>());
        }
        REQUIRE(threw);
    }
    bool bind_threw = false;
    try {
        handoffkit::browser::core::reject_public_bind(nlohmann::json::object(), "0.0.0.0");
    } catch (const CoreError& error) {
        bind_threw = error.code() == "public_bind_rejected";
    }
    REQUIRE(bind_threw);
    handoffkit::browser::core::reject_public_bind(nlohmann::json::object(), "127.0.0.1");
    handoffkit::browser::BrowserRealClient client([](const nlohmann::json& command) {
        return nlohmann::json{{"name", "echo"}, {"payload", command}};
    });
    const nlohmann::json command = {{"name", "navigate"}};
    REQUIRE(client.send(command).at("name") == "echo");
    bool loopback_denied = false;
    try {
        handoffkit::browser::core::assert_network_url(nlohmann::json::object(), "http://127.0.0.1/");
    } catch (const CoreError& error) {
        loopback_denied = error.code() == "policy_denied";
    }
    REQUIRE(loopback_denied);
    handoffkit::browser::core::assert_network_url(nlohmann::json::object(), "https://example.org/");
    bool fs_denied = false;
    try {
        handoffkit::browser::core::assert_filesystem(nlohmann::json::object(), "read");
    } catch (const CoreError& error) {
        fs_denied = error.code() == "policy_denied";
    }
    REQUIRE(fs_denied);
    handoffkit::browser::core::assert_filesystem(nlohmann::json::object(), "download");
    return 0;
}
