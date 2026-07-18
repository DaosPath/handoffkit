#pragma once

// Native web explorer types (first-party). Wire JSON uses snake_case.
// Policy + injectable WebTransport control fetch/explore behavior.

#include <handoffkit/error.hpp>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

namespace handoffkit {
namespace explore {

/// Caller-owned policy: budgets, host filters, headers, UA, timeouts.
struct ExplorePolicy {
    int max_depth = 1;                 // 0 = start page only; 1 = start + one hop
    int max_pages = 8;                 // hard cap on successful page fetches
    int timeout_ms = 15000;
    int max_body_bytes = 2 * 1024 * 1024;
    int max_text_chars = 50000;        // extracted text budget in results
    int max_links_per_page = 100;
    bool same_host_only = true;
    bool follow_redirects = true;
    int max_redirects = 5;
    std::string user_agent{"HandoffKit-WebExplorer/1.0"};
    std::vector<std::string> allow_hosts;   // empty = no allowlist restriction
    std::vector<std::string> deny_hosts;    // always blocked if match
    std::unordered_map<std::string, std::string> extra_headers;
    bool extract_text = true;
    bool extract_links = true;
    bool extract_title = true;
    bool strip_scripts_styles = true;
    bool emit_markdown = true;         // HTML → Markdown for agent prompt context
    int max_markdown_chars = 60000;    // budget for markdown field

    nlohmann::json to_json() const;
    static Result<ExplorePolicy> from_json(const nlohmann::json& j);
};

/// Low-level transport response (injectable; no network required for tests).
struct TransportResponse {
    int status = 0;
    std::string final_url;
    std::string content_type;
    std::string body;
    std::unordered_map<std::string, std::string> headers;
    std::string error;  // non-empty => transport failure (no HTTP response)

    [[nodiscard]] bool ok() const noexcept {
        return error.empty() && status >= 200 && status < 400;
    }

    nlohmann::json to_json() const;
};

struct TransportRequest {
    std::string url;
    std::string method{"GET"};
    std::unordered_map<std::string, std::string> headers;
    int timeout_ms = 15000;
    int max_body_bytes = 2 * 1024 * 1024;
    bool follow_redirects = true;
    int max_redirects = 5;
};

struct ExtractedLink {
    std::string href;       // as found (may be relative)
    std::string absolute;   // resolved absolute URL when possible
    std::string text;

    nlohmann::json to_json() const;
};

struct PageExtract {
    std::string url;
    std::string title;
    std::string text;
    std::string markdown;  // compact Markdown excerpt for agent prompts
    std::vector<ExtractedLink> links;
    std::size_t raw_body_bytes = 0;

    nlohmann::json to_json() const;
};

struct ExploreStep {
    int step_index = 0;
    int depth = 0;
    std::string url;
    std::string final_url;
    int status = 0;
    bool success = false;
    std::string error;
    std::string title;
    std::string text;
    std::string markdown;
    std::vector<ExtractedLink> links;
    std::size_t raw_body_bytes = 0;
    std::vector<std::string> blocked_links;  // links skipped by policy

    nlohmann::json to_json() const;
};

struct ExploreResult {
    bool success = false;
    std::string start_url;
    std::string final_url;       // last successful final URL
    int pages_fetched = 0;
    int max_depth_reached = 0;
    std::string title;           // from first successful page
    std::string text;            // concatenated / primary extract
    std::string markdown;        // LLM-oriented Markdown (concat multi-page with ---)
    std::vector<ExtractedLink> links;
    std::vector<ExploreStep> steps;
    ExplorePolicy policy;
    std::string error;           // top-level failure if success=false and no steps
    nlohmann::json metadata = nlohmann::json::object();

    nlohmann::json to_json() const;
};

/// Normalize host for allow/deny matching (lowercase, strip trailing dot).
[[nodiscard]] std::string normalize_host(std::string_view host);

/// Parse scheme/host/path from URL (minimal; no network).
struct UrlParts {
    std::string scheme;
    std::string host;
    std::string path;
    std::string query;
    bool valid = false;
};

[[nodiscard]] UrlParts parse_url(std::string_view url);
[[nodiscard]] std::string resolve_url(std::string_view base, std::string_view href);
[[nodiscard]] bool host_allowed(std::string_view host, const ExplorePolicy& policy);
[[nodiscard]] bool url_allowed(std::string_view url, const ExplorePolicy& policy, std::string_view origin_host);

}  // namespace explore
}  // namespace handoffkit
