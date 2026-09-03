#include <handoffkit/csp/contracts.hpp>
#include <handoffkit/csp/tls_transport.hpp>

#include <cstdint>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

#include <nlohmann/json.hpp>

namespace {

std::uint16_t port_value(const char* value) {
    const auto parsed = std::stoul(value);
    if (parsed == 0 || parsed > 65535) throw std::invalid_argument("port is outside 1..65535");
    return static_cast<std::uint16_t>(parsed);
}

std::string utc_timestamp() {
    const auto now = std::chrono::system_clock::now();
    const auto seconds = std::chrono::system_clock::to_time_t(now);
    std::tm utc{};
#ifdef _WIN32
    if (gmtime_s(&utc, &seconds) != 0) throw std::runtime_error("cannot compute UTC timestamp");
#else
    if (gmtime_r(&seconds, &utc) == nullptr) throw std::runtime_error("cannot compute UTC timestamp");
#endif
    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return output.str();
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 9) {
        std::cerr << "usage: handoffkit-cpp-tcp-client HOST PORT CA CERT KEY "
                     "EXPECTED_PEER EXPECTED_NODE RESPONSE_SOURCE\n";
        return 2;
    }
    try {
        using namespace handoffkit::csp;
        TlsTransportConfig config;
        config.security.profile = SecurityProfile::Standard;
        config.security.require_mtls = true;
        config.security.trust_domain = "handoffkit.internal";
        config.security.ca_cert_path = argv[3];
        config.security.cert_path = argv[4];
        config.security.key_path = argv[5];
        config.server_name = "localhost";
        config.timeout = std::chrono::milliseconds(10000);
        config.peer_policy.expected_peer_id = argv[6];
        config.peer_policy.expected_node_id = argv[7];
        auto connection = TlsClient::connect(argv[1], port_value(argv[2]), config);

        const nlohmann::json request = {
            {"protocol_version", "1.0"},
            {"message_id", "cpp-reverse-1"},
            {"session_id", "cpp-reverse"},
            {"channel", "control"},
            {"kind", "interop_echo"},
            {"source", "client-peer"},
            {"target", nullptr},
            {"sequence", 1},
            {"created_at", utc_timestamp()},
            {"deadline", nullptr},
            {"correlation_id", nullptr},
            {"causation_id", nullptr},
            {"idempotency_key", "cpp-reverse-1"},
            {"attempt", 1},
            {"requires_ack", false},
            {"payload_type", "interop_echo"},
            {"payload", {{"runtime", "cpp"}}},
            {"metadata", {{"nonce", "cpp-reverse-nonce"}}},
        };
        connection.send_json(request);
        const auto response = connection.receive_json();
        if (response.value("kind", std::string{}) != "interop_echo" ||
            response.value("source", std::string{}) != argv[8]) {
            throw std::runtime_error("unexpected runtime response: " + response.dump());
        }
        std::cout << nlohmann::json{
            {"runtime", "cpp"},
            {"protocol", connection.negotiated_protocol()},
            {"peer_id", connection.peer_identity().peer_id},
            {"response_kind", response.value("kind", "")},
            {"response_source", response.value("source", "")},
        }.dump() << '\n';
        connection.close();
        return 0;
    } catch (const handoffkit::csp::SecurityError& error) {
        std::cerr << error.code() << ": " << error.what() << '\n';
        return 1;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
