#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/hash.hpp>

namespace handoffkit {
namespace demos {
namespace fusion {

bool FusionCacheEntry::expired(std::int64_t now_ms) const {
    if (expires_unix_ms <= 0) return false;
    return now_ms >= expires_unix_ms;
}

std::size_t FusionCacheEntry::approx_bytes() const {
    return key.size() + value.size() + prompt_hash.size() + checksum.size() + 64;
}

nlohmann::json FusionCacheEntry::to_json() const {
    return nlohmann::json{
        {"key", key},
        {"value", value},
        {"prompt_hash", prompt_hash},
        {"created_unix_ms", created_unix_ms},
        {"expires_unix_ms", expires_unix_ms},
        {"checksum", checksum},
        {"metadata", metadata.is_null() ? nlohmann::json::object() : metadata},
    };
}

Result<FusionCacheEntry> FusionCacheEntry::from_json(const nlohmann::json& j) {
    if (!j.is_object()) return Result<FusionCacheEntry>::failure(Error::parse_error("cache entry must be object"));
    FusionCacheEntry e;
    if (!j.contains("key") || !j.contains("value") || !j.contains("checksum")) {
        return Result<FusionCacheEntry>::failure(Error::parse_error("cache entry missing key/value/checksum"));
    }
    e.key = j.at("key").get<std::string>();
    e.value = j.at("value").get<std::string>();
    e.checksum = j.at("checksum").get<std::string>();
    if (j.contains("prompt_hash")) e.prompt_hash = j.at("prompt_hash").get<std::string>();
    if (j.contains("created_unix_ms")) e.created_unix_ms = j.at("created_unix_ms").get<std::int64_t>();
    if (j.contains("expires_unix_ms")) e.expires_unix_ms = j.at("expires_unix_ms").get<std::int64_t>();
    if (j.contains("metadata") && j.at("metadata").is_object()) e.metadata = j.at("metadata");
    return e;
}

FusionCache::FusionCache(FusionCacheConfig config) : config_(std::move(config)) {}

void FusionCache::set_config(FusionCacheConfig config) {
    config_ = std::move(config);
}

FusionCacheStats FusionCache::stats() const {
    FusionCacheStats s = stats_;
    s.memory_entries = map_.size();
    s.memory_bytes = memory_bytes_;
    return s;
}

nlohmann::json FusionCache::stats_json() const {
    return stats().to_json();
}

std::size_t FusionCache::memory_size() const { return map_.size(); }
std::size_t FusionCache::memory_bytes() const { return memory_bytes_; }

void FusionCache::touch_lru(ListIt it) {
    if (it == lru_.begin()) return;
    std::string key = *it;
    lru_.erase(it);
    lru_.push_front(std::move(key));
    auto mit = map_.find(lru_.front());
    if (mit != map_.end()) {
        mit->second.second = lru_.begin();
    }
}

void FusionCache::evict_one() {
    if (lru_.empty()) return;
    const std::string key = lru_.back();
    lru_.pop_back();
    auto it = map_.find(key);
    if (it == map_.end()) return;
    memory_bytes_ -= it->second.first.approx_bytes();
    map_.erase(it);
    ++stats_.evictions;
}

void FusionCache::evict_until_fit(std::size_t incoming_bytes) {
    while (!map_.empty()) {
        const bool over_entries = config_.max_memory_entries > 0 && map_.size() >= config_.max_memory_entries;
        const bool over_bytes =
            config_.max_memory_bytes > 0 && (memory_bytes_ + incoming_bytes) > config_.max_memory_bytes;
        if (!over_entries && !over_bytes) break;
        evict_one();
    }
}

bool FusionCache::expired_entry(const FusionCacheEntry& e) const {
    return e.expired(fusion_now_unix_ms());
}

std::string FusionCache::compute_checksum(std::string_view value) {
    return fusion_content_hash(value);
}

std::optional<std::string> FusionCache::get(const std::string& key) {
    if (!config_.enabled) {
        ++stats_.misses;
        return std::nullopt;
    }

    if (config_.use_memory) {
        auto it = map_.find(key);
        if (it != map_.end()) {
            if (expired_entry(it->second.first)) {
                memory_bytes_ -= it->second.first.approx_bytes();
                lru_.erase(it->second.second);
                map_.erase(it);
                ++stats_.misses;
            } else if (it->second.first.checksum != compute_checksum(it->second.first.value)) {
                memory_bytes_ -= it->second.first.approx_bytes();
                lru_.erase(it->second.second);
                map_.erase(it);
                ++stats_.corrupt_rejects;
                ++stats_.misses;
            } else {
                touch_lru(it->second.second);
                ++stats_.hits;
                return it->second.first.value;
            }
        }
    }

    if (config_.use_disk) {
        auto disk = disk_read(key);
        if (!disk) {
            ++stats_.misses;
            return std::nullopt;
        }
        if (!disk.value().has_value()) {
            ++stats_.misses;
            return std::nullopt;
        }
        auto entry = std::move(disk.value().value());
        if (expired_entry(entry)) {
            (void)disk_remove(key);
            ++stats_.misses;
            return std::nullopt;
        }
        if (entry.checksum != compute_checksum(entry.value)) {
            ++stats_.corrupt_rejects;
            (void)disk_remove(key);
            ++stats_.misses;
            return std::nullopt;
        }
        // promote to memory
        if (config_.use_memory) {
            (void)put(entry.key, entry.value, entry.metadata);
            // put increments puts/stats; adjust: this was a disk hit
        }
        ++stats_.hits;
        ++stats_.disk_reads;
        return entry.value;
    }

    ++stats_.misses;
    return std::nullopt;
}

Result<void> FusionCache::put(const std::string& key, std::string value, nlohmann::json metadata) {
    if (!config_.enabled) {
        return Result<void>::success();
    }
    if (key.empty()) {
        return Result<void>::failure(Error::invalid_argument("cache key empty", "key"));
    }

    FusionCacheEntry entry;
    entry.key = key;
    entry.value = std::move(value);
    entry.prompt_hash = key;
    entry.created_unix_ms = fusion_now_unix_ms();
    if (config_.ttl_seconds > 0) {
        entry.expires_unix_ms = entry.created_unix_ms + static_cast<std::int64_t>(config_.ttl_seconds) * 1000;
    }
    entry.checksum = compute_checksum(entry.value);
    entry.metadata = metadata.is_null() ? nlohmann::json::object() : std::move(metadata);

    if (config_.use_memory) {
        auto existing = map_.find(key);
        if (existing != map_.end()) {
            memory_bytes_ -= existing->second.first.approx_bytes();
            lru_.erase(existing->second.second);
            map_.erase(existing);
        }
        const auto bytes = entry.approx_bytes();
        evict_until_fit(bytes);
        lru_.push_front(key);
        map_.emplace(key, std::make_pair(entry, lru_.begin()));
        memory_bytes_ += bytes;
    }

    if (config_.use_disk) {
        auto w = disk_write(entry);
        if (!w) return w;
        ++stats_.disk_writes;
    }

    ++stats_.puts;
    return Result<void>::success();
}

bool FusionCache::invalidate(const std::string& key) {
    bool removed = false;
    auto it = map_.find(key);
    if (it != map_.end()) {
        memory_bytes_ -= it->second.first.approx_bytes();
        lru_.erase(it->second.second);
        map_.erase(it);
        removed = true;
    }
    if (config_.use_disk) {
        auto r = disk_remove(key);
        if (r) removed = true;
    }
    return removed;
}

void FusionCache::clear_memory() {
    map_.clear();
    lru_.clear();
    memory_bytes_ = 0;
}

Result<int> FusionCache::compact() {
    int removed = 0;
    const auto now = fusion_now_unix_ms();
    std::vector<std::string> doomed;
    for (const auto& [k, pair] : map_) {
        if (pair.first.expired(now)) doomed.push_back(k);
    }
    for (const auto& k : doomed) {
        invalidate(k);
        ++removed;
    }
    return removed;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
