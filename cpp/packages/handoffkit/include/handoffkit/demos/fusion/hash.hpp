#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

/// FNV-1a 64-bit (always available, stable across platforms).
[[nodiscard]] std::uint64_t fnv1a64(std::string_view data);
[[nodiscard]] std::uint64_t fnv1a64_update(std::uint64_t hash, std::string_view data);

/// Hex digest helpers.
[[nodiscard]] std::string to_hex_lower(std::uint64_t value);
[[nodiscard]] std::string to_hex_lower(const std::vector<unsigned char>& bytes);

/// Stable content hash for cache keys (hex string).
/// Uses FNV-1a folded to 128-bit-like hex (two 64-bit lanes with salts).
[[nodiscard]] std::string fusion_content_hash(std::string_view data);
[[nodiscard]] std::string fusion_content_hash_parts(const std::vector<std::string_view>& parts);

/// Optional stronger hash when OpenSSL is linked (HTTP builds); else falls back to fusion_content_hash.
[[nodiscard]] std::string fusion_sha256_hex(std::string_view data);

/// Build cache key material then hash.
[[nodiscard]] std::string fusion_cache_key_hash(
    std::string_view provider,
    std::string_view model,
    std::string_view role_id,
    std::string_view system,
    std::string_view user,
    std::string_view profile,
    std::string_view mode,
    double temperature = 0.0
);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
