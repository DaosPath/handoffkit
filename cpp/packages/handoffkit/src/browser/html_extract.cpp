#include <handoffkit/browser/html_extract.hpp>

#include <algorithm>
#include <cctype>
#include <initializer_list>
#include <optional>
#include <regex>
#include <sstream>

namespace handoffkit {
namespace browser {
namespace {

std::string lower_copy(std::string s) {
    for (char& c : s) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return s;
}

// ---------------------------------------------------------------------------
// Linear tag/attribute scanning (parity with js/packages/browser
// html_extract.js). Replaces std::regex patterns such as
// `<meta\b[^>]*name=...[^>]*content=...` that backtrack polynomially and, in
// libstdc++, recurse once per consumed character (stack overflow on large
// pages). Every helper below is a single forward pass built on find().
// ---------------------------------------------------------------------------

bool is_html_space(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f';
}

bool is_open_tag_name_end(char c) {
    return c == '>' || c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '/';
}

// Equivalent of a regex `\b` right after a tag name (next char is not [a-z0-9_]).
bool is_tag_name_boundary(std::string_view low, std::size_t idx) {
    if (idx >= low.size()) return true;
    const char c = low[idx];
    return !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || c == '_');
}

std::string trim_ws_copy(std::string_view s) {
    // Mirrors JS String#trim / Python str.strip for ASCII whitespace.
    const auto is_ws = [](char c) {
        return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
    };
    std::size_t b = 0;
    std::size_t e = s.size();
    while (b < e && is_ws(s[b])) ++b;
    while (e > b && is_ws(s[e - 1])) --e;
    return std::string(s.substr(b, e - b));
}

/// Parse the attribute text of an open tag (everything between the tag name
/// and its `>`). Names are lowercased, the first occurrence wins, valueless
/// attributes map to std::nullopt.
TagAttributes parse_tag_attributes(std::string_view s) {
    TagAttributes attrs;
    const std::size_t n = s.size();
    std::size_t i = 0;
    while (i < n) {
        while (i < n && (is_html_space(s[i]) || s[i] == '/')) ++i;
        if (i >= n) break;
        const std::size_t name_start = i;
        while (i < n && !is_html_space(s[i]) && s[i] != '/' && s[i] != '=') ++i;
        if (i == name_start) {
            ++i;  // stray "=" without a name
            continue;
        }
        std::string name = lower_copy(std::string(s.substr(name_start, i - name_start)));
        std::size_t j = i;
        while (j < n && is_html_space(s[j])) ++j;
        std::optional<std::string> value;
        if (j < n && s[j] == '=') {
            ++j;
            while (j < n && is_html_space(s[j])) ++j;
            const char q = j < n ? s[j] : '\0';
            if (q == '"' || q == '\'') {
                const auto close = s.find(q, j + 1);
                value = std::string(close == std::string_view::npos ? s.substr(j + 1)
                                                                    : s.substr(j + 1, close - j - 1));
                j = close == std::string_view::npos ? n : close + 1;
            } else {
                const std::size_t value_start = j;
                while (j < n && !is_html_space(s[j])) ++j;
                value = std::string(s.substr(value_start, j - value_start));
            }
            i = j;
        }
        attrs.emplace(std::move(name), std::move(value));  // emplace keeps the first occurrence
    }
    return attrs;
}

const std::string* attr_get(const TagAttributes& attrs, const std::string& name) {
    const auto it = attrs.find(name);
    if (it == attrs.end() || !it->second.has_value()) return nullptr;
    return &*it->second;
}

bool attr_equals(const TagAttributes& attrs, const std::string& name, std::string_view expected) {
    const std::string* value = attr_get(attrs, name);
    return value != nullptr && lower_copy(trim_ws_copy(*value)) == expected;
}

struct OpenTag {
    std::size_t start = 0;
    std::size_t content_start = 0;
    TagAttributes attrs;
};

/// Next `<tag ...>` open tag at or after `from`. The tag ends at the first `>`.
std::optional<OpenTag> next_open_tag(std::string_view source, std::string_view low,
                                     std::string_view tag, std::size_t from) {
    const std::string open = "<" + std::string(tag);
    std::size_t pos = from;
    while (true) {
        const auto start = low.find(open, pos);
        if (start == std::string_view::npos) return std::nullopt;
        const std::size_t name_end = start + open.size();
        if (!is_tag_name_boundary(low, name_end)) {
            pos = start + 1;
            continue;
        }
        const auto gt = low.find('>', name_end);
        if (gt == std::string_view::npos) return std::nullopt;
        OpenTag out;
        out.start = start;
        out.content_start = gt + 1;
        out.attrs = parse_tag_attributes(source.substr(name_end, gt - name_end));
        return out;
    }
}

struct CloseTag {
    std::size_t start = 0;
    std::size_t end = 0;
};

/// Next end tag for `tag` at or after `from`: `</tag>` and also `</tag >`,
/// `</tag\t\n foo>` (what browsers accept).
std::optional<CloseTag> find_close_tag(std::string_view low, std::string_view tag, std::size_t from) {
    const std::string needle = "</" + std::string(tag);
    std::size_t pos = from;
    while (true) {
        const auto i = low.find(needle, pos);
        if (i == std::string_view::npos) return std::nullopt;
        const std::size_t j = i + needle.size();
        if (j >= low.size()) return std::nullopt;
        const char c = low[j];
        if (c == '>') return CloseTag{i, j + 1};
        if (is_html_space(c) || c == '/') {
            const auto gt = low.find('>', j);
            if (gt == std::string_view::npos) return std::nullopt;
            return CloseTag{i, gt + 1};
        }
        pos = i + 1;
    }
}

// First `<meta>` whose name/property is one of `names` and that has content.
std::optional<std::string> meta_content(std::string_view source, std::string_view low,
                                        std::initializer_list<std::string_view> names) {
    std::size_t pos = 0;
    while (true) {
        auto tag = next_open_tag(source, low, "meta", pos);
        if (!tag) return std::nullopt;
        pos = tag->content_start;
        const std::string* content = attr_get(tag->attrs, "content");
        if (content == nullptr) continue;
        for (const auto name : names) {
            if (attr_equals(tag->attrs, "name", name) || attr_equals(tag->attrs, "property", name)) {
                return *content;
            }
        }
    }
}

std::optional<std::string> canonical_href(std::string_view source, std::string_view low) {
    std::size_t pos = 0;
    while (true) {
        auto tag = next_open_tag(source, low, "link", pos);
        if (!tag) return std::nullopt;
        pos = tag->content_start;
        const std::string* href = attr_get(tag->attrs, "href");
        if (href != nullptr && attr_equals(tag->attrs, "rel", "canonical")) return *href;
    }
}

// Same result as the JS regex /charset\s*=\s*["']?([a-z0-9-]+)/i (first hit),
// as a linear scan: std::regex's `\s*` recurses once per space in libstdc++.
std::string first_charset(std::string_view low) {
    const auto is_regex_space = [](char c) {
        return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
    };
    const auto is_charset_char = [](char c) {
        return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
    };
    std::size_t pos = 0;
    while (true) {
        const auto at = low.find("charset", pos);
        if (at == std::string_view::npos) return {};
        pos = at + 1;
        std::size_t j = at + 7;
        while (j < low.size() && is_regex_space(low[j])) ++j;
        if (j >= low.size() || low[j] != '=') continue;
        ++j;
        while (j < low.size() && is_regex_space(low[j])) ++j;
        if (j < low.size() && (low[j] == '"' || low[j] == '\'')) ++j;
        const std::size_t value_start = j;
        while (j < low.size() && is_charset_char(low[j])) ++j;
        if (j > value_start) return std::string(low.substr(value_start, j - value_start));
    }
}

std::string strip_tags_region(const std::string& html, const std::string& tag) {
    // Remove <tag ...> ... </tag> (end tag may carry whitespace/attributes).
    // An unclosed block drops the rest of the document. Built in one pass
    // instead of repeated erase() (which was O(n^2) on many short blocks).
    const std::string low = lower_copy(html);
    const std::string open = "<" + tag;
    std::string out;
    out.reserve(html.size());
    std::size_t copy_from = 0;
    std::size_t pos = 0;
    while (true) {
        const auto start = low.find(open, pos);
        if (start == std::string::npos) break;
        const std::size_t name_end = start + open.size();
        if (name_end < low.size() && !is_open_tag_name_end(low[name_end])) {
            pos = start + 1;
            continue;
        }
        out.append(html, copy_from, start - copy_from);
        const auto close = find_close_tag(low, tag, name_end);
        if (!close) {
            copy_from = html.size();
            break;
        }
        copy_from = close->end;
        pos = close->end;
    }
    out.append(html, copy_from, std::string::npos);
    return out;
}

bool is_noise_container(std::string_view tag) {
    return tag == "div" || tag == "section" || tag == "aside" || tag == "span" ||
           tag == "form" || tag == "li" || tag == "table";
}

bool attrs_look_like_noise(const std::string& attrs) {
    static const char* kNoiseWords[] = {
        "ad",        "ads",        "advert",      "advertisement", "sponsored", "promoted",
        "promo",     "commercial", "cookie",      "consent",       "newsletter", "subscribe",
        "paywall",   "popup",      "modal",       "banner",
    };
    std::string token;
    const auto flush = [&]() {
        if (token.empty()) return false;
        for (const char* word : kNoiseWords) {
            if (token == word) return true;
        }
        token.clear();
        return false;
    };
    for (char c : attrs) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
            token.push_back(c);
        } else if (flush()) {
            return true;
        }
    }
    return flush();
}

