#include <handoffkit/csp/artifact_gate.hpp>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <iterator>
#include <memory>
#include <string>

#define REQUIRE(condition)                                                        \
    do {                                                                          \
        if (!(condition)) {                                                       \
            std::cerr << "requirement failed at line " << __LINE__ << ": "       \
                      << #condition << '\n';                                      \
            abort();                                                              \
        }                                                                         \
    } while (false)

namespace fs = std::filesystem;

namespace {

std::string read_file(const fs::path& path) {
    std::ifstream input(path, std::ios::binary);
    REQUIRE(input.good());
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

void write_file(const fs::path& path, const std::string& value) {
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    REQUIRE(output.good());
    output << value;
    output.flush();
    REQUIRE(output.good());
}

std::string error_code(const std::function<void()>& operation) {
    try {
        operation();
    } catch (const handoffkit::csp::SecurityError& error) {
        return error.code();
    }
    return {};
}

handoffkit::csp::ArtifactRef artifact_ref(
    const fs::path& path,
    const std::string& hash,
    const std::string& media_type = "application/x-ndjson") {
    auto uri = fs::absolute(path).generic_string();
#if defined(_WIN32)
    uri = "file:///" + uri;
#else
    uri = "file://" + uri;
#endif
    return {
        "dataset-1",
        uri,
        hash,
        fs::file_size(path),
        media_type,
        {{"producer_identity", "spiffe://handoffkit.internal/producer/trainer"}}};
}

handoffkit::csp::ArtifactIngestionPolicy base_policy(const fs::path& scratch) {
    handoffkit::csp::ArtifactIngestionPolicy policy;
    policy.allowed_media_types = {"application/x-ndjson"};
    policy.max_size_bytes = 1024;
    policy.allowed_roots = {scratch / "allowed"};
    policy.snapshot_directory = scratch / "snapshots";
    policy.quarantine_directory = scratch / "quarantine";
    return policy;
}

}  // namespace

int main() {
    using namespace handoffkit::csp;
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    return 0;
#else
#ifndef HANDOFFKIT_CONTRACTS_DIR
#error HANDOFFKIT_CONTRACTS_DIR is required for artifact gate conformance
#endif
    const auto scratch = fs::current_path() / "test_artifacts_artifact_gate";
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    fs::create_directories(scratch / "allowed");
    fs::create_directories(scratch / "outside");

    const std::string payload = "handoffkit signed artifact\n";
    const auto source = scratch / "allowed" / "dataset.jsonl";
    write_file(source, payload);
    const auto vector_path = fs::path(HANDOFFKIT_CONTRACTS_DIR) /
                             "test-fixtures" / "artifact-signing" / "vector.json";
    const auto vector = nlohmann::json::parse(read_file(vector_path));
    const auto signed_artifact = SignedArtifact::from_json(vector.at("signed_artifact"));
    auto artifact = artifact_ref(source, signed_artifact.content_hash);

    {
        auto policy = base_policy(scratch);
        ArtifactIngestionGate gate(std::move(policy));
        const auto source_path = source;
        auto verified = gate.ingest(artifact, 1800000000);
        const auto snapshot_path = verified.snapshot_path();
        REQUIRE(fs::exists(snapshot_path));
        REQUIRE(read_file(snapshot_path) == payload);
        REQUIRE(verified.snapshot().metadata.at("ingestion_verified").get<bool>());
        write_file(source_path, "replaced after verification\n");
        REQUIRE(read_file(snapshot_path) == payload);
        REQUIRE(read_file(source_path) != read_file(snapshot_path));
    }
    REQUIRE(fs::is_empty(scratch / "snapshots"));
    write_file(source, payload);

    {
        auto bad_hash = artifact;
        bad_hash.sha256[0] = bad_hash.sha256[0] == '0' ? '1' : '0';
        ArtifactIngestionGate gate(base_policy(scratch));
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(bad_hash)); }) ==
                "artifact_integrity_mismatch");
        REQUIRE(!fs::is_empty(scratch / "quarantine"));
    }

    {
        auto denied_media = artifact;
        denied_media.media_type = "application/octet-stream";
        ArtifactIngestionGate gate(base_policy(scratch));
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(denied_media)); }) ==
                "artifact_media_type_denied");

    }

    {
        const auto outside = scratch / "outside" / "dataset.jsonl";
        write_file(outside, payload);
        auto denied_path = artifact_ref(outside, signed_artifact.content_hash);
        ArtifactIngestionGate gate(base_policy(scratch));
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(denied_path)); }) ==
                "artifact_path_denied");
    }

