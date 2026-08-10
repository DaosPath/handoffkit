#include <handoffkit/csp/security.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <iomanip>
#include <sstream>
#include <set>
#include <string_view>

#if defined(HANDOFFKIT_WITH_CRYPTO)
#include <openssl/evp.h>
#endif

namespace handoffkit::csp {
namespace {

constexpr std::string_view kFormat = "handoffkit.security.transcript";
constexpr std::uint32_t kFormatVersion = 1;

std::string normalize_fingerprint(const std::string& value) {
    std::string normalized;
    normalized.reserve(value.size());
    for (const unsigned char character : value) {
        if (character != ':') normalized.push_back(static_cast<char>(std::tolower(character)));
    }
    if (normalized.rfind("sha256", 0) == 0) normalized.erase(0, 6);
    return "sha256:" + normalized;
}

bool is_sha256(const std::string& value) {
    if (value.size() != 71 || value.rfind("sha256:", 0) != 0) return false;
    return std::all_of(value.begin() + 7, value.end(), [](unsigned char character) {
        return std::isdigit(character) != 0 || (character >= 'a' && character <= 'f');
    });
}

std::string canonical_sha256(const nlohmann::json& value) {
#if defined(HANDOFFKIT_WITH_CRYPTO)
    const auto encoded = value.dump();
    std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
    unsigned int size = 0;
    if (EVP_Digest(
            encoded.data(), encoded.size(), digest.data(), &size, EVP_sha256(), nullptr) != 1 ||
        size != 32) {
        throw SecurityError(
            "security_transcript_hash_failed",
            "could not calculate the security transcript SHA-256 digest");
    }
    std::ostringstream output;
    output << "sha256:" << std::hex << std::setfill('0');
    for (unsigned int index = 0; index < size; ++index) {
        output << std::setw(2) << static_cast<unsigned int>(digest[index]);
    }
    return output.str();
#else
    static_cast<void>(value);
    throw SecurityError(
        "security_transcript_backend_unavailable",
        "security transcript hashing requires HANDOFFKIT_WITH_CRYPTO=ON");
#endif
}

void require_non_empty(const std::string& value, const char* field) {
    if (value.empty()) {
        throw SecurityError(
            "security_transcript_invalid",
            std::string("security transcript field '") + field + "' is empty");
    }
}

}  // namespace

SecurityTranscript SecurityTranscript::build(const SecurityTranscriptInput& input) {
    const auto sender_fingerprint = normalize_fingerprint(input.sender.credential_fingerprint);
    const auto receiver_fingerprint = normalize_fingerprint(input.receiver.credential_fingerprint);
    const auto capabilities = [&] {
        auto values = input.sender.capabilities;
        std::sort(values.begin(), values.end());
        return values;
    }();

    SecurityTranscript transcript;
    transcript.binding_hash = canonical_sha256({
        {"receiver_credential_fingerprint", receiver_fingerprint},
        {"sender_credential_fingerprint", sender_fingerprint},
        {"tls_version", input.tls_version}});
    transcript.binding_type = "tls-certificate-endpoints";
    transcript.capabilities_hash = canonical_sha256(capabilities);
    transcript.format = std::string(kFormat);
    transcript.format_version = kFormatVersion;
    transcript.handshake_nonce = input.handshake_nonce;
    transcript.negotiated_group = input.negotiated_group;
    transcript.protocol_version = input.protocol_version;
    transcript.receiver_credential_fingerprint = receiver_fingerprint;
    transcript.receiver_node_id = input.receiver.node_id;
    transcript.receiver_peer_id = input.receiver.peer_id;
    transcript.requested_profile = to_string(input.requested_profile);
    transcript.selected_profile = to_string(input.selected_profile);
    transcript.sender_credential_fingerprint = sender_fingerprint;
    transcript.sender_node_id = input.sender.node_id;
    transcript.sender_peer_id = input.sender.peer_id;
    transcript.session_id = input.session_id;
    transcript.timestamp = input.timestamp;
    transcript.tls_version = input.tls_version;
    transcript.validate(false);
    transcript.transcript_hash = transcript.digest();
    return transcript;
}

nlohmann::json SecurityTranscript::unsigned_json() const {
    return {
        {"binding_hash", binding_hash},
        {"binding_type", binding_type},
        {"capabilities_hash", capabilities_hash},
        {"format", format},
        {"format_version", format_version},
        {"handshake_nonce", handshake_nonce},
        {"negotiated_group", negotiated_group ? nlohmann::json(*negotiated_group) : nlohmann::json(nullptr)},
        {"protocol_version", protocol_version},
        {"receiver_credential_fingerprint", receiver_credential_fingerprint},
        {"receiver_node_id", receiver_node_id},
        {"receiver_peer_id", receiver_peer_id},
        {"requested_profile", requested_profile},
        {"selected_profile", selected_profile},
        {"sender_credential_fingerprint", sender_credential_fingerprint},
        {"sender_node_id", sender_node_id},
        {"sender_peer_id", sender_peer_id},
        {"session_id", session_id},
        {"timestamp", timestamp},
        {"tls_version", tls_version}};
}

nlohmann::json SecurityTranscript::to_json() const {
    auto value = unsigned_json();
    value["transcript_hash"] = transcript_hash;
    return value;
}

std::string SecurityTranscript::digest() const { return canonical_sha256(unsigned_json()); }

void SecurityTranscript::validate(bool require_hash) const {
    if (format != kFormat) {
        throw SecurityError("security_transcript_invalid", "security transcript format is not recognized");
    }
    if (format_version != kFormatVersion) {
        throw SecurityError("security_transcript_version", "security transcript format version is unavailable");
    }
    const std::array<std::pair<const char*, const std::string*>, 16> required{{
        {"binding_hash", &binding_hash}, {"binding_type", &binding_type},
        {"capabilities_hash", &capabilities_hash}, {"handshake_nonce", &handshake_nonce},
        {"protocol_version", &protocol_version}, {"receiver_credential_fingerprint", &receiver_credential_fingerprint},
        {"receiver_node_id", &receiver_node_id}, {"receiver_peer_id", &receiver_peer_id},
        {"requested_profile", &requested_profile}, {"selected_profile", &selected_profile},
        {"sender_credential_fingerprint", &sender_credential_fingerprint}, {"sender_node_id", &sender_node_id},
        {"sender_peer_id", &sender_peer_id}, {"session_id", &session_id},
        {"timestamp", &timestamp}, {"tls_version", &tls_version}}};
    for (const auto& [name, value] : required) require_non_empty(*value, name);
    for (const auto* value : {&binding_hash, &capabilities_hash, &receiver_credential_fingerprint, &sender_credential_fingerprint}) {
        if (!is_sha256(*value)) throw SecurityError("security_transcript_invalid", "security transcript contains an invalid SHA-256 value");
    }
    if (require_hash && !is_sha256(transcript_hash)) {
        throw SecurityError("security_transcript_invalid", "security transcript hash is invalid");
    }
}

SecurityTranscript SecurityTranscript::from_json(const nlohmann::json& value) {
    if (!value.is_object()) throw SecurityError("security_transcript_invalid", "security transcript is malformed");
    static const std::set<std::string> fields{
        "binding_hash", "binding_type", "capabilities_hash", "format", "format_version",
        "handshake_nonce", "negotiated_group", "protocol_version", "receiver_credential_fingerprint",
        "receiver_node_id", "receiver_peer_id", "requested_profile", "selected_profile",
        "sender_credential_fingerprint", "sender_node_id", "sender_peer_id", "session_id",
        "timestamp", "tls_version", "transcript_hash"};
    for (const auto& item : value.items()) {
        if (!fields.contains(item.key())) throw SecurityError("security_transcript_invalid", "security transcript contains an unknown field");
    }
    SecurityTranscript transcript;
    try {
        transcript.binding_hash = value.at("binding_hash").get<std::string>();
        transcript.binding_type = value.at("binding_type").get<std::string>();
        transcript.capabilities_hash = value.at("capabilities_hash").get<std::string>();
        transcript.format = value.at("format").get<std::string>();
        transcript.format_version = value.at("format_version").get<std::uint32_t>();
        transcript.handshake_nonce = value.at("handshake_nonce").get<std::string>();
        if (!value.at("negotiated_group").is_null()) transcript.negotiated_group = value.at("negotiated_group").get<std::string>();
        transcript.protocol_version = value.at("protocol_version").get<std::string>();
        transcript.receiver_credential_fingerprint = value.at("receiver_credential_fingerprint").get<std::string>();
        transcript.receiver_node_id = value.at("receiver_node_id").get<std::string>();
        transcript.receiver_peer_id = value.at("receiver_peer_id").get<std::string>();
        transcript.requested_profile = value.at("requested_profile").get<std::string>();
        transcript.selected_profile = value.at("selected_profile").get<std::string>();
        transcript.sender_credential_fingerprint = value.at("sender_credential_fingerprint").get<std::string>();
        transcript.sender_node_id = value.at("sender_node_id").get<std::string>();
        transcript.sender_peer_id = value.at("sender_peer_id").get<std::string>();
        transcript.session_id = value.at("session_id").get<std::string>();
        transcript.timestamp = value.at("timestamp").get<std::string>();
        transcript.tls_version = value.at("tls_version").get<std::string>();
        transcript.transcript_hash = value.at("transcript_hash").get<std::string>();
    } catch (const std::exception&) {
        throw SecurityError("security_transcript_invalid", "security transcript is malformed");
    }
    transcript.validate(true);
    if (transcript.digest() != transcript.transcript_hash) {
        throw SecurityError("security_transcript_hash_mismatch", "security transcript hash does not match its canonical payload");
    }
    return transcript;
}

SecurityTranscript SecurityTranscript::verify(
    const nlohmann::json& value,
    const SecurityTranscriptInput& input) {
    const auto transcript = from_json(value);
    const auto expected = build(input);
    const auto profile = to_string(input.selected_profile);
    if (transcript.requested_profile != profile || transcript.selected_profile != profile) {
        throw SecurityError("security_profile_mismatch", "security transcript attempted a profile downgrade");
    }
    if (transcript.sender_peer_id != expected.sender_peer_id ||
        transcript.sender_node_id != expected.sender_node_id ||
        transcript.sender_credential_fingerprint != expected.sender_credential_fingerprint ||
        transcript.receiver_peer_id != expected.receiver_peer_id ||
        transcript.receiver_node_id != expected.receiver_node_id ||
        transcript.receiver_credential_fingerprint != expected.receiver_credential_fingerprint) {
        throw SecurityError("security_transcript_identity_mismatch", "security transcript identities do not match authenticated TLS endpoints");
    }
    if (transcript.to_json() != expected.to_json()) {
        throw SecurityError("security_transcript_mismatch", "security transcript does not match the authenticated HK-CSP exchange");
    }
    return transcript;
}

}  // namespace handoffkit::csp
