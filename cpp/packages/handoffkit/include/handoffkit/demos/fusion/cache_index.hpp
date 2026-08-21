#pragma once

#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/error.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

/// On-disk index of cache entries (key, path, size, mtime) for compaction/listing.
struct CacheIndexEntry {
    std::string key;
    std::string relative_path;
    std::size_t bytes = 0;
    std::int64_t mtime_unix_ms = 0;
    std::string checksum;

    nlohmann::json to_json() const;
    static Result<CacheIndexEntry> from_json(const nlohmann::json& j);
};

class FusionCacheIndex {
public:
    explicit FusionCacheIndex(std::filesystem::path cache_dir);

    [[nodiscard]] const std::filesystem::path& cache_dir() const noexcept { return cache_dir_; }
    [[nodiscard]] std::filesystem::path index_path() const;

    Result<void> load();
    Result<void> save() const;
    Result<void> rebuild_from_disk();

    void upsert(CacheIndexEntry entry);
    bool erase(const std::string& key);
    [[nodiscard]] const CacheIndexEntry* find(const std::string& key) const;
    [[nodiscard]] std::vector<CacheIndexEntry> list() const;
    [[nodiscard]] std::size_t size() const { return entries_.size(); }
    [[nodiscard]] std::size_t total_bytes() const;

    /// Drop index rows whose files are missing or corrupt; returns removed count.
    Result<int> prune_missing();
    /// Keep only newest max_entries by mtime.
    Result<int> compact_to(std::size_t max_entries);

    nlohmann::json to_json() const;

private:
    std::filesystem::path cache_dir_;
    std::vector<CacheIndexEntry> entries_;
};

/// Scan sharded cache_dir for *.json entry files.
Result<std::vector<std::filesystem::path>> list_cache_shard_files(const std::filesystem::path& cache_dir);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