#if !defined(_WIN32)
    {
        const auto outside = scratch / "outside" / "symlink-target.jsonl";
        const auto link = scratch / "allowed" / "escape.jsonl";
        write_file(outside, payload);
        fs::create_symlink(outside, link);
        auto escaped = artifact_ref(link, signed_artifact.content_hash);
        ArtifactIngestionGate gate(base_policy(scratch));
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(escaped)); }) ==
                "artifact_path_denied");
    }
#endif

    {
        auto policy = base_policy(scratch);
        policy.max_size_bytes = payload.size() - 1;
        ArtifactIngestionGate gate(std::move(policy));
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(artifact)); }) ==
                "artifact_too_large");
    }

    {
        auto required = base_policy(scratch);
        required.signature_requirement = ArtifactSignatureRequirement::Required;
        required.trusted_signers = {signed_artifact.signer_identity};
        required.trusted_producers = {signed_artifact.signer_identity};
        required.signature_policy = std::make_shared<ArtifactTrustPolicy>(
            std::vector<ArtifactSigningCredential>{ArtifactSigningCredential{
                signed_artifact.signer_identity,
                vector.at("public_key_pem").get<std::string>(),
                1700000000,
                1900000000,
                false}});
        ArtifactIngestionGate gate(required);
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(artifact, 1800000000)); }) ==
                "artifact_signature_required");

        auto signed_ref = artifact;
        signed_ref.artifact_id = signed_artifact.artifact_id;
        signed_ref.metadata["producer_identity"] = signed_artifact.signer_identity;
        signed_ref.metadata["signed_artifact"] = signed_artifact.to_json();
        auto verified = gate.ingest(signed_ref, 1800000000);
        REQUIRE(read_file(verified.snapshot_path()) == payload);

        auto wrong_artifact = signed_ref;
        wrong_artifact.metadata["signed_artifact"]["artifact_id"] = "artifact-other";
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(wrong_artifact, 1800000000)); }) ==
                "artifact_signature_mismatch");

        auto invalid_signature = signed_ref;
        invalid_signature.metadata["signed_artifact"]["signature"] = "AAAA";
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(invalid_signature, 1800000000)); }) ==
                "artifact_signature_invalid");

        auto unsupported_algorithm = signed_ref;
        unsupported_algorithm.metadata["signed_artifact"]["algorithm"] = "ml-dsa";
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(unsupported_algorithm, 1800000000)); }) ==
                "artifact_algorithm_unsupported");

        auto wrong_signer = signed_ref;
        wrong_signer.metadata["signed_artifact"]["signer_identity"] =
            "spiffe://handoffkit.internal/producer/impostor";
        REQUIRE(error_code([&] { static_cast<void>(gate.ingest(wrong_signer, 1800000000)); }) ==
                "artifact_signer_denied");

        auto wrong_producer = signed_ref;
        wrong_producer.metadata["producer_identity"] =
            "spiffe://handoffkit.internal/producer/impostor";
        REQUIRE(error_code([&] {
                    static_cast<void>(gate.ingest(wrong_producer, 1800000000));
                }) == "artifact_producer_mismatch");

        auto revoked = required;
        revoked.signature_policy = std::make_shared<ArtifactTrustPolicy>(
            std::vector<ArtifactSigningCredential>{ArtifactSigningCredential{
                signed_artifact.signer_identity,
                vector.at("public_key_pem").get<std::string>(),
                1700000000,
                1900000000,
                true}});
        ArtifactIngestionGate revoked_gate(std::move(revoked));
        REQUIRE(error_code([&] {
                    static_cast<void>(revoked_gate.ingest(signed_ref, 1800000000));
                }) == "artifact_signer_revoked");
    }

    fs::remove_all(scratch, ignored);
    return 0;
#endif
}
