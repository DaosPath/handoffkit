#include <handoffkit/demos/fusion/web_research.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/explore/explorer.hpp>
#include <handoffkit/explore/html_extract.hpp>
#include <handoffkit/explore/tools.hpp>

#include <algorithm>
#include <cctype>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

std::string url_encode_component(std::string_view s) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    out.reserve(s.size() * 3);
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            out.push_back(static_cast<char>(c));
        } else if (c == ' ') {
            out.push_back('+');
        } else {
            out.push_back('%');
            out.push_back(hex[c >> 4]);
            out.push_back(hex[c & 0xF]);
        }
    }
    return out;
}

bool is_stopword(const std::string& w) {
    static const char* k[] = {
        "a","an","the","of","in","on","at","to","for","and","or","that","this","was","were","is","are",
        "had","have","has","with","its","it","as","by","from","what","which","who","when","where","how",
        "name","title","old","new","been","be","do","does","did","into","about","over","under","their",
        "there","these","those","than","then","them","they","you","your","our","we","i","me","my",
    };
    for (const char* s : k) {
        if (w == s) return true;
    }
    return false;
}

/// Compress free-text into a short keyword query (better for wiki/search engines).
std::string keyword_compress(std::string_view query, std::size_t max_words = 10) {
    std::string out;
    std::string word;
    std::size_t count = 0;
    auto flush = [&]() {
        if (word.empty()) return;
        std::string low = word;
        for (char& c : low) {
            if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        }
        if (!is_stopword(low) && word.size() >= 2) {
            if (!out.empty()) out.push_back(' ');
            out += word;
            ++count;
        }
        word.clear();
    };
    for (char c : query) {
        if (std::isalnum(static_cast<unsigned char>(c)) || c == '\'' || c == '-') {
            word.push_back(c);
        } else {
            flush();
            if (count >= max_words) break;
        }
    }
    if (count < max_words) flush();
    return out;
}

std::string url_decode_basic(std::string s) {
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size()) {
            auto hex = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };
            int hi = hex(s[i + 1]);
            int lo = hex(s[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out.push_back(static_cast<char>((hi << 4) | lo));
                i += 2;
                continue;
            }
        } else if (s[i] == '+') {
            out.push_back(' ');
            continue;
        }
        out.push_back(s[i]);
    }
    return out;
}

void push_hit(std::vector<std::pair<std::string, std::string>>& hits, std::string title, std::string url,
              int max_results) {
    if (static_cast<int>(hits.size()) >= max_results) return;
    if (url.rfind("http", 0) != 0) return;
    // Skip search engines / trackers
    if (url.find("duckduckgo.com") != std::string::npos) return;
    if (url.find("wikipedia.org/w/api.php") != std::string::npos) return;
    for (const auto& h : hits) {
        if (h.second == url) return;
    }
    if (title.empty()) title = url;
    hits.emplace_back(std::move(title), std::move(url));
}

/// Wikipedia OpenSearch → list of {title, url}. Works offline if transport maps the API URL.
std::vector<std::pair<std::string, std::string>> wikipedia_opensearch(
    explore::TransportPtr transport,
    std::string_view query,
    int max_results,
    int timeout_ms
) {
    std::vector<std::pair<std::string, std::string>> hits;
    if (!transport || query.empty() || max_results < 1) return hits;

    // Prefer compressed keywords; wiki OpenSearch fails on long natural-language questions.
    std::string q(query);
    std::string kw = keyword_compress(query, 8);
    if (!kw.empty() && kw.size() + 10 < q.size()) q = kw;

    const std::string api =
        "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=" +
        std::to_string(max_results) + "&search=" + url_encode_component(q);

    explore::TransportRequest req;
    req.url = api;
    req.timeout_ms = timeout_ms > 0 ? timeout_ms : 15000;
    req.headers["User-Agent"] = "HandoffKit/1.0";
    req.headers["Accept"] = "application/json";
    auto resp = transport->get(req);
    if (!resp.error.empty() || resp.status < 200 || resp.status >= 300 || resp.body.empty()) {
        return hits;
    }

    try {
        auto j = nlohmann::json::parse(resp.body);
        // OpenSearch format: [query, [titles], [descs], [urls]]
        if (!j.is_array() || j.size() < 4 || !j[1].is_array() || !j[3].is_array()) {
            return hits;
        }
        const auto& titles = j[1];
        const auto& urls = j[3];
        const std::size_t n = std::min({titles.size(), urls.size(), static_cast<std::size_t>(max_results)});
        for (std::size_t i = 0; i < n; ++i) {
            if (!titles[i].is_string() || !urls[i].is_string()) continue;
            push_hit(hits, titles[i].get<std::string>(), urls[i].get<std::string>(), max_results);
        }
    } catch (...) {
        return hits;
    }
    return hits;
}

