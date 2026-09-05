#pragma once

#include <handoffkit/browser/cache.hpp>
#include <handoffkit/browser/page.hpp>
#include <handoffkit/browser/transport.hpp>
#include <handoffkit/runtime/tool.hpp>

#include <nlohmann/json.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace browser {

/// SearXNG instance/option selection. Mirrors the JS `searxng` options object:
/// explicit values win, env (HANDOFFKIT_SEARXNG_URLS/URL/ENGINES) fills the
/// rest, unknown engines/categories fail closed. `safesearch = -1` means
/// unset (else 0..2); `page` starts at 1.
struct SearxngOptions {
    std::vector<std::string> base_urls;
    std::string base_url;
    std::vector<std::string> engines;
    std::vector<std::string> categories;
    int page = 1;
    int safesearch = -1;  // -1 = unset, else 0..2
    std::string language;
};

/// Parse a `searxng` JSON object (tool args / stored configs) into options.
/// Accepts arrays or comma-separated strings for lists; returns an error when
/// page/safesearch/language are explicitly invalid.
[[nodiscard]] Result<SearxngOptions> parse_searxng_options(const nlohmann::json& j);

struct WebResearchConfig {
    std::string query;
    std::string task;
    std::vector<std::string> seed_urls;
    bool auto_search = true;
    bool seed_only = false;
    int max_pages = 4;
    int max_depth = 0;
    int timeout_ms = 20000;
    int context_max_chars = 48000;
    bool prefer_explore = false;
    std::vector<std::string> allow_hosts;
    std::vector<std::string> deny_hosts;
    std::string format{"markdown"};
    int concurrency = 2;  // sequential in C++ v1; reserved
    int max_sub_queries = 3;
    int max_results_per_query = 8;
    std::vector<std::string> providers{"duckduckgo", "wikipedia", "searxng"};
    SearxngOptions searxng;
    BrowserCache* cache = nullptr;
};

struct WebResearchResult {
    bool enabled = true;
    bool used = false;
    std::vector<std::string> queries;
    std::vector<std::string> urls_fetched;
    std::string markdown_context;
    std::vector<PageMarkdown> pages;
    nlohmann::json citations = nlohmann::json::array();
    nlohmann::json steps = nlohmann::json::array();
    int pages_ok = 0;
    int tool_calls = 0;
    std::string error;
    std::string transport;
    std::string mode{"search_then_fetch"};
    nlohmann::json metadata = nlohmann::json::object();

    [[nodiscard]] nlohmann::json to_json() const;
    [[nodiscard]] std::string prompt_section() const;
};

[[nodiscard]] std::vector<std::string> extract_urls_from_text(std::string_view text);
[[nodiscard]] std::string make_search_query_from_task(std::string_view task, std::size_t max_chars = 140);
[[nodiscard]] std::string keyword_compress(std::string_view query, std::size_t max_words = 10);

/// Live search: Google/DuckDuckGo HTML, Wikipedia OpenSearch, SearXNG JSON
/// (options via SearxngOptions, tool `searxng` arg, or
/// HANDOFFKIT_SEARXNG_URL(S)/ENGINES env), key-gated Brave/Bing/Kagi
/// JSON, and keyless Mojeek/Marginalia/Startpage HTML. The explicit
/// user_browser provider is recognized for conformance but unavailable in C++
/// because this runtime has no host browser bridge.
[[nodiscard]] nlohmann::json web_search(std::string_view query, TransportPtr transport,
                                        int max_results = 8, int timeout_ms = 20000,
                                        const std::vector<std::string>& allow_hosts = {},
                                        const std::vector<std::string>& deny_hosts = {},
                                        const std::vector<std::string>& providers = {},
                                        const SearxngOptions& searxng = {});

[[nodiscard]] WebResearchResult gather_web_research(const WebResearchConfig& config,
                                                    TransportPtr transport = nullptr);

/// Bounded multi-query/multi-hop research over native HTTP or fixture transport.
/// This is background-only; C++ does not launch or control a user browser.
[[nodiscard]] WebResearchResult gather_deep_web_research(const WebResearchConfig& config,
                                                         TransportPtr transport = nullptr);

/// Deterministic bounded query expansion shared by deep research adapters.
[[nodiscard]] std::vector<std::string> make_research_queries(std::string_view query,
                                                              std::string_view task,
                                                              int max_sub_queries = 3);

[[nodiscard]] Tool make_web_search_tool(
    TransportPtr default_transport = nullptr,
    std::vector<std::string> default_providers = {});
[[nodiscard]] Tool make_web_research_tool(
    TransportPtr default_transport = nullptr,
    std::vector<std::string> default_providers = {});
[[nodiscard]] Tool make_deep_web_research_tool(
    TransportPtr default_transport = nullptr,
    std::vector<std::string> default_providers = {});

}  // namespace browser
}  // namespace handoffkit
