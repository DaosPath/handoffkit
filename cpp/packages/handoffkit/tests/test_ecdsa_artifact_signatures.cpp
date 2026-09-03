#include <handoffkit/csp/artifact_security.hpp>

#include <cstdlib>
#include <functional>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>

#if defined(HANDOFFKIT_WITH_CRYPTO)
#include <openssl/bio.h>
#include <openssl/ec.h>
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

EphemeralKeyPair generate_ec_p256_key_pair() {
    EVP_PKEY_CTX* context = EVP_PKEY_CTX_new_id(EVP_PKEY_EC, nullptr);
    REQUIRE(context != nullptr);
    REQUIRE(EVP_PKEY_keygen_init(context) == 1);
    REQUIRE(EVP_PKEY_CTX_set_ec_paramgen_curve_nid(context, NID_X9_62_prime256v1) == 1);
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
    REQUIRE(!artifact_ecdsa_p256_sha256_provider_available());
    REQUIRE(error_code([] {
                static_cast<void>(artifact_public_key_fingerprint("not-a-key"));
            }) == "artifact_signature_provider_unavailable");
    return 0;
#else
    REQUIRE(artifact_signature_provider_available());

    const std::string identity = "spiffe://handoffkit.internal/producer/ecdsa-build";
    const std::string data = "handoffkit ecdsa-p256 signed artifact\n";
    const auto producer = generate_ec_p256_key_pair();
    const auto wrong = generate_ec_p256_key_pair();

    if (!artifact_ecdsa_p256_sha256_provider_available()) {
        // Fail closed: ECDSA support must not be claimed and signing must
        // refuse when the OpenSSL EVP provider is not detected at runtime.
        const auto code = error_code([&] {
            ArtifactSigner signer(
                producer.private_key_pem,
                identity,
                std::string(kArtifactAlgorithmEcdsaP256Sha256));
            static_cast<void>(signer.sign("artifact-ecdsa", data, 1800000000));
        });
        REQUIRE(
            code == "artifact_algorithm_unsupported" || code == "artifact_key_invalid" ||
            code == "artifact_signature_provider_unavailable");
        return 0;
    }

    // Capability detection reports ECDSA support only when the provider is
    // detected at runtime (this machine: OpenSSL 3.x default provider).
    REQUIRE(artifact_ecdsa_p256_sha256_provider_available());

    // Only the explicit allowlisted id is accepted; other ECDSA ids and
    // non-canonical spellings are rejected by SignedArtifact::validate().
    REQUIRE(error_code([] {
                SignedArtifact artifact;
                artifact.artifact_id = "a";
                artifact.signer_identity = "b";
                artifact.algorithm = "ecdsa-p384-sha384";
                artifact.content_hash = std::string(64, 'a');
                artifact.key_fingerprint = "sha256:" + std::string(64, 'b');
                artifact.created_at = 0;
                artifact.validate();
            }) == "artifact_algorithm_unsupported");
    REQUIRE(error_code([] {
                SignedArtifact artifact;
                artifact.artifact_id = "a";
                artifact.signer_identity = "b";
                artifact.algorithm = "ECDSA-P256-SHA256";
                artifact.content_hash = std::string(64, 'a');
                artifact.key_fingerprint = "sha256:" + std::string(64, 'b');
                artifact.created_at = 0;
                artifact.validate();
            }) == "artifact_algorithm_unsupported");

    // Constructor rejects unknown algorithm ids.
    REQUIRE(error_code([&] {
                ArtifactSigner bad(producer.private_key_pem, identity, "ecdsa-p384-sha384");
            }) == "artifact_algorithm_unsupported");

    // ECDSA-P256-SHA256 requires EC P-256 key material; an Ed25519 key is
    // rejected (fail closed) rather than silently mis-signed.
    const auto ed25519_keys = generate_ed25519_key_pair();
    REQUIRE(error_code([&] {
                ArtifactSigner bad(
                    ed25519_keys.private_key_pem,
                    identity,
                    std::string(kArtifactAlgorithmEcdsaP256Sha256));
            }) == "artifact_key_invalid");

    // Sign with the explicit ECDSA-P256-SHA256 algorithm id.
    ArtifactSigner signer(
        producer.private_key_pem,
        identity,
        std::string(kArtifactAlgorithmEcdsaP256Sha256));
    REQUIRE(signer.algorithm() == "ecdsa-p256-sha256");
    const auto signed_value = signer.sign("artifact-ecdsa-p256", data, 1800000000);
    REQUIRE(signed_value.algorithm == "ecdsa-p256-sha256");
    REQUIRE(signed_value.signature.size() > 90);  // DER ECDSA signature base64 (~96 chars)
    REQUIRE(
        signed_value.canonical_payload().find("\"algorithm\":\"ecdsa-p256-sha256\"") !=
        std::string::npos);

    // Verify with an explicitly allowlisted policy (ed25519 + ecdsa-p256-sha256).
    ArtifactTrustPolicy policy(
        {ArtifactSigningCredential{
            identity, producer.public_key_pem, 1700000000, 1900000000, false}},
        {"ed25519", "ecdsa-p256-sha256"});
    verify_signed_artifact(data, signed_value, policy, 1800000000);

    // JSON round-trip keeps the ECDSA artifact verifiable.
    const auto roundtrip = SignedArtifact::from_json(signed_value.to_json());
    verify_signed_artifact(data, roundtrip, policy, 1800000000);

    // Tampered content.
    REQUIRE(error_code([&] {
                verify_signed_artifact("tampered", signed_value, policy, 1800000000);
            }) == "artifact_integrity_mismatch");

    // Tampered signature bytes.
    auto bad_signature = signed_value;
    bad_signature.signature[0] = bad_signature.signature[0] == 'A' ? 'B' : 'A';
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, bad_signature, policy, 1800000000);
            }) == "artifact_signature_invalid");

    // Wrong signer identity.
    auto wrong_identity = signed_value;
    wrong_identity.signer_identity = "spiffe://handoffkit.internal/producer/impostor";
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, wrong_identity, policy, 1800000000);
            }) == "artifact_signer_mismatch");

    // Wrong signer key: untrusted fingerprint.
    ArtifactTrustPolicy wrong_key_policy(
        {ArtifactSigningCredential{
            identity, wrong.public_key_pem, 1700000000, 1900000000, false}},
        {"ed25519", "ecdsa-p256-sha256"});
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, signed_value, wrong_key_policy, 1800000000);
            }) == "artifact_signer_untrusted");

    // Expired credential validity window.
    ArtifactTrustPolicy expired_policy(
        {ArtifactSigningCredential{
            identity, producer.public_key_pem, 1700000000, 1750000000, false}},
        {"ed25519", "ecdsa-p256-sha256"});
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, signed_value, expired_policy, 1800000000);
            }) == "artifact_signer_expired");

    // Revoked credential.
    ArtifactTrustPolicy revoked_policy(
        {ArtifactSigningCredential{
            identity, producer.public_key_pem, 1700000000, 1900000000, true}},
        {"ed25519", "ecdsa-p256-sha256"});
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, signed_value, revoked_policy, 1800000000);
            }) == "artifact_signer_revoked");

    // ECDSA is not verified unless explicitly allowlisted by the policy.
    ArtifactTrustPolicy ed25519_only_policy(
        {ArtifactSigningCredential{
            identity, producer.public_key_pem, 1700000000, 1900000000, false}},
        {"ed25519"});
    REQUIRE(error_code([&] {
                verify_signed_artifact(data, signed_value, ed25519_only_policy, 1800000000);
            }) == "artifact_algorithm_unsupported");

    // Regression: Ed25519 behavior is unchanged (default signer + verify).
    const auto producer_ed = generate_ed25519_key_pair();
    ArtifactSigner ed_signer(producer_ed.private_key_pem, identity);
    REQUIRE(ed_signer.algorithm() == "ed25519");
    const auto ed_signed = ed_signer.sign("artifact-ed25519", data, 1800000000);
    REQUIRE(ed_signed.algorithm == "ed25519");
    ArtifactTrustPolicy ed_policy(
        {ArtifactSigningCredential{
            identity, producer_ed.public_key_pem, 1700000000, 1900000000, false}},
        {"ed25519"});
    verify_signed_artifact(data, ed_signed, ed_policy, 1800000000);

    return 0;
#endif
}