/// DuckDuckGo HTML results (no API key). Best-effort link extraction.
std::vector<std::pair<std::string, std::string>> duckduckgo_html_search(
    explore::TransportPtr transport,
    std::string_view query,
    int max_results,
    int timeout_ms
) {
    std::vector<std::pair<std::string, std::string>> hits;
    if (!transport || query.empty() || max_results < 1) return hits;

    std::string q(query);
    std::string kw = keyword_compress(query, 10);
    if (!kw.empty()) q = kw;

    const std::string url =
        "https://html.duckduckgo.com/html/?q=" + url_encode_component(q);

    explore::TransportRequest req;
    req.url = url;
    req.timeout_ms = timeout_ms > 0 ? timeout_ms : 20000;
    req.headers["User-Agent"] = "HandoffKit/1.0";
    req.headers["Accept"] = "text/html,application/xhtml+xml";
    auto resp = transport->get(req);
    if (!resp.error.empty() || resp.status < 200 || resp.status >= 300 || resp.body.empty()) {
        return hits;
    }

    const std::string& html = resp.body;
    // uddg= redirects: uddg=https%3A%2F%2F...
    std::size_t pos = 0;
    while (static_cast<int>(hits.size()) < max_results) {
        auto u = html.find("uddg=", pos);
        if (u == std::string::npos) break;
        u += 5;
        std::size_t end = u;
        while (end < html.size()) {
            char c = html[end];
            if (c == '&' || c == '"' || c == '\'' || c == ' ' || c == '<' || c == '>') break;
            ++end;
        }
        std::string enc = html.substr(u, end - u);
        std::string dec = url_decode_basic(enc);
        push_hit(hits, {}, dec, max_results);
        pos = end;
    }
    // Also result__a href="https://..."
    pos = 0;
    while (static_cast<int>(hits.size()) < max_results) {
        auto a = html.find("result__a", pos);
        if (a == std::string::npos) break;
        auto href = html.find("href=\"", a);
        if (href == std::string::npos || href > a + 80) {
            pos = a + 8;
            continue;
        }
        href += 6;
        auto hend = html.find('"', href);
        if (hend == std::string::npos) break;
        std::string link = html.substr(href, hend - href);
        if (link.find("uddg=") != std::string::npos) {
            auto u = link.find("uddg=");
            link = url_decode_basic(link.substr(u + 5));
            auto amp = link.find('&');
            if (amp != std::string::npos) link = link.substr(0, amp);
        }
        push_hit(hits, {}, link, max_results);
        pos = hend;
    }
    return hits;
}

std::vector<std::pair<std::string, std::string>> multi_search(
    explore::TransportPtr transport,
    std::string_view query,
    int max_results,
    int timeout_ms
) {
    auto hits = duckduckgo_html_search(transport, query, max_results, timeout_ms);
    if (static_cast<int>(hits.size()) < max_results) {
        auto wiki = wikipedia_opensearch(transport, query, max_results, timeout_ms);
        for (auto& h : wiki) {
            push_hit(hits, std::move(h.first), std::move(h.second), max_results);
        }
    }
    // If still empty, try a short entity-only wiki query (first 4 keywords).
    if (hits.empty()) {
        auto short_q = keyword_compress(query, 4);
        if (!short_q.empty() && short_q != query) {
            hits = wikipedia_opensearch(transport, short_q, max_results, timeout_ms);
        }
    }
    return hits;
}

