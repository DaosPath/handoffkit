#include <handoffkit/csp/security.hpp>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
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
    using namespace handoffkit::csp;
    const auto root = contracts_root();
    const auto vectors = read_json(root / "conformance" / "security-v1.json");

    const auto config_value = read_json(root / "fixtures" / "security_config.json");
    REQUIRE(SecurityConfig::from_json(config_value).to_json() == config_value);
    const auto peer_value = read_json(root / "fixtures" / "peer_identity.json");
    REQUIRE(PeerIdentity::from_json(peer_value).to_json() == peer_value);

    const auto transcript_fixture = read_json(root / "test-fixtures" / "security" / "security-transcript-v1.json");
    SecurityTranscriptInput transcript_input{
        .protocol_version = transcript_fixture.at("transcript").at("protocol_version").get<std::string>(),
        .requested_profile = security_profile_from_string(
            transcript_fixture.at("transcript").at("requested_profile").get<std::string>()),
        .selected_profile = security_profile_from_string(
            transcript_fixture.at("transcript").at("selected_profile").get<std::string>()),
        .sender = PeerIdentity::from_json(transcript_fixture.at("sender")),
        .receiver = PeerIdentity::from_json(transcript_fixture.at("receiver")),
        .tls_version = transcript_fixture.at("transcript").at("tls_version").get<std::string>(),
        .negotiated_group = transcript_fixture.at("transcript").at("negotiated_group").is_null()
            ? std::nullopt
            : std::optional<std::string>(transcript_fixture.at("transcript").at("negotiated_group").get<std::string>()),
        .session_id = transcript_fixture.at("transcript").at("session_id").get<std::string>(),
        .handshake_nonce = transcript_fixture.at("transcript").at("handshake_nonce").get<std::string>(),
        .timestamp = transcript_fixture.at("transcript").at("timestamp").get<std::string>(),
    };
    const auto transcript = SecurityTranscript::build(transcript_input);
    REQUIRE(transcript.to_json() == transcript_fixture.at("transcript"));
    REQUIRE(transcript.unsigned_json().dump() == transcript_fixture.at("canonical_unsigned_payload").get<std::string>());
    REQUIRE(SecurityTranscript::from_json(transcript_fixture.at("transcript")).to_json() == transcript_fixture.at("transcript"));
    REQUIRE(SecurityTranscript::verify(transcript_fixture.at("transcript"), transcript_input).to_json() == transcript_fixture.at("transcript"));
    auto tampered_transcript = transcript_fixture.at("transcript");
    tampered_transcript["sender_peer_id"] = "spoofed-peer";
    tampered_transcript["transcript_hash"] = "";
    std::string transcript_error;
    try {
        static_cast<void>(SecurityTranscript::from_json(tampered_transcript));
    } catch (const SecurityError& error) {
        transcript_error = error.code();
    }
    REQUIRE(transcript_error == "security_transcript_invalid");

    const auto artifact_value = read_json(root / "fixtures" / "signed_artifact.json");
    const auto artifact = SignedArtifact::from_json(artifact_value);
    REQUIRE(artifact.to_json() == artifact_value);
    REQUIRE(artifact.canonical_payload() ==
            vectors.at("signed_artifact").at("canonical_payload").get<std::string>());

    for (const auto& test_case : vectors.at("profile_negotiation")) {
        const auto required =
            security_profile_from_string(test_case.at("required").get<std::string>());
        const auto offered =
            security_profile_from_string(test_case.at("offered").get<std::string>());
        std::vector<SecurityProfile> supported;
        for (const auto& value : test_case.at("supported")) {
            supported.push_back(security_profile_from_string(value.get<std::string>()));
        }
        if (test_case.contains("error_code")) {
            std::string code;
            try {
                static_cast<void>(negotiate_security_profile(required, offered, supported));
            } catch (const SecurityError& error) {
                code = error.code();
            }
            REQUIRE(code == test_case.at("error_code").get<std::string>());
        } else {
            const auto selected = negotiate_security_profile(required, offered, supported);
            REQUIRE(to_string(selected) == test_case.at("selected").get<std::string>());
        }
    }

    for (const auto& test_case : vectors.at("authorization")) {
        const auto allowed = test_case.at("allowed_operations").get<std::vector<std::string>>();
        CapabilityPolicy policy(allowed);
        PeerIdentity peer;
        peer.peer_id = "peer";
        peer.node_id = "node";
        peer.capabilities =
            test_case.at("peer_capabilities").get<std::vector<std::string>>();
        const auto operation = test_case.at("operation").get<std::string>();
        const auto expected = test_case.at("authorized").get<bool>();
        REQUIRE(policy.is_operation_authorized(operation, &peer) == expected);
        if (!expected) {
            std::string code;
            try {
                policy.authorize_job(operation.substr(4), peer);
            } catch (const SecurityError& error) {
                code = error.code();
            }
            REQUIRE(code == "authorization_denied");
        }
    }

    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
                         std::chrono::system_clock::now().time_since_epoch())
                         .count();
    for (const auto& test_case : vectors.at("replay")) {
        ReplayProtection replay(30, 3, 1000);
        for (const auto& operation : test_case.at("operations")) {
            std::string code;
            try {
                replay.check_and_record(
                    operation.at("peer").get<std::string>(),
                    operation.at("session").get<std::string>(),
                    operation.at("sequence").get<std::uint64_t>(),
                    operation.at("nonce").get<std::string>(),
                    now + operation.at("timestamp_offset").get<std::int64_t>());
            } catch (const SecurityError& error) {
                code = error.code();
            }
            if (operation.contains("error_code")) {
                REQUIRE(code == operation.at("error_code").get<std::string>());
            } else {
                REQUIRE(code.empty());
            }
        }
    }
    return 0;
}