std::string strip_marked_noise(std::string html) {
    // Manual scanner: the old std::regex (<tag ...>[\s\S]*?</tag> with a
    // backreference) blew libstdc++'s recursive matcher (86k frames, stack
    // overflow) on large real-world pages. Same first-close semantics.
    for (int pass = 0; pass < 3; ++pass) {
        const std::string low = lower_copy(html);
        std::string out;
        out.reserve(html.size());
        std::size_t pos = 0;
        bool changed = false;
        while (pos < html.size()) {
            const auto open = low.find('<', pos);
            if (open == std::string::npos) break;
            std::size_t name_end = open + 1;
            while (name_end < low.size() &&
                   ((low[name_end] >= 'a' && low[name_end] <= 'z') ||
                    (low[name_end] >= '0' && low[name_end] <= '9'))) {
                ++name_end;
            }
            const std::string_view tag(low.data() + open + 1, name_end - open - 1);
            const bool boundary = name_end >= low.size() || low[name_end] == '>' ||
                                  low[name_end] == ' ' || low[name_end] == '\t' ||
                                  low[name_end] == '\n' || low[name_end] == '\r' ||
                                  low[name_end] == '/';
            const auto tag_end = boundary ? low.find('>', name_end) : std::string::npos;
            std::string close;
            std::size_t close_at = std::string::npos;
            if (tag_end != std::string::npos && !tag.empty() && is_noise_container(tag)) {
                close = "</" + std::string(tag) + ">";
                close_at = low.find(close, tag_end);
            }
            if (close_at == std::string::npos) {
                // Not a removable container: keep '<' and move on.
                out.append(html.data() + pos, open - pos + 1);
                pos = open + 1;
                continue;
            }
            std::string attrs(html.data() + name_end, tag_end - name_end);
            for (char& c : attrs) {
                if (c == '"' || c == '\'') c = ' ';
            }
            out.append(html.data() + pos, open - pos);
            if (!attrs_look_like_noise(attrs)) {
                out.append(html.data() + open, close_at + close.size() - open);
            } else {
                changed = true;
            }
            pos = close_at + close.size();
        }
        out.append(html.data() + pos, html.size() - pos);
        if (!changed) break;
        html = std::move(out);
    }
    return html;
}

