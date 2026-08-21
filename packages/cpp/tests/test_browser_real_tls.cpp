#include <handoffkit/browser/real_tls.hpp>
#include <handoffkit/csp/tls_transport.hpp>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {

nlohmann::json read_json(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("could not open Browser Real C++ client config");
    nlohmann::json value;
    input >> value;
    if (!value.is_object()) throw std::runtime_error("Browser Real C++ client config must be an object");
    return value;
}

std::string required_text(const nlohmann::json& value, const char* field) {
    const auto result = value.value(field, std::string{});
    if (result.empty()) throw std::runtime_error(std::string("missing config field: ") + field);
    return result;
}

std::uint16_t required_port(const nlohmann::json& value) {
    const auto raw = value.value("port", 0U);
    if (raw == 0U || raw > std::numeric_limits<std::uint16_t>::max()) {
        throw std::runtime_error("config port must be between 1 and 65535");
    }
    return static_cast<std::uint16_t>(raw);
}

nlohmann::json run_client(const nlohmann::json& config) {
#if !defined(HANDOFFKIT_WITH_TLS) || !defined(HANDOFFKIT_WITH_CRYPTO)
    static_cast<void>(config);
    throw handoffkit::csp::SecurityError(
        "tls_backend_unavailable",
        "Browser Real C++ TCP interop requires HANDOFFKIT_WITH_TLS=ON and HANDOFFKIT_WITH_CRYPTO=ON");
#else
    handoffkit::csp::TlsTransportConfig transport;
    transport.security.profile = handoffkit::csp::SecurityProfile::Standard;
    transport.security.require_mtls = true;
    transport.security.trust_domain = config.value("trust_domain", "handoffkit.internal");
    transport.security.ca_cert_path = required_text(config, "ca_cert_path");
    transport.security.cert_path = required_text(config, "cert_path");
    transport.security.key_path = required_text(config, "key_path");
    transport.server_name = config.value("server_name", "localhost");
    transport.timeout = std::chrono::milliseconds(config.value("timeout_ms", 5000U));

    const auto expected = config.value("expected_server", nlohmann::json::object());
    if (expected.contains("peer_id")) transport.peer_policy.expected_peer_id = expected.at("peer_id").get<std::string>();
    if (expected.contains("node_id")) transport.peer_policy.expected_node_id = expected.at("node_id").get<std::string>();
    if (expected.contains("worker_id") && !expected.at("worker_id").is_null()) {
        transport.peer_policy.expected_worker_id = expected.at("worker_id").get<std::string>();
    }
    const auto server_fingerprint = required_text(config, "server_fingerprint");
    transport.peer_policy.capabilities_by_fingerprint[server_fingerprint] = {"browser:*"};

    const auto identity = handoffkit::csp::PeerIdentity::from_json(config.at("client_identity"));
    auto client = handoffkit::browser::BrowserRealTlsClient::connect(
        required_text(config, "host"), required_port(config), std::move(transport), identity);

    const auto commands = config.value("commands", nlohmann::json::array());
    if (!commands.is_array() || commands.empty()) throw std::runtime_error("config commands must be non-empty");
    nlohmann::json responses = nlohmann::json::array();
    for (const auto& command : commands) {
        if (!command.is_object()) throw std::runtime_error("Browser Real command must be an object");
        responses.push_back(client.send(command));
    }
    const auto& peer = client.authenticated_peer();
    const auto result = nlohmann::json{
        {"status", "pass"},
        {"transport", "tcp_tls_mtls"},
        {"tls_version", client.negotiated_protocol()},
        {"local_peer_id", client.local_identity().peer_id},
        {"authenticated_peer_id", peer.peer_id},
        {"authenticated_node_id", peer.node_id},
        {"authenticated_worker_id", peer.worker_id ? nlohmann::json(*peer.worker_id) : nlohmann::json(nullptr)},
        {"authenticated_fingerprint", peer.credential_fingerprint},
        {"response_count", responses.size()},
        {"responses", responses},
    };
    client.close();
    return result;
#endif
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc == 1) {
            std::cout << nlohmann::json{
                {"status", "probe"},
                {"tls", handoffkit::csp::detect_cpp_tls_capabilities().to_json()},
                {"contract", "browser.real.tls.client"},
            }.dump() << '\n';
            return 0;
        }
        if (argc != 2) {
            std::cerr << "usage: test_browser_real_tls [config.json]\n";
            return 2;
        }
        std::cout << run_client(read_json(argv[1])).dump() << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << nlohmann::json{
            {"status", "fail"},
            {"code", "browser_real_cpp_interop_failed"},
            {"message", error.what()},
        }.dump() << '\n';
        return 1;
    }
}
