#pragma once

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/error.hpp>

#include <list>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>

namespace handoffkit {
namespace demos {
namespace fusion {

struct FusionCacheEntry {
    std::string key;
    std::string value;
    std::string prompt_hash;
    std::int64_t created_unix_ms = 0;
    std::int64_t expires_unix_ms = 0;
    std::string checksum;  // hash of value for integrity
    nlohmann::json metadata = nlohmann::json::object();

    [[nodiscard]] bool expired(std::int64_t now_ms) const;
    [[nodiscard]] std::size_t approx_bytes() const;
    nlohmann::json to_json() const;
    static Result<FusionCacheEntry> from_json(const nlohmann::json& j);
};

/// Content-addressed fusion LLM response cache (memory LRU + optional disk).
/// Not thread-safe for concurrent writers (CLI single-thread). Documented intentional.
class FusionCache {
public:
    explicit FusionCache(FusionCacheConfig config = {});

    [[nodiscard]] const FusionCacheConfig& config() const noexcept { return config_; }
    [[nodiscard]] FusionCacheStats stats() const;

    void set_config(FusionCacheConfig config);

    /// Lookup; updates LRU on memory hit. Returns nullopt on miss/expired/corrupt.
    [[nodiscard]] std::optional<std::string> get(const std::string& key);

    /// Store value under key.
    Result<void> put(const std::string& key, std::string value, nlohmann::json metadata = nlohmann::json::object());

    bool invalidate(const std::string& key);
    void clear_memory();
    Result<void> clear_disk();
    Result<void> clear_all();

    /// Disk path for a key (for tests/debug).
    [[nodiscard]] std::filesystem::path disk_path_for_key(const std::string& key) const;

    [[nodiscard]] std::size_t memory_size() const;
    [[nodiscard]] std::size_t memory_bytes() const;

    /// Compact: drop expired from memory; optional disk scan of index.
    Result<int> compact();

    nlohmann::json stats_json() const;

private:
    using ListIt = std::list<std::string>::iterator;

    FusionCacheConfig config_;
    FusionCacheStats stats_{};
    std::list<std::string> lru_;
    std::unordered_map<std::string, std::pair<FusionCacheEntry, ListIt>> map_;
    std::size_t memory_bytes_ = 0;

    void touch_lru(ListIt it);
    void evict_one();
    void evict_until_fit(std::size_t incoming_bytes);
    bool expired_entry(const FusionCacheEntry& e) const;
    Result<void> ensure_cache_dir() const;
    Result<std::optional<FusionCacheEntry>> disk_read(const std::string& key);
    Result<void> disk_write(const FusionCacheEntry& entry);
    Result<void> disk_remove(const std::string& key);
    static std::string compute_checksum(std::string_view value);
};

[[nodiscard]] std::string format_cache_stats_markdown(const FusionCacheStats& s);
[[nodiscard]] std::string format_cache_stats_text(const FusionCacheStats& s);
[[nodiscard]] bool cache_stats_healthy(const FusionCacheStats& s);
[[nodiscard]] nlohmann::json cache_stats_delta(const FusionCacheStats& before, const FusionCacheStats& after);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