Tool make_web_search_tool(explore::TransportPtr default_transport) {
    auto transport = default_transport;
    return Tool(
        "web_search",
        "Search the web (Wikipedia OpenSearch) and return titles + URLs for follow-up web_fetch_markdown.",
        [transport](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("query") || !args["query"].is_string()) {
                return Error::invalid_argument("query is required", "query");
            }
            const std::string query = args["query"].get<std::string>();
            int max_results = 3;
            if (args.contains("max_results") && args["max_results"].is_number_integer()) {
                max_results = std::max(1, std::min(8, args["max_results"].get<int>()));
            }
            int timeout_ms = 15000;
            if (args.contains("timeout_ms") && args["timeout_ms"].is_number_integer()) {
                timeout_ms = args["timeout_ms"].get<int>();
            }
            auto t = transport ? transport : explore::make_transport("http");
            if (args.contains("transport") && args["transport"].is_string()) {
                t = explore::make_transport(args["transport"].get<std::string>());
            }
            auto hits = multi_search(t, query, max_results, timeout_ms);
            nlohmann::json results = nlohmann::json::array();
            for (const auto& [title, url] : hits) {
                results.push_back({{"title", title}, {"url", url}});
            }
            return nlohmann::json{
                {"success", !hits.empty()},
                {"query", query},
                {"keywords", keyword_compress(query)},
                {"results", results},
                {"count", hits.size()},
                {"engine", "duckduckgo_html+wikipedia_opensearch"},
            };
        },
        nlohmann::json{
            {"type", "object"},
            {"properties",
             {{"query", {{"type", "string"}}},
              {"max_results", {{"type", "integer"}}},
              {"transport", {{"type", "string"}}},
              {"timeout_ms", {{"type", "integer"}}}}},
            {"required", nlohmann::json::array({"query"})},
        }
    );
}

void append_page_md(std::ostringstream& ss, const std::string& url, const std::string& title,
                    const std::string& md, int max_chars_per_page) {
    ss << "\n### Source: " << (title.empty() ? url : title) << "\n";
    ss << "URL: " << url << "\n\n";
    if (md.empty()) {
        ss << "_(empty markdown)_\n";
        return;
    }
    if (max_chars_per_page > 0 && static_cast<int>(md.size()) > max_chars_per_page) {
        ss << truncate_with_marker(md, static_cast<std::size_t>(max_chars_per_page));
    } else {
        ss << md;
    }
    ss << "\n";
}

}  // namespace

nlohmann::json WebResearchResult::to_json() const {
    return nlohmann::json{
        {"enabled", enabled},
        {"used", used},
        {"queries", queries},
        {"urls_fetched", urls_fetched},
        {"pages_ok", pages_ok},
        {"tool_calls", tool_calls},
        {"transport", transport},
        {"markdown_chars", markdown_context.size()},
        {"steps", steps},
        {"error", error},
    };
}

std::string WebResearchResult::prompt_section() const {
    if (markdown_context.empty()) return {};
    std::ostringstream ss;
    ss << "### Live web research (Markdown from HandoffKit explorer)\n"
       << "Use the following fetched page content as evidence. Prefer these sources over invention.\n"
       << "Tools used: web_search, web_fetch_markdown, html_to_markdown (native C++ explorer).\n"
       << markdown_context;
    return ss.str();
}

std::vector<std::string> extract_urls_from_text(std::string_view text) {
    std::vector<std::string> out;
    const std::string s(text);
    std::size_t i = 0;
    while (i < s.size()) {
        auto pos = s.find("http", i);
        if (pos == std::string::npos) break;
        if (pos + 7 > s.size()) break;
        const bool ok =
            s.compare(pos, 8, "https://") == 0 || s.compare(pos, 7, "http://") == 0;
        if (!ok) {
            i = pos + 4;
            continue;
        }
        std::size_t end = pos;
        while (end < s.size()) {
            const unsigned char c = static_cast<unsigned char>(s[end]);
            if (std::isspace(c) || c == ')' || c == ']' || c == '>' || c == '"' || c == '\'' ||
                c == '<' || c == '|' || c == ',') {
                break;
            }
            ++end;
        }
        std::string url = s.substr(pos, end - pos);
        while (!url.empty() && (url.back() == '.' || url.back() == ';' || url.back() == ':')) {
            url.pop_back();
        }
        if (url.size() > 10) {
            if (std::find(out.begin(), out.end(), url) == out.end()) {
                out.push_back(url);
            }
        }
        i = end;
    }
    return out;
}