std::string collapse_ws(std::string s) {
    std::string out;
    out.reserve(s.size());
    bool sp = false;
    for (char c : s) {
        if (c == '\r') continue;
        if (c == '\n' || c == '\t' || c == ' ') {
            if (!sp && !out.empty()) {
                out.push_back(' ');
                sp = true;
            }
            continue;
        }
        out.push_back(c);
        sp = false;
    }
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

}  // namespace

std::string decode_html_entities(std::string_view input) {
    std::string out;
    out.reserve(input.size());
    for (std::size_t i = 0; i < input.size(); ++i) {
        if (input[i] != '&') {
            out.push_back(input[i]);
            continue;
        }
        auto semi = input.find(';', i + 1);
        if (semi == std::string_view::npos || semi - i > 32) {
            out.push_back('&');
            continue;
        }
        std::string ent(input.substr(i + 1, semi - i - 1));
        std::string low = lower_copy(ent);
        if (low == "amp") out.push_back('&');
        else if (low == "lt") out.push_back('<');
        else if (low == "gt") out.push_back('>');
        else if (low == "quot") out.push_back('"');
        else if (low == "apos" || low == "#39") out.push_back('\'');
        else if (low == "nbsp") out.push_back(' ');
        else if (!ent.empty() && ent[0] == '#') {
            int code = 0;
            if (ent.size() > 1 && (ent[1] == 'x' || ent[1] == 'X')) {
                try {
                    code = std::stoi(ent.substr(2), nullptr, 16);
                } catch (...) {
                    code = 0;
                }
            } else {
                try {
                    code = std::stoi(ent.substr(1), nullptr, 10);
                } catch (...) {
                    code = 0;
                }
            }
            if (code > 0 && code < 128) out.push_back(static_cast<char>(code));
            else if (code >= 128) out.push_back('?');  // keep ASCII-safe for tests
            else {
                out.push_back('&');
                out.append(ent);
                out.push_back(';');
                i = semi;
                continue;
            }
        } else {
            out.push_back('&');
            out.append(ent);
            out.push_back(';');
            i = semi;
            continue;
        }
        i = semi;
    }
    return out;
}

