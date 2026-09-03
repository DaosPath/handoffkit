#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/hash.hpp>

#include <fstream>
#include <system_error>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

std::filesystem::path shard_path(const std::filesystem::path& root, const std::string& key) {
    // content-addressed style path: ab/cd/<fullkey>.json
    std::string shard = key;
    if (shard.size() < 4) {
        shard = fusion_content_hash(key);
    }
    const std::string a = shard.substr(0, 2);
    const std::string b = shard.substr(2, 2);
    return root / a / b / (shard + ".json");
}

}  // namespace

std::filesystem::path FusionCache::disk_path_for_key(const std::string& key) const {
    return shard_path(config_.cache_dir, key);
}

Result<void> FusionCache::ensure_cache_dir() const {
    std::error_code ec;
    std::filesystem::create_directories(config_.cache_dir, ec);
    if (ec) {
        return Result<void>::failure(Error::provider_failed("failed to create cache_dir: " + ec.message()));
    }
    return Result<void>::success();
}

Result<std::optional<FusionCacheEntry>> FusionCache::disk_read(const std::string& key) {
    const auto path = disk_path_for_key(key);
    if (!std::filesystem::exists(path)) {
        return std::optional<FusionCacheEntry>{};
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return Result<std::optional<FusionCacheEntry>>::failure(
            Error::parse_error("cannot open cache file: " + path.string())
        );
    }
    std::string body((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    try {
        const auto j = nlohmann::json::parse(body);
        auto entry = FusionCacheEntry::from_json(j);
        if (!entry) return Result<std::optional<FusionCacheEntry>>::failure(entry.error());
        if (entry.value().key != key && !entry.value().key.empty()) {
            // allow key mismatch only if empty stored key
        }
        entry.value().key = key;
        return std::optional<FusionCacheEntry>{std::move(entry.value())};
    } catch (const std::exception& ex) {
        ++stats_.corrupt_rejects;
        return Result<std::optional<FusionCacheEntry>>::failure(
            Error::parse_error(std::string("corrupt cache json: ") + ex.what())
        );
    }
}

Result<void> FusionCache::disk_write(const FusionCacheEntry& entry) {
    auto ok = ensure_cache_dir();
    if (!ok) return ok;
    const auto path = disk_path_for_key(entry.key);
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    if (ec) {
        return Result<void>::failure(Error::provider_failed("failed to create cache shard dir: " + ec.message()));
    }
    const auto tmp = path.string() + ".tmp";
    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out) {
            return Result<void>::failure(Error::provider_failed("cannot write cache tmp: " + tmp));
        }
        out << entry.to_json().dump(2);
        if (!out.good()) {
            return Result<void>::failure(Error::provider_failed("failed writing cache tmp: " + tmp));
        }
    }
    std::filesystem::rename(tmp, path, ec);
    if (ec) {
        // Windows may need remove-first
        std::filesystem::remove(path, ec);
        std::filesystem::rename(tmp, path, ec);
        if (ec) {
            return Result<void>::failure(Error::provider_failed("failed to rename cache file: " + ec.message()));
        }
    }
    return Result<void>::success();
}

Result<void> FusionCache::disk_remove(const std::string& key) {
    const auto path = disk_path_for_key(key);
    std::error_code ec;
    std::filesystem::remove(path, ec);
    // ignore missing
    return Result<void>::success();
}

Result<void> FusionCache::clear_disk() {
    if (config_.cache_dir.empty()) {
        return Result<void>::success();
    }
    std::error_code ec;
    if (std::filesystem::exists(config_.cache_dir)) {
        std::filesystem::remove_all(config_.cache_dir, ec);
        if (ec) {
            return Result<void>::failure(Error::provider_failed("clear_disk failed: " + ec.message()));
        }
    }
    return Result<void>::success();
}

Result<void> FusionCache::clear_all() {
    clear_memory();
    return clear_disk();
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
