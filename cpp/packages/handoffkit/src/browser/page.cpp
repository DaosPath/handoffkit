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

namespace {

bool is_ascii_space(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

std::string trim_ascii(std::string_view s) {
    std::size_t b = 0;
    std::size_t e = s.size();
    while (b < e && is_ascii_space(s[b])) ++b;
    while (e > b && is_ascii_space(s[e - 1])) --e;
    return std::string(s.substr(b, e - b));
}

// Length of a line terminator at `i` (\r\n, \n, \r, U+2028, U+2029), else 0.
std::size_t line_break_len(std::string_view s, std::size_t i) {
    const char c = s[i];
    if (c == '\r') return (i + 1 < s.size() && s[i + 1] == '\n') ? 2 : 1;
    if (c == '\n') return 1;
    if (static_cast<unsigned char>(c) == 0xE2 && i + 2 < s.size() &&
        static_cast<unsigned char>(s[i + 1]) == 0x80 &&
        (static_cast<unsigned char>(s[i + 2]) == 0xA8 || static_cast<unsigned char>(s[i + 2]) == 0xA9)) {
        return 3;
    }
    return 0;
}

// ATX headings up to `max_level` ("# x" .. "### x"), one per line. Linear
// line scan (parity with JS markdownHeadings) instead of `^#{1,3}\s+(.+)$`,
// which backtracks on long whitespace runs and recurses per character in
// libstdc++.
std::vector<std::string> markdown_headings(std::string_view body, std::size_t max_level,
                                           std::size_t limit) {
    std::vector<std::string> out;
    std::size_t start = 0;
    while (start <= body.size() && out.size() < limit) {
        std::size_t end = start;
        std::size_t brk = 0;
        while (end < body.size() && (brk = line_break_len(body, end)) == 0) ++end;
        const std::string_view line = body.substr(start, end - start);
        std::size_t level = 0;
        while (level < line.size() && line[level] == '#') ++level;
        if (level >= 1 && level <= max_level && level < line.size() && is_ascii_space(line[level])) {
            std::string text = trim_ascii(line.substr(level));
            if (!text.empty()) out.push_back(std::move(text));
        }
        if (end >= body.size()) break;
        start = end + brk;
    }
    return out;
}

// Drop a leading "# Title" line plus the newlines after it. Linear stand-in
// for `^#\s+.*\n+` (parity with JS dropLeadingTitleLine).
std::string drop_leading_title_line(std::string text) {
    const auto nl = text.find('\n');
    if (nl == std::string::npos || text[0] != '#' || text.size() < 2 || !is_ascii_space(text[1])) return text;
    std::size_t b = 1;
    while (b < nl) {  // JS trimStart(): whitespace and line terminators
        if (is_ascii_space(text[b])) {
            ++b;
        } else if (const auto len = line_break_len(text, b); len == 3) {
            b += len;
        } else {
            break;
        }
    }
    for (std::size_t i = b; i < nl; ++i) {
        if (text[i] == '\r' || line_break_len(text, i) == 3) return text;
    }
    std::size_t end = nl;
    while (end < text.size() && text[end] == '\n') ++end;
    return text.substr(end);
}

// Drop a leading "Source: <url>" line plus the newlines after it. Linear
// stand-in for `^Source:\s+\S+\n+` (same matches; no per-char recursion).
std::string drop_leading_source_line(std::string text) {
    static constexpr std::string_view kPrefix = "Source:";
    if (text.compare(0, kPrefix.size(), kPrefix) != 0) return text;
    std::size_t i = kPrefix.size();
    const std::size_t ws_start = i;
    while (i < text.size() && is_ascii_space(text[i])) ++i;
    if (i == ws_start) return text;
    const std::size_t token_start = i;
    while (i < text.size() && !is_ascii_space(text[i])) ++i;
    if (i == token_start) return text;
    if (i >= text.size() || text[i] != '\n') return text;
    while (i < text.size() && text[i] == '\n') ++i;
    return text.substr(i);
}

}  // namespace

std::string to_readme_markdown(std::string_view title, std::string_view url,
                               std::string_view markdown, const std::vector<ExtractedLink>& links) {
    std::string body(markdown);
    const std::vector<std::string> headings = markdown_headings(body, 3, 12);
    std::ostringstream ss;
    ss << "# " << (title.empty() ? "Untitled page" : title) << "\n\n";
    if (!url.empty()) ss << "Source: " << url << "\n\n";
    if (!headings.empty()) {
        ss << "## Contents\n\n";
        for (const auto& h : headings) ss << "- " << h << "\n";
        ss << "\n";
    }
    body = drop_leading_title_line(std::move(body));
    body = drop_leading_source_line(std::move(body));
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
