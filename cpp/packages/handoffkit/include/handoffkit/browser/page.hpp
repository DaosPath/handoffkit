#pragma once

#include <handoffkit/browser/web_types.hpp>

#include <nlohmann/json.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace browser {

/// Typed page markdown payload for agent handoffs (parity with JS PageMarkdown).
struct PageMarkdown {
    bool success = true;
    std::string url;
    std::string title;
    std::string markdown;
    std::string excerpt;
    std::string text;
    std::vector<ExtractedLink> links;
    std::string fetched_at;
    std::string format{"markdown"};  // markdown | readme
    bool blocked = false;
    std::string error;
    int markdown_chars = 0;

    [[nodiscard]] nlohmann::json to_json() const;
    static PageMarkdown from_explore_result(const ExploreResult& result, int max_chars = 60000,
                                            std::string_view format = "markdown");
};

[[nodiscard]] std::string make_excerpt(std::string_view text, int max_chars = 320);
[[nodiscard]] std::string to_readme_markdown(std::string_view title, std::string_view url,
                                             std::string_view markdown,
                                             const std::vector<ExtractedLink>& links = {});

}  // namespace browser
}  // namespace handoffkit
