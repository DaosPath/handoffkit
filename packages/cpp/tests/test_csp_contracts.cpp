#include <handoffkit/csp/contracts.hpp>
#include <handoffkit/csp/security.hpp>

#include <cassert>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace {

#undef assert
#define assert(condition)           \
    do {                            \
        if (!(condition)) abort();  \
    } while (false)

std::filesystem::path contracts_root() {
#ifdef HANDOFFKIT_CONTRACTS_DIR
    return std::filesystem::path(HANDOFFKIT_CONTRACTS_DIR);
#else
    throw std::runtime_error("HANDOFFKIT_CONTRACTS_DIR is required");
#endif
}

nlohmann::json fixture(const std::string& name) {
    std::ifstream stream(contracts_root() / "fixtures" / name);
    if (!stream) throw std::runtime_error("missing fixture: " + name);
    return nlohmann::json::parse(stream);
}

nlohmann::json validation_corpus() {
    std::ifstream stream(contracts_root() / "corpus" / "csp-validation.json");
    if (!stream) throw std::runtime_error("missing CSP validation corpus");
    return nlohmann::json::parse(stream);
}

nlohmann::json parse_contract(const std::string& kind, const nlohmann::json& value) {
    using namespace handoffkit::csp;
    if (kind == "message_envelope") return MessageEnvelope::from_json(value).to_json();
    if (kind == "session_config") return SessionConfig::from_json(value).to_json();
    if (kind == "channel_config") return ChannelConfig::from_json(value).to_json();
    if (kind == "delivery_ack") return DeliveryAck::from_json(value).to_json();
    if (kind == "delivery_nack") return DeliveryNack::from_json(value).to_json();
    if (kind == "process_error") return ProcessError::from_json(value).to_json();
    if (kind == "artifact_ref") return ArtifactRef::from_json(value).to_json();
    if (kind == "worker_capabilities") return WorkerCapabilities::from_json(value).to_json();
    if (kind == "job_progress") return JobProgress::from_json(value).to_json();
    if (kind == "security_config") return SecurityConfig::from_json(value).to_json();
    if (kind == "peer_identity") return PeerIdentity::from_json(value).to_json();
    if (kind == "signed_artifact") return SignedArtifact::from_json(value).to_json();
    throw std::invalid_argument("unknown corpus contract kind: " + kind);
}

template <typename Contract>
void assert_roundtrip(const std::string& name) {
    const auto expected = fixture(name);
    assert(Contract::from_json(expected).to_json() == expected);
}

}  // namespace

int main() {
    using namespace handoffkit::csp;

    assert_roundtrip<MessageEnvelope>("message_envelope.json");
    assert_roundtrip<SessionConfig>("session_config.json");
    assert_roundtrip<ChannelConfig>("channel_config.json");
    assert_roundtrip<DeliveryAck>("delivery_ack.json");
    assert_roundtrip<DeliveryNack>("delivery_nack.json");
    assert_roundtrip<ProcessError>("process_error.json");
    assert_roundtrip<WorkerCapabilities>("worker_capabilities.json");
    assert_roundtrip<WorkerHeartbeat>("worker_heartbeat.json");
    assert_roundtrip<DistributedJob>("distributed_job.json");
    assert_roundtrip<JobAssignment>("job_assignment.json");
    assert_roundtrip<ArtifactRef>("artifact_ref.json");
    assert_roundtrip<TrainingJob>("training_job.json");
    assert_roundtrip<EvaluationJob>("evaluation_job.json");
    assert_roundtrip<JobProgress>("job_progress.json");
    assert_roundtrip<SecurityConfig>("security_config.json");
    assert_roundtrip<PeerIdentity>("peer_identity.json");
    assert_roundtrip<SignedArtifact>("signed_artifact.json");

    auto envelope = MessageEnvelope::from_json(fixture("message_envelope.json"));
    envelope.validate();
    const auto retry = envelope.next_attempt();
    assert(retry.message_id == envelope.message_id);
    assert(retry.idempotency_key == envelope.idempotency_key);
    assert(retry.attempt == 2);
    assert(negotiate_version("1.9") == "1.0");

    bool rejected = false;
    try {
        static_cast<void>(negotiate_version("2.0"));
    } catch (const std::invalid_argument&) {
        rejected = true;
    }
    assert(rejected);

    for (const auto& test_case : validation_corpus().at("cases")) {
        const bool expected_valid = test_case.at("valid").get<bool>();
        try {
            const auto canonical = parse_contract(
                test_case.at("kind").get<std::string>(), test_case.at("value")
            );
            assert(expected_valid);
            assert(canonical == test_case.at("value"));
        } catch (const std::exception& error) {
            assert(!expected_valid);
            assert(
                validation_error_code(error.what()) ==
                test_case.at("error_code").get<std::string>()
            );
        }
    }

    std::cout << "All C++ HK-CSP contract tests passed.\n";
    return 0;
}