std::string make_search_query_from_task(std::string_view task, std::size_t max_chars) {
    std::string s(task);
    // Prefer explicit TASK: body when the prompt wraps the real question.
    auto tpos = s.find("TASK:");
    if (tpos == std::string::npos) tpos = s.find("Task:");
    if (tpos != std::string::npos) {
        s = s.substr(tpos + 5);
    }
    // Drop common wrapper prefixes if still present.
    const char* prefixes[] = {
        "Deep research style answer (research only).",
        "Deep research style answer",
        "Deep research",
    };
    for (const char* pfx : prefixes) {
        if (s.rfind(pfx, 0) == 0) {
            s = s.substr(std::char_traits<char>::length(pfx));
            break;
        }
    }
    // Collapse whitespace
    std::string out;
    out.reserve(s.size());
    bool space = false;
    for (char c : s) {
        if (std::isspace(static_cast<unsigned char>(c))) {
            if (!out.empty()) space = true;
            continue;
        }
        if (space) {
            out.push_back(' ');
            space = false;
        }
        out.push_back(c);
    }
    while (!out.empty() && (out.front() == ':' || std::isspace(static_cast<unsigned char>(out.front())))) {
        out.erase(out.begin());
    }
    // Prefer first sentence if long, but keep enough signal for search.
    if (out.size() > max_chars) {
        auto cut = out.find(". ");
        if (cut != std::string::npos && cut >= 40 && cut < max_chars) {
            out = out.substr(0, cut);
        } else {
            out = out.substr(0, max_chars);
        }
    }
    return out;
}

ToolRegistry make_fusion_web_tool_registry(explore::TransportPtr transport) {
    ToolRegistry reg;
    explore::register_web_explorer_tools(reg, transport);
    reg.add(make_web_search_tool(transport));
    return reg;
}

WebResearchResult gather_web_research(const FusionConfig& config) {
    explore::TransportPtr t;
    if (config.web_transport == "map" || config.web_transport == "fixture" ||
        config.web_transport == "stub" || config.web_transport == "offline") {
        t = explore::make_fixture_map_transport();
    } else {
        t = explore::make_transport(config.web_transport.empty() ? "http" : config.web_transport);
    }
    return gather_web_research(config, t);
}