std::string extract_title(std::string_view html) {
    std::string low = lower_copy(std::string(html));
    auto start = low.find("<title");
    if (start == std::string::npos) return {};
    auto gt = low.find('>', start);
    if (gt == std::string::npos) return {};
    auto end = low.find("</title>", gt);
    if (end == std::string::npos) return {};
    std::string raw(html.substr(gt + 1, end - gt - 1));
    return collapse_ws(decode_html_entities(raw));
}

std::string prefer_main_content(std::string_view html) {
    std::string s = strip_marked_noise(std::string(html));
    for (const char* tag : {"script", "style", "noscript", "svg", "nav", "footer", "aside"}) {
        s = strip_tags_region(s, tag);
    }
    const std::string low = lower_copy(s);
    for (const char* tag : {"article", "main"}) {
        const std::string open = "<" + std::string(tag);
        const auto b = low.find(open);
        if (b == std::string::npos) continue;
        const auto gt = low.find('>', b);
        const std::string close = "</" + std::string(tag) + ">";
        const auto e = low.find(close, gt == std::string::npos ? b : gt);
        if (gt == std::string::npos || e == std::string::npos || e <= gt) continue;
        const std::string title = extract_title(html);
        const std::string inner = s.substr(gt + 1, e - gt - 1);
        if (title.empty()) return inner;
        return "<html><head><title>" + title + "</title></head><body>" + inner + "</body></html>";
    }
    const auto body_idx = low.find("<body");
    if (body_idx != std::string::npos) {
        const auto gt = low.find('>', body_idx);
        const auto e = low.find("</body>", gt == std::string::npos ? body_idx : gt);
        if (gt != std::string::npos && e != std::string::npos && e > gt) {
            std::string inner = s.substr(gt + 1, e - gt - 1);
            inner = strip_tags_region(inner, "header");
            const std::string title = extract_title(html);
            if (title.empty()) return inner;
            return "<html><head><title>" + title + "</title></head><body>" + inner + "</body></html>";
        }
    }
    return s;
}

std::string extract_text(std::string_view html, bool strip_scripts_styles, int max_chars) {
    std::string s = prefer_main_content(html);
    (void)strip_scripts_styles;
    // drop tags
    std::string text;
    text.reserve(s.size());
    bool in_tag = false;
    for (char c : s) {
        if (c == '<') {
            in_tag = true;
            continue;
        }
        if (c == '>') {
            in_tag = false;
            text.push_back(' ');
            continue;
        }
        if (!in_tag) text.push_back(c);
    }
    text = collapse_ws(decode_html_entities(text));
    if (max_chars > 0 && static_cast<int>(text.size()) > max_chars) {
        text.resize(static_cast<std::size_t>(max_chars));
        text += "...[truncated]";
    }
    return text;
}

