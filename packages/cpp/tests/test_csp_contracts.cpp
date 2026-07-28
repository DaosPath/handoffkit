#include <handoffkit/csp/contracts.hpp>

#include <cassert>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace {

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
    assert_roundtrip<ArtifactRef>("artifact_ref.json");
    assert_roundtrip<TrainingJob>("training_job.json");
    assert_roundtrip<EvaluationJob>("evaluation_job.json");
    assert_roundtrip<JobProgress>("job_progress.json");

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

    std::cout << "All C++ HK-CSP contract tests passed.\n";
    return 0;
}
