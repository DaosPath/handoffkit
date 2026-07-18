#include <handoffkit/explore/web_types.hpp>

#include <algorithm>
#include <cctype>
#include <sstream>

namespace handoffkit {
namespace explore {
namespace {

std::string lower_ascii(std::string s) {
    for (char& c : s) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return s;
}

bool host_matches(std::string_view host, std::string_view pattern) {
    // Exact or suffix match: pattern "example.com" matches "www.example.com"
    if (pattern.empty()) return false;
    const std::string h = lower_ascii(std::string(host));
    const std::string p = lower_ascii(std::string(pattern));
    if (h == p) return true;
    if (h.size() > p.size() && h[h.size() - p.size() - 1] == '.' &&
        h.compare(h.size() - p.size(), p.size(), p) == 0) {
        return true;
    }
    return false;
}

}  // namespace

std::string normalize_host(std::string_view host) {
    std::string h = lower_ascii(std::string(host));
    while (!h.empty() && h.back() == '.') h.pop_back();
    // strip userinfo if present (rare in host field)
    auto at = h.find('@');
    if (at != std::string::npos) h = h.substr(at + 1);
    // strip port
    auto colon = h.find(':');
    if (colon != std::string::npos) h = h.substr(0, colon);
    return h;
}

UrlParts parse_url(std::string_view url) {
    UrlParts p;
    if (url.empty()) return p;
    std::string s(url);
    // scheme
    auto scheme_end = s.find("://");
    std::size_t host_start = 0;
    if (scheme_end != std::string::npos) {
        p.scheme = lower_ascii(s.substr(0, scheme_end));
        host_start = scheme_end + 3;
    } else if (!s.empty() && s[0] == '/') {
        // path-only relative
        p.path = s;
        p.valid = true;
        return p;
    } else {
        // treat as host/path without scheme
        p.scheme = "https";
    }
    if (host_start >= s.size()) return p;
    auto path_pos = s.find('/', host_start);
    auto query_pos = s.find('?', host_start);
    std::size_t host_end = s.size();
    if (path_pos != std::string::npos) host_end = std::min(host_end, path_pos);
    if (query_pos != std::string::npos) host_end = std::min(host_end, query_pos);
    p.host = normalize_host(s.substr(host_start, host_end - host_start));
    if (path_pos != std::string::npos) {
        if (query_pos != std::string::npos && query_pos > path_pos) {
            p.path = s.substr(path_pos, query_pos - path_pos);
            p.query = s.substr(query_pos + 1);
        } else {
            p.path = s.substr(path_pos);
        }
    } else if (query_pos != std::string::npos) {
        p.path = "/";
        p.query = s.substr(query_pos + 1);
    } else {
        p.path = "/";
    }
    p.valid = !p.host.empty() || (p.scheme.empty() && !p.path.empty());
    if (!p.host.empty() && p.scheme.empty()) p.scheme = "https";
    if (!p.host.empty()) p.valid = true;
    return p;
}

std::string resolve_url(std::string_view base, std::string_view href) {
    if (href.empty()) return {};
    std::string h(href);
    // trim
    while (!h.empty() && (h.front() == ' ' || h.front() == '\t')) h.erase(h.begin());
    while (!h.empty() && (h.back() == ' ' || h.back() == '\t')) h.pop_back();
    if (h.empty() || h[0] == '#' || h.rfind("javascript:", 0) == 0 || h.rfind("mailto:", 0) == 0 ||
        h.rfind("data:", 0) == 0) {
        return {};
    }
    if (h.find("://") != std::string::npos) return h;
    if (h.rfind("//", 0) == 0) {
        auto bp = parse_url(base);
        return (bp.scheme.empty() ? "https" : bp.scheme) + ":" + h;
    }
    auto bp = parse_url(base);
    if (!bp.valid || bp.host.empty()) {
        // cannot resolve without base host
        return h;
    }
    std::string scheme = bp.scheme.empty() ? "https" : bp.scheme;
    std::string origin = scheme + "://" + bp.host;
    if (h[0] == '/') {
        return origin + h;
    }
    // relative to base path directory
    std::string dir = bp.path.empty() ? "/" : bp.path;
    auto slash = dir.find_last_of('/');
    if (slash == std::string::npos) {
        dir = "/";
    } else {
        dir = dir.substr(0, slash + 1);
    }
    return origin + dir + h;
}

bool host_allowed(std::string_view host, const ExplorePolicy& policy) {
    const std::string h = normalize_host(host);
    if (h.empty()) return false;
    for (const auto& d : policy.deny_hosts) {
        if (host_matches(h, d)) return false;
    }
    if (policy.allow_hosts.empty()) return true;
    for (const auto& a : policy.allow_hosts) {
        if (host_matches(h, a)) return true;
    }
    return false;
}

bool url_allowed(std::string_view url, const ExplorePolicy& policy, std::string_view origin_host) {
    auto parts = parse_url(url);
    if (!parts.valid || parts.host.empty()) return false;
    if (policy.same_host_only && !origin_host.empty()) {
        if (normalize_host(parts.host) != normalize_host(origin_host)) return false;
    }
    return host_allowed(parts.host, policy);
}

nlohmann::json ExplorePolicy::to_json() const {
    nlohmann::json headers = nlohmann::json::object();
    for (const auto& [k, v] : extra_headers) headers[k] = v;
    return nlohmann::json{
        {"max_depth", max_depth},
        {"max_pages", max_pages},
        {"timeout_ms", timeout_ms},
        {"max_body_bytes", max_body_bytes},
        {"max_text_chars", max_text_chars},
        {"max_links_per_page", max_links_per_page},
        {"same_host_only", same_host_only},
        {"follow_redirects", follow_redirects},
        {"max_redirects", max_redirects},
        {"user_agent", user_agent},
        {"allow_hosts", allow_hosts},
        {"deny_hosts", deny_hosts},
        {"extra_headers", headers},
        {"extract_text", extract_text},
        {"extract_links", extract_links},
        {"extract_title", extract_title},
        {"strip_scripts_styles", strip_scripts_styles},
        {"emit_markdown", emit_markdown},
        {"max_markdown_chars", max_markdown_chars},
    };
}

Result<ExplorePolicy> ExplorePolicy::from_json(const nlohmann::json& j) {
    if (!j.is_object()) return Error::parse_error("policy must be object", "policy");
    ExplorePolicy p;
    if (j.contains("max_depth")) p.max_depth = j.at("max_depth").get<int>();
    if (j.contains("max_pages")) p.max_pages = j.at("max_pages").get<int>();
    if (j.contains("timeout_ms")) p.timeout_ms = j.at("timeout_ms").get<int>();
    if (j.contains("max_body_bytes")) p.max_body_bytes = j.at("max_body_bytes").get<int>();
    if (j.contains("max_text_chars")) p.max_text_chars = j.at("max_text_chars").get<int>();
    if (j.contains("max_links_per_page")) p.max_links_per_page = j.at("max_links_per_page").get<int>();
    if (j.contains("same_host_only")) p.same_host_only = j.at("same_host_only").get<bool>();
    if (j.contains("follow_redirects")) p.follow_redirects = j.at("follow_redirects").get<bool>();
    if (j.contains("max_redirects")) p.max_redirects = j.at("max_redirects").get<int>();
    if (j.contains("user_agent")) p.user_agent = j.at("user_agent").get<std::string>();
    if (j.contains("allow_hosts") && j.at("allow_hosts").is_array()) {
        p.allow_hosts = j.at("allow_hosts").get<std::vector<std::string>>();
    }
    if (j.contains("deny_hosts") && j.at("deny_hosts").is_array()) {
        p.deny_hosts = j.at("deny_hosts").get<std::vector<std::string>>();
    }
    if (j.contains("extra_headers") && j.at("extra_headers").is_object()) {
        for (auto it = j.at("extra_headers").begin(); it != j.at("extra_headers").end(); ++it) {
            if (it.value().is_string()) p.extra_headers[it.key()] = it.value().get<std::string>();
        }
    }
    if (j.contains("extract_text")) p.extract_text = j.at("extract_text").get<bool>();
    if (j.contains("extract_links")) p.extract_links = j.at("extract_links").get<bool>();
    if (j.contains("extract_title")) p.extract_title = j.at("extract_title").get<bool>();
    if (j.contains("strip_scripts_styles")) p.strip_scripts_styles = j.at("strip_scripts_styles").get<bool>();
    if (j.contains("emit_markdown")) p.emit_markdown = j.at("emit_markdown").get<bool>();
    if (j.contains("max_markdown_chars")) p.max_markdown_chars = j.at("max_markdown_chars").get<int>();
    if (p.max_depth < 0) return Error::invalid_argument("max_depth must be >= 0", "max_depth");
    if (p.max_pages < 1) return Error::invalid_argument("max_pages must be >= 1", "max_pages");
    if (p.timeout_ms < 1) return Error::invalid_argument("timeout_ms must be >= 1", "timeout_ms");
    return p;
}

nlohmann::json TransportResponse::to_json() const {
    nlohmann::json headers = nlohmann::json::object();
    for (const auto& [k, v] : this->headers) headers[k] = v;
    return nlohmann::json{
        {"status", status},
        {"final_url", final_url},
        {"content_type", content_type},
        {"body_chars", body.size()},
        {"headers", headers},
        {"error", error},
        {"ok", ok()},
    };
}

nlohmann::json ExtractedLink::to_json() const {
    return nlohmann::json{{"href", href}, {"absolute", absolute}, {"text", text}};
}

nlohmann::json PageExtract::to_json() const {
    nlohmann::json ls = nlohmann::json::array();
    for (const auto& l : links) ls.push_back(l.to_json());
    return nlohmann::json{
        {"url", url},
        {"title", title},
        {"text", text},
        {"markdown", markdown},
        {"links", std::move(ls)},
        {"raw_body_bytes", raw_body_bytes},
    };
}

nlohmann::json ExploreStep::to_json() const {
    nlohmann::json ls = nlohmann::json::array();
    for (const auto& l : links) ls.push_back(l.to_json());
    return nlohmann::json{
        {"step_index", step_index},
        {"depth", depth},
        {"url", url},
        {"final_url", final_url},
        {"status", status},
        {"success", success},
        {"error", error},
        {"title", title},
        {"text", text},
        {"markdown", markdown},
        {"links", std::move(ls)},
        {"raw_body_bytes", raw_body_bytes},
        {"blocked_links", blocked_links},
    };
}

nlohmann::json ExploreResult::to_json() const {
    nlohmann::json steps_j = nlohmann::json::array();
    for (const auto& s : steps) steps_j.push_back(s.to_json());
    nlohmann::json ls = nlohmann::json::array();
    for (const auto& l : links) ls.push_back(l.to_json());
    return nlohmann::json{
        {"success", success},
        {"start_url", start_url},
        {"final_url", final_url},
        {"pages_fetched", pages_fetched},
        {"max_depth_reached", max_depth_reached},
        {"title", title},
        {"text", text},
        {"markdown", markdown},
        {"links", std::move(ls)},
        {"steps", std::move(steps_j)},
        {"policy", policy.to_json()},
        {"error", error},
        {"metadata", metadata},
    };
}

}  // namespace explore
}  // namespace handoffkit