std::vector<HrefAnchor> scan_href_anchors(std::string_view html) {
    const std::string low = lower_copy(std::string(html));
    std::vector<HrefAnchor> out;
    std::size_t pos = 0;
    while (true) {
        auto tag = next_open_tag(html, low, "a", pos);
        if (!tag) break;
        pos = tag->content_start;
        const std::string* href = attr_get(tag->attrs, "href");
        if (href == nullptr) continue;
        const auto close = find_close_tag(low, "a", tag->content_start);
        if (!close) break;
        pos = close->end;
        HrefAnchor anchor;
        anchor.href = *href;
        anchor.inner = std::string(html.substr(tag->content_start, close->start - tag->content_start));
        anchor.attrs = std::move(tag->attrs);
        out.push_back(std::move(anchor));
    }
    return out;
}

std::vector<ExtractedLink> extract_links(std::string_view html, std::string_view base_url, int max_links) {
    std::vector<ExtractedLink> out;
    for (const auto& anchor : scan_href_anchors(prefer_main_content(html))) {
        if (max_links > 0 && static_cast<int>(out.size()) >= max_links) break;
        const std::string& href = anchor.href;
        std::string text = collapse_ws(decode_html_entities(extract_text(anchor.inner, true, 200)));
        std::string abs = resolve_url(base_url, href);
        if (abs.empty() && href.find("://") != std::string::npos) abs = href;
        ExtractedLink link;
        link.href = href;
        link.absolute = abs;
        link.text = text;
        out.push_back(std::move(link));
    }
    return out;
}

namespace {

bool starts_tag(std::string_view low, std::size_t i, std::string_view tag) {
    if (i + 1 + tag.size() > low.size()) return false;
    if (low[i] != '<') return false;
    if (low.compare(i + 1, tag.size(), tag) != 0) return false;
    char next = (i + 1 + tag.size() < low.size()) ? low[i + 1 + tag.size()] : '>';
    return next == '>' || next == ' ' || next == '\t' || next == '\n' || next == '\r' || next == '/';
}

std::string attr_value(std::string_view open_tag, std::string_view attr) {
    // open_tag like <a href="..."> or <img src='...'>
    std::string low = lower_copy(std::string(open_tag));
    std::string key = lower_copy(std::string(attr)) + "=";
    auto pos = low.find(key);
    if (pos == std::string::npos) return {};
    pos += key.size();
    if (pos >= open_tag.size()) return {};
    char q = open_tag[pos];
    if (q == '"' || q == '\'') {
        auto end = open_tag.find(q, pos + 1);
        if (end == std::string_view::npos) return {};
        return std::string(open_tag.substr(pos + 1, end - pos - 1));
    }
    // bare
    std::size_t end = pos;
    while (end < open_tag.size() && open_tag[end] != ' ' && open_tag[end] != '>' && open_tag[end] != '\t') {
        ++end;
    }
    return std::string(open_tag.substr(pos, end - pos));
}

void append_inline_text(std::string& out, std::string_view chunk) {
    std::string t = collapse_ws(decode_html_entities(std::string(chunk)));
    if (t.empty()) return;
    if (!out.empty() && out.back() != '\n' && out.back() != ' ' && out.back() != '>') {
        // keep single space between text runs if needed
        if (!t.empty() && t.front() != ' ') {
            // no extra space if out ends mid-word delimiter
        }
    }
    out.append(t);
}

}  // namespace

