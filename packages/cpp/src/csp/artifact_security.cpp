#include <handoffkit/csp/artifact_security.hpp>

#include <algorithm>
#include <chrono>
#include <iomanip>
#include <memory>
#include <sstream>
#include <utility>

#if defined(HANDOFFKIT_WITH_CRYPTO)
#include <openssl/evp.h>
#include <openssl/pem.h>
#endif

namespace handoffkit::csp {
namespace {

#if !defined(HANDOFFKIT_WITH_CRYPTO)
[[noreturn]] void provider_unavailable() {
    throw SecurityError(
        "artifact_signature_provider_unavailable",
        "C++ artifact signatures require a build with HANDOFFKIT_WITH_CRYPTO=ON.");
}
#endif

#if defined(HANDOFFKIT_WITH_CRYPTO)
std::int64_t unix_now() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

using BioPtr = std::unique_ptr<BIO, decltype(&BIO_free)>;
using KeyPtr = std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)>;
using DigestContextPtr = std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)>;

KeyPtr load_public_key(const std::string& pem) {
    BioPtr bio(BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size())), BIO_free);
    if (!bio) throw SecurityError("crypto_provider_error", "OpenSSL BIO allocation failed.");
    KeyPtr key(PEM_read_bio_PUBKEY(bio.get(), nullptr, nullptr, nullptr), EVP_PKEY_free);
    if (!key || EVP_PKEY_id(key.get()) != EVP_PKEY_ED25519) {
        throw SecurityError(
            "artifact_key_invalid", "Artifact credential must contain an Ed25519 public key.");
    }
    return key;
}

KeyPtr load_private_key(std::string_view pem) {
    BioPtr bio(BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size())), BIO_free);
    if (!bio) throw SecurityError("crypto_provider_error", "OpenSSL BIO allocation failed.");
    KeyPtr key(PEM_read_bio_PrivateKey(bio.get(), nullptr, nullptr, nullptr), EVP_PKEY_free);
    if (!key || EVP_PKEY_id(key.get()) != EVP_PKEY_ED25519) {
        throw SecurityError(
            "artifact_key_invalid", "Artifact signer must contain an Ed25519 private key.");
    }
    return key;
}

std::vector<unsigned char> sha256(std::string_view value) {
    std::vector<unsigned char> digest(EVP_MAX_MD_SIZE);
    unsigned int size = 0;
    if (EVP_Digest(
            value.data(), value.size(), digest.data(), &size, EVP_sha256(), nullptr) != 1 ||
        size != 32) {
        throw SecurityError("crypto_provider_error", "OpenSSL SHA-256 failed.");
    }
    digest.resize(size);
    return digest;
}

std::string hex_lower(const std::vector<unsigned char>& bytes) {
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (const auto byte : bytes) {
        output << std::setw(2) << static_cast<unsigned int>(byte);
    }
    return output.str();
}

std::vector<unsigned char> raw_public_key(EVP_PKEY* key) {
    std::size_t size = 0;
    if (EVP_PKEY_get_raw_public_key(key, nullptr, &size) != 1 || size != 32) {
        throw SecurityError(
            "artifact_key_invalid", "OpenSSL could not extract the Ed25519 public key.");
    }
    std::vector<unsigned char> raw(size);
    if (EVP_PKEY_get_raw_public_key(key, raw.data(), &size) != 1) {
        throw SecurityError(
            "artifact_key_invalid", "OpenSSL could not extract the Ed25519 public key.");
    }
    raw.resize(size);
    return raw;
}

std::string key_fingerprint(EVP_PKEY* key) {
    const auto raw = raw_public_key(key);
    return "sha256:" + hex_lower(sha256(std::string_view(
                                      reinterpret_cast<const char*>(raw.data()), raw.size())));
}

std::string base64_encode(const std::vector<unsigned char>& value) {
    std::string encoded(4 * ((value.size() + 2) / 3), '\0');
    const auto size = EVP_EncodeBlock(
        reinterpret_cast<unsigned char*>(encoded.data()),
        value.data(),
        static_cast<int>(value.size()));
    if (size < 0) throw SecurityError("crypto_provider_error", "OpenSSL base64 encode failed.");
    encoded.resize(static_cast<std::size_t>(size));
    return encoded;
}

