#include <handoffkit/browser/cache.hpp>
#include <handoffkit/browser/util.hpp>

#include <fstream>
#include <sstream>

#if defined(_WIN32)
#include <stdlib.h>
#else
#include <cstdlib>
#endif

namespace handoffkit {
namespace browser {
namespace {

std::string sha256_lite(std::string_view s) {
    // Not cryptographic — stable short key for cache filenames.
    std::uint64_t h = 14695981039346656037ull;
    for (unsigned char c : s) {
        h ^= c;
        h *= 1099511628211ull;
    }
    std::ostringstream ss;
    ss << std::hex << h;
    return ss.str();
}

}  // namespace

BrowserCache::BrowserCache(std::filesystem::path root, std::chrono::milliseconds ttl)
    : root_(std::move(root)), ttl_(ttl) {}

std::filesystem::path BrowserCache::path_for(std::string_view url) const {
    return root_ / (sha256_lite(canonical_url(url)) + ".json");
}

std::optional<nlohmann::json> BrowserCache::get(std::string_view url) const {
    if (!enabled()) return std::nullopt;
    const auto path = path_for(url);
    std::ifstream in(path);
    if (!in) return std::nullopt;
    try {
        nlohmann::json j;
        in >> j;
        const auto saved = j.value("saved_at", 0LL);
        const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::system_clock::now().time_since_epoch())
                             .count();
        if (ttl_.count() > 0 && now - saved > ttl_.count()) return std::nullopt;
        return j;
    } catch (...) {
        return std::nullopt;
    }
}

bool BrowserCache::set(std::string_view url, const nlohmann::json& payload) const {
    if (!enabled()) return false;
    std::error_code ec;
    std::filesystem::create_directories(root_, ec);
    nlohmann::json body = payload;
    body["url"] = canonical_url(url);
    body["saved_at"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                           std::chrono::system_clock::now().time_since_epoch())
                           .count();
    std::ofstream out(path_for(url));
    if (!out) return false;
    out << body.dump();
    return true;
}

std::filesystem::path default_cache_root() {
    return std::filesystem::current_path() / ".cache" / "handoffkit-browser";
}

}  // namespace browser
}  // namespace handoffkit