std::string html_table_to_markdown(std::string_view html) {
    static const std::regex row_re(R"re(<tr\b[^>]*>([\s\S]*?)</tr>)re", std::regex::icase);
    static const std::regex cell_re(R"re(<(td|th)\b[^>]*>([\s\S]*?)</\1>)re", std::regex::icase);
    std::string source(html);
    std::vector<std::vector<std::string>> rows;
    auto row_begin = std::sregex_iterator(source.begin(), source.end(), row_re);
    auto row_end = std::sregex_iterator();
    for (auto it = row_begin; it != row_end; ++it) {
        std::string inner = (*it)[1].str();
        std::vector<std::string> cells;
        auto cell_begin = std::sregex_iterator(inner.begin(), inner.end(), cell_re);
        auto cell_end = std::sregex_iterator();
        for (auto cell = cell_begin; cell != cell_end; ++cell) {
            cells.push_back(collapse_ws(decode_html_entities(extract_text((*cell)[2].str(), true, 400))));
        }
        if (!cells.empty()) rows.push_back(std::move(cells));
    }
    if (rows.empty()) return {};
    std::size_t width = 0;
    for (const auto& row : rows) width = std::max(width, row.size());
    for (auto& row : rows) row.resize(width);
    std::ostringstream md;
    md << "|";
    for (const auto& cell : rows[0]) md << " " << cell << " |";
    md << "\n|";
    for (std::size_t i = 0; i < width; ++i) md << " --- |";
    md << "\n";
    for (std::size_t r = 1; r < rows.size(); ++r) {
        md << "|";
        for (const auto& cell : rows[r]) md << " " << cell << " |";
        md << "\n";
    }
    return md.str();
}

std::vector<nlohmann::json> extract_json_ld(std::string_view html) {
    const std::string low = lower_copy(std::string(html));
    std::vector<nlohmann::json> out;
    std::size_t pos = 0;
    while (true) {
        auto tag = next_open_tag(html, low, "script", pos);
        if (!tag) break;
        pos = tag->content_start;
        if (!attr_equals(tag->attrs, "type", "application/ld+json")) continue;
        const auto close = find_close_tag(low, "script", tag->content_start);
        if (!close) break;
        pos = close->end;
        try {
            out.push_back(nlohmann::json::parse(decode_html_entities(
                html.substr(tag->content_start, close->start - tag->content_start))));
        } catch (...) {
            // Malformed JSON-LD is skipped, never invented.
        }
    }
    return out;
}

nlohmann::json extract_page_metadata(std::string_view html, std::string_view url) {
    std::string source(html);
    const std::string low = lower_copy(source);
    auto meta = [&](std::string_view name) -> std::string {
        const auto content = meta_content(source, low, {name});
        return content ? decode_html_entities(*content) : std::string{};
    };
    const auto canonical_found = canonical_href(source, low);
    std::string canonical = canonical_found ? *canonical_found : std::string(url);
    std::string charset = first_charset(low);
    std::string description = meta("description");
    if (description.empty()) description = meta("og:description");
    return {
        {"title", extract_title(html)},
        {"description", description},
        {"canonical", canonical},
        {"charset", charset},
        {"json_ld", extract_json_ld(html)},
    };
}