std::vector<unsigned char> base64_decode(const std::string& value) {
    if (value.empty() || value.size() % 4 != 0) {
        throw SecurityError("artifact_signature_invalid", "Artifact signature is not valid base64.");
    }
    std::vector<unsigned char> decoded((value.size() / 4) * 3);
    const auto decoded_size = EVP_DecodeBlock(
        decoded.data(),
        reinterpret_cast<const unsigned char*>(value.data()),
        static_cast<int>(value.size()));
    if (decoded_size < 0) {
        throw SecurityError("artifact_signature_invalid", "Artifact signature is not valid base64.");
    }
    std::size_t padding = 0;
    if (!value.empty() && value.back() == '=') ++padding;
    if (value.size() > 1 && value[value.size() - 2] == '=') ++padding;
    decoded.resize(static_cast<std::size_t>(decoded_size) - padding);
    return decoded;
}

std::vector<unsigned char> sign_payload(EVP_PKEY* key, std::string_view payload) {
    DigestContextPtr context(EVP_MD_CTX_new(), EVP_MD_CTX_free);
    if (!context || EVP_DigestSignInit(context.get(), nullptr, nullptr, nullptr, key) != 1) {
        throw SecurityError("crypto_provider_error", "OpenSSL Ed25519 sign init failed.");
    }
    std::size_t signature_size = 0;
    if (EVP_DigestSign(
            context.get(),
            nullptr,
            &signature_size,
            reinterpret_cast<const unsigned char*>(payload.data()),
            payload.size()) != 1) {
        throw SecurityError("crypto_provider_error", "OpenSSL Ed25519 sizing failed.");
    }
    std::vector<unsigned char> signature(signature_size);
    if (EVP_DigestSign(
            context.get(),
            signature.data(),
            &signature_size,
            reinterpret_cast<const unsigned char*>(payload.data()),
            payload.size()) != 1) {
        throw SecurityError("crypto_provider_error", "OpenSSL Ed25519 signing failed.");
    }
    signature.resize(signature_size);
    return signature;
}

void verify_payload(EVP_PKEY* key, std::string_view payload, const std::vector<unsigned char>& sig) {
    DigestContextPtr context(EVP_MD_CTX_new(), EVP_MD_CTX_free);
    if (!context || EVP_DigestVerifyInit(context.get(), nullptr, nullptr, nullptr, key) != 1) {
        throw SecurityError("crypto_provider_error", "OpenSSL Ed25519 verify init failed.");
    }
    const auto verified = EVP_DigestVerify(
        context.get(),
        sig.data(),
        sig.size(),
        reinterpret_cast<const unsigned char*>(payload.data()),
        payload.size());
    if (verified != 1) {
        throw SecurityError(
            "artifact_signature_invalid", "Ed25519 artifact signature verification failed.");
    }
}

#endif

}  // namespace

bool artifact_signature_provider_available() noexcept {
#if defined(HANDOFFKIT_WITH_CRYPTO)
    return true;
#else
    return false;
#endif
}

std::string artifact_public_key_fingerprint(const std::string& public_key_pem) {
#if defined(HANDOFFKIT_WITH_CRYPTO)
    auto key = load_public_key(public_key_pem);
    return key_fingerprint(key.get());
#else
    (void)public_key_pem;
    provider_unavailable();
#endif
}

std::string ArtifactSigningCredential::fingerprint() const {
    return artifact_public_key_fingerprint(public_key_pem);
}

ArtifactTrustPolicy::ArtifactTrustPolicy(
    std::vector<ArtifactSigningCredential> credentials,
    std::unordered_set<std::string> allowed_algorithms,
    std::int64_t max_future_skew_seconds)
    : allowed_algorithms_(std::move(allowed_algorithms)),
      max_future_skew_seconds_(max_future_skew_seconds) {
    if (max_future_skew_seconds_ < 0) {
        throw std::invalid_argument("max_future_skew_seconds must not be negative");
    }
    for (auto& credential : credentials) {
        if (credential.signer_identity.empty()) {
            throw std::invalid_argument("signer_identity must not be empty");
        }
        const auto key = credential.fingerprint();
        if (!credentials_.emplace(key, std::move(credential)).second) {
            throw std::invalid_argument("duplicate artifact signing credential");
        }
    }
}

