#include <handoffkit/demos/fusion/hash.hpp>

#include <iomanip>
#include <sstream>

#if defined(HANDOFFKIT_WITH_HTTP)
#include <openssl/evp.h>
#include <openssl/sha.h>
#endif

namespace handoffkit {
namespace demos {
namespace fusion {

std::uint64_t fnv1a64(std::string_view data) {
    return fnv1a64_update(14695981039346656037ull, data);
}

std::uint64_t fnv1a64_update(std::uint64_t hash, std::string_view data) {
    for (unsigned char c : data) {
        hash ^= static_cast<std::uint64_t>(c);
        hash *= 1099511628211ull;
    }
    return hash;
}

std::string to_hex_lower(std::uint64_t value) {
    std::ostringstream ss;
    ss << std::hex << std::setfill('0') << std::setw(16) << value;
    return ss.str();
}

std::string to_hex_lower(const std::vector<unsigned char>& bytes) {
    std::ostringstream ss;
    ss << std::hex << std::setfill('0');
    for (unsigned char b : bytes) {
        ss << std::setw(2) << static_cast<unsigned>(b);
    }
    return ss.str();
}

std::string fusion_content_hash(std::string_view data) {
    // Two independent FNV lanes with different salts for a wider digest string.
    const std::uint64_t a = fnv1a64(data);
    std::string salted;
    salted.reserve(data.size() + 16);
    salted.append("hk-fusion-salt-v1|");
    salted.append(data.data(), data.size());
    const std::uint64_t b = fnv1a64(salted);
    // mix length
    const std::uint64_t c = fnv1a64_update(a ^ (static_cast<std::uint64_t>(data.size()) * 0x9e3779b97f4a7c15ull), "len");
    return to_hex_lower(a) + to_hex_lower(b ^ c);
}

std::string fusion_content_hash_parts(const std::vector<std::string_view>& parts) {
    std::uint64_t h = 14695981039346656037ull;
    for (std::size_t i = 0; i < parts.size(); ++i) {
        h = fnv1a64_update(h, parts[i]);
        h = fnv1a64_update(h, "|");
        h = fnv1a64_update(h, std::to_string(i));
        h = fnv1a64_update(h, "|");
    }
    std::string combined;
    for (const auto& p : parts) {
        combined.append(p);
        combined.push_back('\n');
    }
    return fusion_content_hash(combined) + to_hex_lower(h);
}

std::string fusion_sha256_hex(std::string_view data) {
#if defined(HANDOFFKIT_WITH_HTTP)
    unsigned char digest[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(data.data()), data.size(), digest);
    std::vector<unsigned char> bytes(digest, digest + SHA256_DIGEST_LENGTH);
    return to_hex_lower(bytes);
#else
    return fusion_content_hash(data);
#endif
}

std::string fusion_cache_key_hash(
    std::string_view provider,
    std::string_view model,
    std::string_view role_id,
    std::string_view system,
    std::string_view user,
    std::string_view profile,
    std::string_view mode,
    double temperature
) {
    std::ostringstream material;
    material << "v1\n"
             << "provider=" << provider << "\n"
             << "model=" << model << "\n"
             << "role_id=" << role_id << "\n"
             << "profile=" << profile << "\n"
             << "mode=" << mode << "\n"
             << "temperature=" << temperature << "\n"
             << "system_len=" << system.size() << "\n"
             << "user_len=" << user.size() << "\n"
             << "---system---\n" << system << "\n"
             << "---user---\n" << user << "\n";
    return fusion_content_hash(material.str());
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