WebResearchResult gather_web_research(const FusionConfig& config, explore::TransportPtr transport) {
    WebResearchResult r;
    r.enabled = config.enable_web_tools;
    r.transport = transport ? transport->name() : "";
    if (!config.enable_web_tools) return r;
    if (!transport) {
        r.error = "no web transport";
        return r;
    }

    auto reg = make_fusion_web_tool_registry(transport);
    const int max_pages = std::max(1, config.web_max_pages);
    const int max_depth = std::max(0, config.web_max_depth);
    const int per_page = std::max(500, config.web_context_max_chars / std::max(1, max_pages));
    const int total_cap = std::max(1000, config.web_context_max_chars);

    std::vector<std::string> urls = config.seed_urls;
    for (const auto& u : extract_urls_from_text(config.task)) {
        if (std::find(urls.begin(), urls.end(), u) == urls.end()) urls.push_back(u);
    }

    // Auto-search when no URLs are present in the task text.
    if (urls.empty() && config.web_auto_search) {
        const std::string q = config.web_search_query.empty()
            ? make_search_query_from_task(config.task)
            : config.web_search_query;
        if (!q.empty()) {
            r.queries.push_back(q);
            ToolCall sc;
            sc.tool_name = "web_search";
            sc.arguments = {
                {"query", q},
                {"max_results", std::min(4, max_pages)},
                {"timeout_ms", config.web_timeout_ms},
            };
            auto sr = reg.execute(sc);
            ++r.tool_calls;
            nlohmann::json step = {{"tool", "web_search"}, {"query", q}};
            if (sr && sr.value().success && sr.value().result.is_object()) {
                step["result"] = sr.value().result;
                if (sr.value().result.contains("results") && sr.value().result["results"].is_array()) {
                    for (const auto& hit : sr.value().result["results"]) {
                        if (hit.contains("url") && hit["url"].is_string()) {
                            urls.push_back(hit["url"].get<std::string>());
                        }
                    }
                }
            } else {
                step["error"] = sr ? sr.value().error : "web_search failed";
            }
            r.steps.push_back(std::move(step));
        }
    }

    // Cap URL list
    if (static_cast<int>(urls.size()) > max_pages) {
        urls.resize(static_cast<std::size_t>(max_pages));
    }

    std::ostringstream md_all;
    md_all << "\n";

    for (const auto& url : urls) {
        ToolCall call;
        // Prefer multi-page explore for research tiers when depth>0 and first seed
        const bool explore = max_depth > 0 && config.web_prefer_explore &&
                             (url.find("fixture.local") != std::string::npos || max_pages > 1);
        if (explore && r.pages_ok == 0) {
            call.tool_name = "web_explore";
            call.arguments = {
                {"url", url},
                {"max_depth", max_depth},
                {"max_pages", max_pages},
                {"timeout_ms", config.web_timeout_ms},
                {"emit_markdown", true},
            };
        } else {
            call.tool_name = "web_fetch_markdown";
            call.arguments = {
                {"url", url},
                {"timeout_ms", config.web_timeout_ms},
            };
        }
        auto tr = reg.execute(call);
        ++r.tool_calls;
        nlohmann::json step = {{"tool", call.tool_name}, {"url", url}};
        r.urls_fetched.push_back(url);

        if (!tr || !tr.value().success) {
            step["success"] = false;
            step["error"] = tr ? tr.value().error : "tool execute failed";
            r.steps.push_back(std::move(step));
            continue;
        }
        const auto& body = tr.value().result;
        step["success"] = body.value("success", false);
        if (body.contains("markdown") && body["markdown"].is_string()) {
            const std::string md = body["markdown"].get<std::string>();
            const std::string title = body.value("title", std::string{});
            const std::string final_url = body.value("url", url);
            append_page_md(md_all, final_url, title, md, per_page);
            if (body.value("success", false) && !md.empty()) ++r.pages_ok;
            step["markdown_chars"] = md.size();
            step["title"] = title;
        } else if (body.contains("steps") && body["steps"].is_array()) {
            // explore multi-step: use result markdown or concatenate step texts
            std::string md = body.value("markdown", std::string{});
            if (md.empty()) {
                for (const auto& st : body["steps"]) {
                    if (st.contains("markdown") && st["markdown"].is_string()) {
                        md += st["markdown"].get<std::string>() + "\n\n";
                    } else if (st.contains("text") && st["text"].is_string()) {
                        md += st["text"].get<std::string>() + "\n\n";
                    }
                }
            }
            append_page_md(md_all, url, body.value("title", std::string{}), md, per_page * max_pages);
            if (!md.empty()) ++r.pages_ok;
            step["markdown_chars"] = md.size();
        } else {
            step["error"] = "no markdown in tool result";
        }
        r.steps.push_back(std::move(step));

        if (static_cast<int>(md_all.str().size()) >= total_cap) break;
    }

    r.markdown_context = truncate_with_marker(md_all.str(), static_cast<std::size_t>(total_cap));
    // Only "used" when at least one real page produced markdown (not empty shell).
    r.used = r.pages_ok > 0;
    if (!r.used) {
        r.markdown_context.clear();
        if (r.error.empty()) {
            if (urls.empty()) {
                r.error = "no urls and search returned no results";
            } else {
                r.error = "web fetch/explore produced no markdown pages";
            }
        }
    }
    return r;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