const ArtifactSigningCredential* ArtifactTrustPolicy::credential_for(
    const std::string& fingerprint_value) const {
    const auto found = credentials_.find(fingerprint_value);
    return found == credentials_.end() ? nullptr : &found->second;
}

bool ArtifactTrustPolicy::algorithm_allowed(const std::string& algorithm) const {
    return allowed_algorithms_.contains(algorithm);
}

std::int64_t ArtifactTrustPolicy::max_future_skew_seconds() const noexcept {
    return max_future_skew_seconds_;
}

ArtifactSigner::ArtifactSigner(std::string private_key_pem, std::string signer_identity)
    : private_key_pem_(std::move(private_key_pem)),
      signer_identity_(std::move(signer_identity)) {
    if (signer_identity_.empty()) throw std::invalid_argument("signer_identity must not be empty");
#if defined(HANDOFFKIT_WITH_CRYPTO)
    static_cast<void>(load_private_key(private_key_pem_.view()));
#else
    provider_unavailable();
#endif
}

SignedArtifact ArtifactSigner::sign(
    const std::string& artifact_id,
    std::string_view data,
    std::int64_t created_at) const {
#if defined(HANDOFFKIT_WITH_CRYPTO)
    if (created_at == 0) created_at = unix_now();
    auto key = load_private_key(private_key_pem_.view());
    SignedArtifact artifact;
    artifact.artifact_id = artifact_id;
    artifact.content_hash = hex_lower(sha256(data));
    artifact.algorithm = "ed25519";
    artifact.signer_identity = signer_identity_;
    artifact.key_fingerprint = key_fingerprint(key.get());
    artifact.created_at = created_at;
    artifact.signature = base64_encode(sign_payload(key.get(), artifact.canonical_payload()));
    artifact.validate();
    return artifact;
#else
    (void)artifact_id;
    (void)data;
    (void)created_at;
    provider_unavailable();
#endif
}

void verify_signed_artifact(
    std::string_view data,
    const SignedArtifact& artifact,
    const ArtifactTrustPolicy& policy,
    std::int64_t now) {
#if defined(HANDOFFKIT_WITH_CRYPTO)
    artifact.validate();
    if (!policy.algorithm_allowed(artifact.algorithm)) {
        throw SecurityError(
            "artifact_algorithm_unsupported",
            "Artifact signature algorithm is not allowlisted.");
    }
    if (hex_lower(sha256(data)) != artifact.content_hash) {
        throw SecurityError(
            "artifact_integrity_mismatch",
            "Artifact content does not match the signed SHA-256 digest.");
    }
    const auto* credential = policy.credential_for(artifact.key_fingerprint);
    if (credential == nullptr) {
        throw SecurityError("artifact_signer_untrusted", "Artifact signer key is not trusted.");
    }
    if (credential->signer_identity != artifact.signer_identity) {
        throw SecurityError(
            "artifact_signer_mismatch",
            "Artifact signer identity does not match local key policy.");
    }
    if (credential->revoked) {
        throw SecurityError("artifact_signer_revoked", "Artifact signer key is revoked.");
    }
    if (now == 0) now = unix_now();
    if ((credential->valid_from > 0 && now < credential->valid_from) ||
        (credential->valid_until > 0 && now > credential->valid_until)) {
        throw SecurityError(
            "artifact_signer_expired",
            "Artifact signer credential is outside its validity window.");
    }
    if (artifact.created_at > now + policy.max_future_skew_seconds() ||
        (credential->valid_from > 0 && artifact.created_at < credential->valid_from) ||
        (credential->valid_until > 0 && artifact.created_at > credential->valid_until)) {
        throw SecurityError(
            "artifact_timestamp_invalid",
            "Artifact signature timestamp is outside the accepted window.");
    }
    auto key = load_public_key(credential->public_key_pem);
    if (key_fingerprint(key.get()) != artifact.key_fingerprint) {
        throw SecurityError(
            "artifact_signer_untrusted", "Artifact signer fingerprint does not match key material.");
    }
    const auto signature = base64_decode(artifact.signature);
    verify_payload(key.get(), artifact.canonical_payload(), signature);
#else
    (void)data;
    (void)artifact;
    (void)policy;
    (void)now;
    provider_unavailable();
#endif
}

}  // namespace handoffkit::csp
