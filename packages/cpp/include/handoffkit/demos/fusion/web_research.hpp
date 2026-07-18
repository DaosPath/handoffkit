#pragma once

// Fusion pre-step: run native web explorer tools and inject page Markdown into prompts.

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/explore/transport.hpp>
#include <handoffkit/runtime/tool.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

/// Outcome of optional web research (fetch + html→md + optional search).
struct WebResearchResult {
    bool enabled = false;
    bool used = false;
    std::vector<std::string> queries;
    std::vector<std::string> urls_fetched;
    std::string markdown_context;  // ready to inject into prompts
    nlohmann::json steps = nlohmann::json::array();
    int pages_ok = 0;
    int tool_calls = 0;
    std::string error;
    std::string transport;

    [[nodiscard]] nlohmann::json to_json() const;
    /// Labeled section body for FrameOptions / prompts.
    [[nodiscard]] std::string prompt_section() const;
};

/// Extract http(s) URLs from free text (order-preserving, de-duped).
[[nodiscard]] std::vector<std::string> extract_urls_from_text(std::string_view text);

/// Compact search query from a long research task (first sentence / keywords).
[[nodiscard]] std::string make_search_query_from_task(std::string_view task, std::size_t max_chars = 140);

/// Build registry with web_fetch, web_explore, html_to_markdown, web_fetch_markdown, web_search.
[[nodiscard]] ToolRegistry make_fusion_web_tool_registry(explore::TransportPtr transport);

/// Run research using FusionConfig web_* flags (seed urls, auto search, transport).
[[nodiscard]] WebResearchResult gather_web_research(const FusionConfig& config);

/// Same as above with an injected transport (tests / fixtures).
[[nodiscard]] WebResearchResult gather_web_research(
    const FusionConfig& config,
    explore::TransportPtr transport
);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
