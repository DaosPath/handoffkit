#pragma once

#include <handoffkit/explore/web_types.hpp>

#include <string>
#include <string_view>

namespace handoffkit {
namespace explore {

/// First-party HTML extraction (no external browser / DOM engine).
/// Good enough for titles, anchors, and readable text; not a full HTML5 parser.

struct HtmlToMarkdownOptions {
    std::string base_url;           // resolve relative links
    bool strip_scripts_styles = true;
    int max_chars = 60000;
    bool include_source_header = true;  // leading # title + source_url note
    bool include_links_section = true;  // trailing ## Links list
    int max_links = 100;
};

[[nodiscard]] std::string extract_title(std::string_view html);
[[nodiscard]] std::string extract_text(std::string_view html, bool strip_scripts_styles = true,
                                       int max_chars = 50000);
[[nodiscard]] std::vector<ExtractedLink> extract_links(std::string_view html, std::string_view base_url,
                                                       int max_links = 100);

/// Convert HTML page body to compact Markdown (not a full browser MD engine).
[[nodiscard]] std::string html_to_markdown(std::string_view html, const HtmlToMarkdownOptions& opts = {});

/// Convenience: title + body MD + optional source URL line.
[[nodiscard]] std::string page_html_to_markdown(std::string_view url, std::string_view html,
                                                const ExplorePolicy& policy);

[[nodiscard]] PageExtract extract_page(std::string_view url, std::string_view html,
                                       const ExplorePolicy& policy);

/// HTML entity decode for common named/numeric entities used in titles/text.
[[nodiscard]] std::string decode_html_entities(std::string_view input);

}  // namespace explore
}  // namespace handoffkit