std::string html_to_markdown(std::string_view html, const HtmlToMarkdownOptions& opts) {
    const std::string title = extract_title(html);
    std::string s = prefer_main_content(html);
    if (!opts.strip_scripts_styles) {
        // prefer_main_content already strips scripts/styles; keep caller html if disabled.
        s = std::string(html);
    }

    std::ostringstream md;
    if (opts.include_source_header) {
        if (!title.empty()) md << "# " << title << "\n\n";
        if (!opts.base_url.empty()) md << "Source: " << opts.base_url << "\n\n";
    }

    std::string low = lower_copy(s);
    std::string line_buf;
    auto flush_line = [&]() {
        std::string t = collapse_ws(line_buf);
        line_buf.clear();
        if (!t.empty()) md << t << "\n\n";
    };

    auto push_block = [&](std::string_view block) {
        flush_line();
        std::string t = collapse_ws(std::string(block));
        if (!t.empty()) md << t << "\n\n";
    };

    for (std::size_t i = 0; i < s.size();) {
        if (s[i] != '<') {
            // text node until next tag
            auto next = s.find('<', i);
            std::string_view chunk = s.substr(i, (next == std::string::npos ? s.size() : next) - i);
            std::string decoded = decode_html_entities(std::string(chunk));
            // collapse internal newlines to spaces for inline flow
            for (char& c : decoded) {
                if (c == '\n' || c == '\r' || c == '\t') c = ' ';
            }
            line_buf += decoded;
            i = (next == std::string::npos) ? s.size() : next;
            continue;
        }

        auto gt = s.find('>', i);
        if (gt == std::string::npos) break;
        std::string_view tag = s.substr(i, gt - i + 1);
        std::string tag_low = lower_copy(std::string(tag));
        const bool is_close = tag_low.size() >= 2 && tag_low[1] == '/';
        std::string name;
        {
            std::size_t start = is_close ? 2 : 1;
            std::size_t end = start;
            while (end < tag_low.size() && std::isalnum(static_cast<unsigned char>(tag_low[end]))) ++end;
            name = tag_low.substr(start, end - start);
        }

        if (name == "br" || name == "hr") {
            flush_line();
            if (name == "hr") md << "---\n\n";
            i = gt + 1;
            continue;
        }
        if (name == "p" || name == "div" || name == "section" || name == "article" || name == "header" ||
            name == "footer" || name == "main" || name == "tr") {
            if (!is_close) flush_line();
            else flush_line();
            i = gt + 1;
            continue;
        }
        if (!is_close && (name == "h1" || name == "h2" || name == "h3" || name == "h4" || name == "h5" ||
                          name == "h6")) {
            flush_line();
            int level = name[1] - '0';
            if (level < 1 || level > 6) level = 2;
            auto close = low.find("</" + name + ">", gt);
            if (close == std::string::npos) {
                i = gt + 1;
                continue;
            }
            std::string inner = extract_text(s.substr(gt + 1, close - gt - 1), true, 2000);
            md << std::string(static_cast<std::size_t>(level), '#') << " " << inner << "\n\n";
            i = close + 3 + name.size();  // </hN>
            continue;
        }
        if (!is_close && (name == "li")) {
            flush_line();
            auto close = low.find("</li>", gt);
            if (close == std::string::npos) {
                i = gt + 1;
                continue;
            }
            std::string inner = extract_text(s.substr(gt + 1, close - gt - 1), true, 2000);
            md << "- " << inner << "\n";
            i = close + 5;
            continue;
        }
        if (!is_close && (name == "ul" || name == "ol")) {
            flush_line();
            i = gt + 1;
            continue;
        }
        if (is_close && (name == "ul" || name == "ol")) {
            md << "\n";
            i = gt + 1;
            continue;
        }
        if (!is_close && name == "blockquote") {
            flush_line();
            auto close = low.find("</blockquote>", gt);
            if (close == std::string::npos) {
                i = gt + 1;
                continue;
            }
            std::string inner = extract_text(s.substr(gt + 1, close - gt - 1), true, 4000);
            md << "> " << inner << "\n\n";
            i = close + 13;
            continue;
        }
        if (!is_close && (name == "pre" || name == "code")) {
            // fenced if pre; inline if code short
            auto close_tag = "</" + name + ">";
            auto close = low.find(close_tag, gt);
            if (close == std::string::npos) {
                i = gt + 1;
                continue;
            }
            std::string inner = decode_html_entities(std::string(s.substr(gt + 1, close - gt - 1)));
            // strip nested tags roughly
            inner = extract_text(inner, true, 20000);
            if (name == "pre" || inner.find('\n') != std::string::npos) {
                flush_line();
                md << "```\n" << inner << "\n```\n\n";
            } else {
                line_buf += "`" + collapse_ws(inner) + "`";
            }
            i = close + close_tag.size();
            continue;
        }
        if (!is_close && name == "a") {
            std::string href = attr_value(tag, "href");
            auto close = low.find("</a>", gt);
            if (close == std::string::npos) {
                i = gt + 1;
                continue;
            }
            std::string inner = collapse_ws(
                decode_html_entities(extract_text(s.substr(gt + 1, close - gt - 1), true, 500))
            );
            std::string abs = resolve_url(opts.base_url, href);
            if (abs.empty()) abs = href;
            if (inner.empty()) inner = abs;
            if (!abs.empty()) {
                line_buf += "[" + inner + "](" + abs + ")";
            } else {
                line_buf += inner;
            }
            i = close + 4;
            continue;
        }
        if (!is_close && name == "table") {
            auto close = low.find("</table>", gt);
            if (close == std::string::npos) {
                i = gt + 1;
                continue;
            }
            flush_line();
            md << html_table_to_markdown(s.substr(i, close + 8 - i)) << "\n";
            i = close + 8;
            continue;
        }
        if (!is_close && name == "img") {
            std::string src = attr_value(tag, "src");
            std::string alt = attr_value(tag, "alt");
            std::string abs = resolve_url(opts.base_url, src);
            if (abs.empty()) abs = src;
            if (!abs.empty()) {
                flush_line();
                md << "![" << alt << "](" << abs << ")\n\n";
            }
            i = gt + 1;
            continue;
        }
        if (!is_close && (name == "strong" || name == "b")) {
            auto close = low.find(name == "b" ? "</b>" : "</strong>", gt);
            // try both
            if (name == "b") {
                auto c2 = low.find("</b>", gt);
                auto c3 = low.find("</strong>", gt);
                close = c2;
                (void)c3;
            } else {
                close = low.find("</strong>", gt);
            }
            if (close == std::string::npos) {
                i = gt + 1;
                continue;
            }
            std::size_t close_len = (low.compare(close, 4, "</b>") == 0) ? 4 : 9;
            std::string inner = collapse_ws(
                decode_html_entities(extract_text(s.substr(gt + 1, close - gt - 1), true, 500))
            );
            line_buf += "**" + inner + "**";
            i = close + close_len;
            continue;
        }
        if (!is_close && (name == "em" || name == "i")) {
            auto close = low.find(name == "i" ? "</i>" : "</em>", gt);
            if (close == std::string::npos) {
                // try alternate
                close = low.find(name == "i" ? "</em>" : "</i>", gt);
            }
            if (close == std::string::npos) {
                i = gt + 1;
                continue;
            }
            std::size_t close_len = 4;  // </i> or </em> -> em is 5
            if (low.compare(close, 5, "</em>") == 0) close_len = 5;
            std::string inner = collapse_ws(
                decode_html_entities(extract_text(s.substr(gt + 1, close - gt - 1), true, 500))
            );
            line_buf += "*" + inner + "*";
            i = close + close_len;
            continue;
        }
        // skip other tags
        i = gt + 1;
    }
    flush_line();

    if (opts.include_links_section) {
        auto links = extract_links(html, opts.base_url, opts.max_links);
        if (!links.empty()) {
            md << "## Links\n\n";
            for (const auto& l : links) {
                const std::string& u = !l.absolute.empty() ? l.absolute : l.href;
                if (u.empty()) continue;
                std::string label = l.text.empty() ? u : l.text;
                md << "- [" << label << "](" << u << ")\n";
            }
            md << "\n";
        }
    }

    std::string out = md.str();
    // collapse excessive blank lines
    std::string compact;
    compact.reserve(out.size());
    int blank = 0;
    for (std::size_t i = 0; i < out.size(); ++i) {
        if (out[i] == '\n') {
            ++blank;
            if (blank <= 2) compact.push_back('\n');
        } else {
            blank = 0;
            compact.push_back(out[i]);
        }
    }
    if (opts.max_chars > 0 && static_cast<int>(compact.size()) > opts.max_chars) {
        compact.resize(static_cast<std::size_t>(opts.max_chars));
        compact += "\n\n...[truncated]\n";
    }
    (void)starts_tag;
    (void)push_block;
    (void)append_inline_text;
    return compact;
}

std::string page_html_to_markdown(std::string_view url, std::string_view html, const ExplorePolicy& policy) {
    HtmlToMarkdownOptions opts;
    opts.base_url = std::string(url);
    opts.strip_scripts_styles = policy.strip_scripts_styles;
    opts.max_chars = policy.max_markdown_chars > 0 ? policy.max_markdown_chars : policy.max_text_chars;
    opts.include_source_header = true;
    opts.include_links_section = policy.extract_links;
    opts.max_links = policy.max_links_per_page;
    return html_to_markdown(html, opts);
}

PageExtract extract_page(std::string_view url, std::string_view html, const ExplorePolicy& policy) {
    PageExtract p;
    p.url = std::string(url);
    p.raw_body_bytes = html.size();
    if (policy.extract_title) p.title = extract_title(html);
    if (policy.extract_text) {
        p.text = extract_text(html, policy.strip_scripts_styles, policy.max_text_chars);
    }
    if (policy.extract_links) {
        p.links = extract_links(html, url, policy.max_links_per_page);
    }
    if (policy.emit_markdown) {
        p.markdown = page_html_to_markdown(url, html, policy);
    }
    return p;
}

}  // namespace browser
}  // namespace handoffkit
