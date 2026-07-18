#pragma once

#include <handoffkit/explore/web_types.hpp>

#include <functional>
#include <memory>
#include <string>
#include <unordered_map>

namespace handoffkit {
namespace explore {

/// Injectable network/page transport. Forks can implement custom backends.
class WebTransport {
public:
    virtual ~WebTransport() = default;
    [[nodiscard]] virtual TransportResponse get(const TransportRequest& request) = 0;
    [[nodiscard]] virtual std::string name() const = 0;
};

using TransportPtr = std::shared_ptr<WebTransport>;

/// In-memory map of URL → body (optional status/content_type). Deterministic offline path.
class MapTransport : public WebTransport {
public:
    struct Entry {
        std::string body;
        int status = 200;
        std::string content_type{"text/html; charset=utf-8"};
        std::string final_url;  // empty = request url
        std::string error;      // if set, returns transport error
    };

    MapTransport() = default;
    explicit MapTransport(std::unordered_map<std::string, Entry> pages);

    void set_page(std::string url, std::string body, int status = 200,
                  std::string content_type = "text/html; charset=utf-8");
    void set_error(std::string url, std::string error_message);
    void clear();

    [[nodiscard]] TransportResponse get(const TransportRequest& request) override;
    [[nodiscard]] std::string name() const override { return "map"; }

    [[nodiscard]] const std::unordered_map<std::string, Entry>& pages() const { return pages_; }

private:
    std::unordered_map<std::string, Entry> pages_;
};

/// Live HTTP transport (cpp-httplib) when HANDOFFKIT_WITH_HTTP=ON; otherwise always errors.
class HttpTransport : public WebTransport {
public:
    HttpTransport() = default;
    [[nodiscard]] TransportResponse get(const TransportRequest& request) override;
    [[nodiscard]] std::string name() const override { return "http"; }
};

/// Build transport from name: "map" | "http" | "stub" (alias of map).
[[nodiscard]] TransportPtr make_transport(std::string_view kind);
/// Default: map if offline preferred, else http when built with HTTP.
[[nodiscard]] TransportPtr default_transport(bool prefer_live = false);

/// Built-in offline multi-page HTML graph for demos/tests (no network).
/// Roots: https://fixture.local/ and https://fixture.local/index.html
[[nodiscard]] std::shared_ptr<MapTransport> make_fixture_map_transport();

}  // namespace explore
}  // namespace handoffkit
