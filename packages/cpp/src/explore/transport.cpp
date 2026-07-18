#include <handoffkit/explore/transport.hpp>

#include <algorithm>

#if defined(HANDOFFKIT_WITH_HTTP)
#include <httplib.h>
#endif

namespace handoffkit {
namespace explore {

MapTransport::MapTransport(std::unordered_map<std::string, Entry> pages) : pages_(std::move(pages)) {}

void MapTransport::set_page(std::string url, std::string body, int status, std::string content_type) {
    Entry e;
    e.body = std::move(body);
    e.status = status;
    e.content_type = std::move(content_type);
    pages_[std::move(url)] = std::move(e);
}

void MapTransport::set_error(std::string url, std::string error_message) {
    Entry e;
    e.error = std::move(error_message);
    e.status = 0;
    pages_[std::move(url)] = std::move(e);
}

void MapTransport::clear() { pages_.clear(); }

TransportResponse MapTransport::get(const TransportRequest& request) {
    TransportResponse r;
    r.final_url = request.url;
    auto it = pages_.find(request.url);
    if (it == pages_.end()) {
        // try without trailing slash / with trailing slash
        std::string alt = request.url;
        if (!alt.empty() && alt.back() == '/') {
            alt.pop_back();
        } else {
            alt.push_back('/');
        }
        it = pages_.find(alt);
    }
    if (it == pages_.end()) {
        r.status = 404;
        r.error = "map transport: url not found: " + request.url;
        return r;
    }
    const Entry& e = it->second;
    if (!e.error.empty()) {
        r.error = e.error;
        r.status = 0;
        return r;
    }
    r.status = e.status;
    r.content_type = e.content_type;
    r.final_url = e.final_url.empty() ? request.url : e.final_url;
    r.body = e.body;
    if (request.max_body_bytes > 0 && static_cast<int>(r.body.size()) > request.max_body_bytes) {
        r.body.resize(static_cast<std::size_t>(request.max_body_bytes));
    }
    return r;
}

TransportResponse HttpTransport::get(const TransportRequest& request) {
    TransportResponse r;
    r.final_url = request.url;
#if !defined(HANDOFFKIT_WITH_HTTP)
    r.error = "HttpTransport requires HANDOFFKIT_WITH_HTTP=ON at build time";
    r.status = 0;
    return r;
#else
    auto parts = parse_url(request.url);
    if (!parts.valid || parts.host.empty()) {
        r.error = "invalid url";
        return r;
    }
    const std::string scheme = parts.scheme.empty() ? "https" : parts.scheme;
    const std::string host = parts.host;
    std::string path = parts.path.empty() ? "/" : parts.path;
    if (!parts.query.empty()) path += "?" + parts.query;

    try {
        httplib::Client client(scheme + "://" + host);
        const int sec = std::max(1, request.timeout_ms / 1000);
        client.set_connection_timeout(sec, 0);
        client.set_read_timeout(sec, 0);
        client.set_follow_location(request.follow_redirects);
        if (request.follow_redirects) {
            // cpp-httplib uses set_follow_location; max redirects not always configurable
            (void)request.max_redirects;
        }
        httplib::Headers headers;
        for (const auto& [k, v] : request.headers) {
            headers.emplace(k, v);
        }
        auto res = client.Get(path, headers);
        if (!res) {
            r.error = "HTTP request failed to " + request.url;
            r.status = 0;
            return r;
        }
        r.status = res->status;
        r.body = res->body;
        if (request.max_body_bytes > 0 && static_cast<int>(r.body.size()) > request.max_body_bytes) {
            r.body.resize(static_cast<std::size_t>(request.max_body_bytes));
        }
        if (res->has_header("Content-Type")) {
            r.content_type = res->get_header_value("Content-Type");
        }
        // final URL: if Location followed, httplib may not expose; use request url
        r.final_url = request.url;
        for (const auto& h : res->headers) {
            r.headers[h.first] = h.second;
        }
        return r;
    } catch (const std::exception& ex) {
        r.error = std::string("HttpTransport exception: ") + ex.what();
        r.status = 0;
        return r;
    }
#endif
}

TransportPtr make_transport(std::string_view kind) {
    std::string k(kind);
    for (char& c : k) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    if (k.empty() || k == "map" || k == "stub" || k == "offline" || k == "fixture") {
        return std::make_shared<MapTransport>();
    }
    if (k == "http" || k == "live" || k == "https") {
        return std::make_shared<HttpTransport>();
    }
    return std::make_shared<MapTransport>();
}

TransportPtr default_transport(bool prefer_live) {
#if defined(HANDOFFKIT_WITH_HTTP)
    if (prefer_live) return std::make_shared<HttpTransport>();
#else
    (void)prefer_live;
#endif
    return std::make_shared<MapTransport>();
}

std::shared_ptr<MapTransport> make_fixture_map_transport() {
    auto map = std::make_shared<MapTransport>();
    const std::string index = R"HTML(<!DOCTYPE html>
<html><head><title>Fixture Home</title></head>
<body>
<h1>Welcome to Fixture</h1>
<p>Home page for offline web explorer tests. Alpha &amp; beta notes.</p>
<script>secret_should_not_appear();</script>
<a href="/about.html">About Us</a>
<a href="/docs/guide.html">Guide</a>
<a href="https://evil.example/block-me">External Evil</a>
</body></html>)HTML";
    const std::string about = R"HTML(<html><head><title>About Fixture</title></head>
<body><p>About page content with more detail.</p>
<a href="/">Home</a>
<a href="/docs/guide.html">Guide</a>
</body></html>)HTML";
    const std::string guide = R"HTML(<html><head><title>Guide</title></head>
<body><h2>User Guide</h2><p>Step one: configure ExplorePolicy. Step two: inject WebTransport.</p>
<a href="/">Home</a>
</body></html>)HTML";
    map->set_page("https://fixture.local/", index);
    map->set_page("https://fixture.local/index.html", index);
    map->set_page("https://fixture.local/about.html", about);
    map->set_page("https://fixture.local/docs/guide.html", guide);
    map->set_page("https://fixture.local/missing.html", "", 404);
    map->set_error("https://fixture.local/boom", "simulated transport failure");
    return map;
}

}  // namespace explore
}  // namespace handoffkit
