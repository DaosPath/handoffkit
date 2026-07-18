#include <handoffkit/demos/fusion/cache_index.hpp>
#include <handoffkit/demos/fusion/hash.hpp>

#include <algorithm>
#include <fstream>

namespace handoffkit {
namespace demos {
namespace fusion {

nlohmann::json CacheIndexEntry::to_json() const {
    return nlohmann::json{
        {"key", key},
        {"relative_path", relative_path},
        {"bytes", bytes},
        {"mtime_unix_ms", mtime_unix_ms},
        {"checksum", checksum},
    };
}

Result<CacheIndexEntry> CacheIndexEntry::from_json(const nlohmann::json& j) {
    if (!j.is_object()) return Result<CacheIndexEntry>::failure(Error::parse_error("index entry not object"));
    CacheIndexEntry e;
    e.key = j.value("key", "");
    e.relative_path = j.value("relative_path", "");
    e.bytes = j.value("bytes", static_cast<std::size_t>(0));
    e.mtime_unix_ms = j.value("mtime_unix_ms", static_cast<std::int64_t>(0));
    e.checksum = j.value("checksum", "");
    if (e.key.empty()) return Result<CacheIndexEntry>::failure(Error::parse_error("index entry missing key"));
    return e;
}

FusionCacheIndex::FusionCacheIndex(std::filesystem::path cache_dir) : cache_dir_(std::move(cache_dir)) {}

std::filesystem::path FusionCacheIndex::index_path() const {
    return cache_dir_ / "index.json";
}

Result<void> FusionCacheIndex::load() {
    const auto path = index_path();
    if (!std::filesystem::exists(path)) {
        entries_.clear();
        return Result<void>::success();
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) return Result<void>::failure(Error::parse_error("cannot open index: " + path.string()));
    std::string body((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    try {
        const auto j = nlohmann::json::parse(body);
        if (!j.is_object() || !j.contains("entries") || !j.at("entries").is_array()) {
            return Result<void>::failure(Error::parse_error("index.json missing entries array"));
        }
        entries_.clear();
        for (const auto& item : j.at("entries")) {
            auto e = CacheIndexEntry::from_json(item);
            if (!e) return Result<void>::failure(e.error());
            entries_.push_back(std::move(e.value()));
        }
        return Result<void>::success();
    } catch (const std::exception& ex) {
        return Result<void>::failure(Error::parse_error(std::string("index parse: ") + ex.what()));
    }
}

Result<void> FusionCacheIndex::save() const {
    std::error_code ec;
    std::filesystem::create_directories(cache_dir_, ec);
    if (ec) return Result<void>::failure(Error::provider_failed(ec.message()));
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& e : entries_) arr.push_back(e.to_json());
    nlohmann::json root{{"version", 1}, {"entries", std::move(arr)}, {"total_bytes", total_bytes()}};
    const auto path = index_path();
    const auto tmp = path.string() + ".tmp";
    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out) return Result<void>::failure(Error::provider_failed("cannot write index tmp"));
        out << root.dump(2);
    }
    std::filesystem::rename(tmp, path, ec);
    if (ec) {
        std::filesystem::remove(path, ec);
        std::filesystem::rename(tmp, path, ec);
        if (ec) return Result<void>::failure(Error::provider_failed("rename index failed: " + ec.message()));
    }
    return Result<void>::success();
}

Result<std::vector<std::filesystem::path>> list_cache_shard_files(const std::filesystem::path& cache_dir) {
    std::vector<std::filesystem::path> out;
    std::error_code ec;
    if (!std::filesystem::exists(cache_dir)) return out;
    for (std::filesystem::recursive_directory_iterator it(cache_dir, ec), end; it != end; it.increment(ec)) {
        if (ec) break;
        if (!it->is_regular_file()) continue;
        if (it->path().extension() == ".json" && it->path().filename() != "index.json") {
            out.push_back(it->path());
        }
    }
    return out;
}

Result<void> FusionCacheIndex::rebuild_from_disk() {
    entries_.clear();
    auto files = list_cache_shard_files(cache_dir_);
    if (!files) return Result<void>::failure(files.error());
    for (const auto& path : files.value()) {
        std::ifstream in(path, std::ios::binary);
        if (!in) continue;
        std::string body((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        try {
            const auto j = nlohmann::json::parse(body);
            CacheIndexEntry e;
            e.key = j.value("key", path.stem().string());
            e.relative_path = std::filesystem::relative(path, cache_dir_).generic_string();
            e.bytes = body.size();
            e.checksum = j.value("checksum", fusion_content_hash(j.value("value", "")));
            e.mtime_unix_ms = j.value("created_unix_ms", fusion_now_unix_ms());
            entries_.push_back(std::move(e));
        } catch (...) {
            // skip corrupt
        }
    }
    return save();
}

void FusionCacheIndex::upsert(CacheIndexEntry entry) {
    for (auto& e : entries_) {
        if (e.key == entry.key) {
            e = std::move(entry);
            return;
        }
    }
    entries_.push_back(std::move(entry));
}

bool FusionCacheIndex::erase(const std::string& key) {
    const auto before = entries_.size();
    entries_.erase(
        std::remove_if(entries_.begin(), entries_.end(), [&](const CacheIndexEntry& e) { return e.key == key; }),
        entries_.end()
    );
    return entries_.size() != before;
}

const CacheIndexEntry* FusionCacheIndex::find(const std::string& key) const {
    for (const auto& e : entries_) {
        if (e.key == key) return &e;
    }
    return nullptr;
}

std::vector<CacheIndexEntry> FusionCacheIndex::list() const { return entries_; }

std::size_t FusionCacheIndex::total_bytes() const {
    std::size_t n = 0;
    for (const auto& e : entries_) n += e.bytes;
    return n;
}

Result<int> FusionCacheIndex::prune_missing() {
    int removed = 0;
    std::vector<CacheIndexEntry> kept;
    kept.reserve(entries_.size());
    for (const auto& e : entries_) {
        const auto path = cache_dir_ / e.relative_path;
        if (!std::filesystem::exists(path)) {
            ++removed;
            continue;
        }
        kept.push_back(e);
    }
    entries_ = std::move(kept);
    auto s = save();
    if (!s) return Result<int>::failure(s.error());
    return removed;
}

Result<int> FusionCacheIndex::compact_to(std::size_t max_entries) {
    if (max_entries == 0) {
        int n = static_cast<int>(entries_.size());
        entries_.clear();
        auto s = save();
        if (!s) return Result<int>::failure(s.error());
        return n;
    }
    if (entries_.size() <= max_entries) return 0;
    std::sort(entries_.begin(), entries_.end(), [](const CacheIndexEntry& a, const CacheIndexEntry& b) {
        return a.mtime_unix_ms > b.mtime_unix_ms;
    });
    const int removed = static_cast<int>(entries_.size() - max_entries);
    // delete files for dropped tail
    for (std::size_t i = max_entries; i < entries_.size(); ++i) {
        std::error_code ec;
        std::filesystem::remove(cache_dir_ / entries_[i].relative_path, ec);
    }
    entries_.resize(max_entries);
    auto s = save();
    if (!s) return Result<int>::failure(s.error());
    return removed;
}

nlohmann::json FusionCacheIndex::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& e : entries_) arr.push_back(e.to_json());
    return nlohmann::json{
        {"cache_dir", cache_dir_.string()},
        {"entries", std::move(arr)},
        {"total_bytes", total_bytes()},
    };
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
