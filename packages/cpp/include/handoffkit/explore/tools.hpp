#pragma once

#include <handoffkit/explore/explorer.hpp>
#include <handoffkit/runtime/tool.hpp>

#include <memory>

namespace handoffkit {
namespace explore {

/// Agent tools over the same explorer core (policy args from JSON).

/// web_fetch: { "url": "...", "policy": { ... optional ... }, "transport": "map"|"http" }
/// Returns snake_case JSON including a markdown field for agent prompts.
[[nodiscard]] Tool make_web_fetch_tool(TransportPtr default_transport = nullptr);

/// web_explore: { "url": "...", "policy": { max_depth, max_pages, allow_hosts, deny_hosts, ... } }
[[nodiscard]] Tool make_web_explore_tool(TransportPtr default_transport = nullptr);

/// html_to_markdown: { "html": "...", "url"?: "...", "max_chars"?: N }
/// Pure conversion (no network). Also accepts { "url": "..." } with transport to fetch then convert.
[[nodiscard]] Tool make_html_to_markdown_tool(TransportPtr default_transport = nullptr);

/// web_fetch_markdown: fetch URL and return primarily markdown for agent context
/// { "url": "...", "transport"?: "map"|"http", "policy"?: {...} }
[[nodiscard]] Tool make_web_fetch_markdown_tool(TransportPtr default_transport = nullptr);

/// Register web_fetch, web_explore, html_to_markdown, web_fetch_markdown.
void register_web_explorer_tools(ToolRegistry& registry, TransportPtr default_transport = nullptr);

/// Parse ExplorePolicy from tool args object (optional nested "policy" or flat keys).
[[nodiscard]] ExplorePolicy policy_from_tool_args(const nlohmann::json& args);

}  // namespace explore
}  // namespace handoffkit
