#include <handoffkit/browser/page.hpp>
#include <handoffkit/browser/util.hpp>

#include <chrono>
#include <regex>
#include <sstream>

namespace handoffkit {
namespace browser {

std::string make_excerpt(std::string_view text, int max_chars) {
    std::string clean(text);
    clean = std::regex_replace(clean, std::regex(R"(^#+\s.*$)", std::regex::multiline), "");
    clean = std::regex_replace(clean, std::regex(R"(Source:\s+\S+)"), "");
    clean = std::regex_replace(clean, std::regex(R"(\s+)"), " ");
    while (!clean.empty() && clean.front() == ' ') clean.erase(clean.begin());
    while (!clean.empty() && clean.back() == ' ') clean.pop_back();
    if (static_cast<int>(clean.size()) <= max_chars) return clean;
    return clean.substr(0, static_cast<std::size_t>(max_chars - 3)) + "...";
}

std::string to_readme_markdown(std::string_view title, std::string_view url,
                               std::string_view markdown, const std::vector<ExtractedLink>& links) {
    std::string body(markdown);
    std::vector<std::string> headings;
    {
        std::regex re(R"(^#{1,3}\s+(.+)$)");
        auto begin = std::sregex_iterator(body.begin(), body.end(), re);
        auto end = std::sregex_iterator();
        for (auto it = begin; it != end && headings.size() < 12; ++it) {
            headings.push_back((*it)[1].str());
        }
    }
    std::ostringstream ss;
    ss << "# " << (title.empty() ? "Untitled page" : title) << "\n\n";
    if (!url.empty()) ss << "Source: " << url << "\n\n";
    if (!headings.empty()) {
        ss << "## Contents\n\n";
        for (const auto& h : headings) ss << "- " << h << "\n";
        ss << "\n";
    }
    body = std::regex_replace(body, std::regex(R"(^#\s+.*\n+)"), "");
    body = std::regex_replace(body, std::regex(R"(^Source:\s+\S+\n+)"), "");
    ss << body;
    if (!links.empty() && body.find("## Links") == std::string::npos) {
        ss << "\n\n## Links\n\n";
        int n = 0;
        for (const auto& l : links) {
            if (n++ >= 40) break;
            const std::string u = l.absolute.empty() ? l.href : l.absolute;
            if (u.empty()) continue;
            ss << "- [" << (l.text.empty() ? u : l.text) << "](" << u << ")\n";
        }
    }
    return ss.str();
}

nlohmann::json PageMarkdown::to_json() const {
    nlohmann::json links_j = nlohmann::json::array();
    for (const auto& l : links) links_j.push_back(l.to_json());
    return {
        {"success", success},
        {"url", url},
        {"title", title},
        {"markdown", markdown},
        {"excerpt", excerpt},
        {"text", text},
        {"links", links_j},
        {"fetched_at", fetched_at},
        {"format", format},
        {"blocked", blocked},
        {"error", error},
        {"markdown_chars", markdown_chars},
        {"text_chars", static_cast<int>(text.size())},
    };
}

PageMarkdown PageMarkdown::from_explore_result(const ExploreResult& result, int max_chars,
                                               std::string_view format) {
    PageMarkdown p;
    p.url = result.final_url.empty() ? result.start_url : result.final_url;
    p.title = result.title;
    p.text = result.text;
    p.links = result.links;
    p.markdown = result.markdown;
    if (format == "readme") {
        p.markdown = to_readme_markdown(p.title, p.url, p.markdown, p.links);
    }
    p.markdown = smart_truncate(p.markdown, max_chars);
    p.excerpt = make_excerpt(p.markdown);
    p.format = std::string(format);
    p.error = result.success ? "" : result.error;
    p.success = result.success;
    p.markdown_chars = static_cast<int>(p.markdown.size());
    const auto now = std::chrono::system_clock::now();
    p.fetched_at = std::to_string(
        std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count());
    return p;
}

}  // namespace browser
}  // namespace handoffkit
