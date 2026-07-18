#include <handoffkit/explore/html_extract.hpp>

#include <cctype>
#include <regex>
#include <sstream>

namespace handoffkit {
namespace explore {
namespace {

std::string lower_copy(std::string s) {
    for (char& c : s) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return s;
}

std::string strip_tags_region(std::string html, const std::string& tag) {
    // Remove <tag ...> ... </tag> case-insensitive, non-greedy-ish via loop.
    const std::string open = "<" + tag;
    const std::string close = "</" + tag + ">";
    std::string low = lower_copy(html);
    std::size_t pos = 0;
    while (true) {
        auto start = low.find(open, pos);
        if (start == std::string::npos) break;
        // ensure it's a tag start: <script or <script>
        if (start + open.size() < low.size()) {
            char next = low[start + open.size()];
            if (next != '>' && next != ' ' && next != '\t' && next != '\n' && next != '\r' && next != '/') {
                pos = start + 1;
                continue;
            }
        }
        auto end = low.find(close, start);
        if (end == std::string::npos) {
            html.erase(start);
            low.erase(start);
            break;
        }
        end += close.size();
        html.erase(start, end - start);
        low.erase(start, end - start);
        pos = start;
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

std::string extract_text(std::string_view html, bool strip_scripts_styles, int max_chars) {
    std::string s(html);
    if (strip_scripts_styles) {
        s = strip_tags_region(std::move(s), "script");
        s = strip_tags_region(std::move(s), "style");
        s = strip_tags_region(std::move(s), "noscript");
    }
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

std::vector<ExtractedLink> extract_links(std::string_view html, std::string_view base_url, int max_links) {
    std::vector<ExtractedLink> out;
    // Match href= loosely: href="..." or href='...' or href=bare
    static const std::regex re(
        R"re(<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)</a>)re",
        std::regex::icase
    );
    std::string s(html);
    auto begin = std::sregex_iterator(s.begin(), s.end(), re);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        if (max_links > 0 && static_cast<int>(out.size()) >= max_links) break;
        const auto& m = *it;
        std::string href = m[1].matched ? m[1].str() : (m[2].matched ? m[2].str() : m[3].str());
        std::string text = collapse_ws(decode_html_entities(extract_text(m[4].str(), true, 200)));
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

std::string html_to_markdown(std::string_view html, const HtmlToMarkdownOptions& opts) {
    std::string s(html);
    if (opts.strip_scripts_styles) {
        s = strip_tags_region(std::move(s), "script");
        s = strip_tags_region(std::move(s), "style");
        s = strip_tags_region(std::move(s), "noscript");
        s = strip_tags_region(std::move(s), "svg");
    }

    std::string title = extract_title(s);
    // Prefer body content if present
    {
        std::string low = lower_copy(s);
        auto b = low.find("<body");
        if (b != std::string::npos) {
            auto gt = low.find('>', b);
            auto e = low.find("</body>", gt == std::string::npos ? b : gt);
            if (gt != std::string::npos && e != std::string::npos && e > gt) {
                s = s.substr(gt + 1, e - gt - 1);
            }
        }
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

}  // namespace explore
}  // namespace handoffkit
