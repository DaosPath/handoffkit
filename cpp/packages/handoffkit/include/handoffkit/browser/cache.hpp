#pragma once

#include <nlohmann/json.hpp>

#include <chrono>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace handoffkit {
namespace browser {

/// Optional on-disk cache for fetched page markdown (parity with JS BrowserCache).
class BrowserCache {
public:
    explicit BrowserCache(std::filesystem::path root = {},
                          std::chrono::milliseconds ttl = std::chrono::hours(24));

    [[nodiscard]] bool enabled() const { return !root_.empty(); }
    [[nodiscard]] std::optional<nlohmann::json> get(std::string_view url) const;
    bool set(std::string_view url, const nlohmann::json& payload) const;

private:
    std::filesystem::path root_;
    std::chrono::milliseconds ttl_;
    [[nodiscard]] std::filesystem::path path_for(std::string_view url) const;
};

[[nodiscard]] std::filesystem::path default_cache_root();

}  // namespace browser
}  // namespace handoffkit
