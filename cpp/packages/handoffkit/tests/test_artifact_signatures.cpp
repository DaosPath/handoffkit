#include <handoffkit/csp/artifact_security.hpp>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <iterator>
#include <string>

#if defined(HANDOFFKIT_WITH_CRYPTO)
#include <openssl/bio.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#endif

#define REQUIRE(condition)                                                        \
    do {                                                                          \
        if (!(condition)) {                                                       \
            std::cerr << "requirement failed at line " << __LINE__ << ": "       \
                      << #condition << '\n';                                      \
            abort();                                                              \
        }                                                                         \
    } while (false)

namespace {

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    REQUIRE(input.good());
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

std::string error_code(const std::function<void()>& operation) {
    try {
        operation();
    } catch (const handoffkit::csp::SecurityError& error) {
        return error.code();
    }
    return {};
}

#if defined(HANDOFFKIT_WITH_CRYPTO)
struct EphemeralKeyPair {
    std::string private_key_pem;
    std::string public_key_pem;
};

std::string bio_value(BIO* bio) {
    char* data = nullptr;
    const auto size = BIO_get_mem_data(bio, &data);
    REQUIRE(size > 0 && data != nullptr);
    return {data, static_cast<std::size_t>(size)};
}

EphemeralKeyPair generate_ed25519_key_pair() {
    EVP_PKEY_CTX* context = EVP_PKEY_CTX_new_id(EVP_PKEY_ED25519, nullptr);
    REQUIRE(context != nullptr);
    REQUIRE(EVP_PKEY_keygen_init(context) == 1);
    EVP_PKEY* key = nullptr;
    REQUIRE(EVP_PKEY_keygen(context, &key) == 1);
    EVP_PKEY_CTX_free(context);

    BIO* private_bio = BIO_new(BIO_s_mem());
    BIO* public_bio = BIO_new(BIO_s_mem());
    REQUIRE(private_bio != nullptr && public_bio != nullptr);
    REQUIRE(PEM_write_bio_PrivateKey(private_bio, key, nullptr, nullptr, 0, nullptr, nullptr) == 1);
    REQUIRE(PEM_write_bio_PUBKEY(public_bio, key) == 1);
    EphemeralKeyPair result{bio_value(private_bio), bio_value(public_bio)};
    BIO_free(private_bio);
    BIO_free(public_bio);
    EVP_PKEY_free(key);
    return result;
}
#endif

}  // namespace

int main() {
    using namespace handoffkit::csp;
#if !defined(HANDOFFKIT_WITH_CRYPTO)
    REQUIRE(!artifact_signature_provider_available());
    REQUIRE(error_code([] {
                static_cast<void>(artifact_public_key_fingerprint("not-a-key"));
            }) == "artifact_signature_provider_unavailable");
    return 0;
#else
    REQUIRE(artifact_signature_provider_available());
#ifndef HANDOFFKIT_CONTRACTS_DIR
#error HANDOFFKIT_CONTRACTS_DIR is required for artifact signature conformance
#endif
    const auto vector_path = std::filesystem::path(HANDOFFKIT_CONTRACTS_DIR) /
                             "test-fixtures" / "artifact-signing" / "vector.json";
    const auto vector = nlohmann::json::parse(read_file(vector_path));
    const auto expected = SignedArtifact::from_json(vector.at("signed_artifact"));
    const std::string data = "handoffkit signed artifact\n";
    const auto vector_public = vector.at("public_key_pem").get<std::string>();
    const ArtifactSigningCredential vector_credential{
        expected.signer_identity, vector_public, 1700000000, 1900000000, false};
    ArtifactTrustPolicy vector_policy({vector_credential});
    verify_signed_artifact(data, expected, vector_policy, 1800000000);

    const auto producer = generate_ed25519_key_pair();
    const auto wrong = generate_ed25519_key_pair();
    ArtifactSigner signer(producer.private_key_pem, expected.signer_identity);
    const auto signed_value = signer.sign("artifact-ephemeral", data, expected.created_at);
    const ArtifactSigningCredential trusted{
        expected.signer_identity, producer.public_key_pem, 1700000000, 1900000000, false};
    ArtifactTrustPolicy policy({trusted});
    verify_signed_artifact(data, signed_value, policy, 1800000000);

    REQUIRE(error_code([&] {
                verify_signed_artifact("tampered", signed_value, policy, 1800000000);
            }) == "artifact_integrity_mismatch");

    auto bad_signature = signed_value;
    bad_signature.signature[0] = bad_signature.signature[0] == 'A' ? 'B' : 'A';
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, bad_signature, policy, 1800000000);
            }) == "artifact_signature_invalid");

    auto wrong_identity = signed_value;
    wrong_identity.signer_identity = "spiffe://handoffkit.internal/producer/impostor";
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, wrong_identity, policy, 1800000000);
            }) == "artifact_signer_mismatch");

    ArtifactTrustPolicy wrong_key_policy({ArtifactSigningCredential{
        expected.signer_identity, wrong.public_key_pem, 1700000000, 1900000000, false}});
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, signed_value, wrong_key_policy, 1800000000);
            }) == "artifact_signer_untrusted");

    ArtifactTrustPolicy expired_policy({ArtifactSigningCredential{
        expected.signer_identity, producer.public_key_pem, 1700000000, 1750000000, false}});
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, signed_value, expired_policy, 1800000000);
            }) == "artifact_signer_expired");

    ArtifactTrustPolicy revoked_policy({ArtifactSigningCredential{
        expected.signer_identity, producer.public_key_pem, 1700000000, 1900000000, true}});
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, signed_value, revoked_policy, 1800000000);
            }) == "artifact_signer_revoked");

    ArtifactTrustPolicy disallowed_policy({trusted}, {});
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, signed_value, disallowed_policy, 1800000000);
            }) == "artifact_algorithm_unsupported");
    return 0;
#endif
}
