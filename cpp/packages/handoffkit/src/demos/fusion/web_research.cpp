#include <handoffkit/demos/fusion/web_research.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/text_pipeline.hpp>
#include <handoffkit/util/text.hpp>
#include <handoffkit/browser/explorer.hpp>
#include <handoffkit/browser/html_extract.hpp>
#include <handoffkit/browser/tools.hpp>
#include <handoffkit/browser/research.hpp>

#include <algorithm>
#include <cctype>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {

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
    // Collapse whitespace (trimmed: the shared helper keeps one edge space)
    std::string out = text::trim(collapse_whitespace(s));
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

ToolRegistry make_fusion_web_tool_registry(browser::TransportPtr transport) {
    ToolRegistry reg;
    browser::register_browser_tools(reg, transport);
    return reg;
}

browser::SearxngOptions fusion_searxng_options(const FusionConfig& config) {
    browser::SearxngOptions options;
    options.base_urls = config.web_searxng_urls;
    options.engines = config.web_searxng_engines;
    options.categories = config.web_searxng_categories;
    options.language = config.web_searxng_language;
    options.safesearch = config.web_searxng_safesearch;
    options.page = std::max(1, config.web_searxng_page);
    return options;
}

nlohmann::json fusion_searxng_tool_arg(const FusionConfig& config) {
    nlohmann::json arg = nlohmann::json::object();
    if (!config.web_searxng_urls.empty()) arg["base_urls"] = config.web_searxng_urls;
    if (!config.web_searxng_engines.empty()) arg["engines"] = config.web_searxng_engines;
    if (!config.web_searxng_categories.empty()) arg["categories"] = config.web_searxng_categories;
    if (!config.web_searxng_language.empty()) arg["language"] = config.web_searxng_language;
    if (config.web_searxng_safesearch >= 0) arg["safesearch"] = config.web_searxng_safesearch;
    if (config.web_searxng_page > 1) arg["page"] = config.web_searxng_page;
    return arg;
}

WebResearchResult gather_web_research(const FusionConfig& config) {
    browser::TransportPtr t;
    if (config.web_transport == "map" || config.web_transport == "fixture" ||
        config.web_transport == "stub" || config.web_transport == "offline") {
        t = browser::make_fixture_map_transport();
    } else {
        t = browser::make_transport(config.web_transport.empty() ? "http" : config.web_transport);
    }
    return gather_web_research(config, t);
}

WebResearchResult gather_web_research(const FusionConfig& config, browser::TransportPtr transport) {
    WebResearchResult r;
    r.enabled = config.enable_web_tools;
    r.transport = transport ? transport->name() : "";
    if (!config.enable_web_tools) return r;
    if (!transport) {
        r.error = "no web transport";
        return r;
    }

    if (config.web_max_depth >= 2 || config.web_max_pages >= 6) {
        // Deep Fusion research uses the canonical Browser Lite route. The old
        // UltraBrowser implementation remains available as an explicitly
        // experimental API, but is no longer a second Fusion data path.
        browser::WebResearchConfig bcfg;
        bcfg.query = config.web_search_query;
        bcfg.task = config.task;
        bcfg.seed_urls = config.seed_urls;
        bcfg.auto_search = config.web_auto_search;
        bcfg.max_pages = config.web_max_pages;
        bcfg.max_depth = config.web_max_depth;
        bcfg.timeout_ms = config.web_timeout_ms > 0 ? config.web_timeout_ms : 20000;
        bcfg.context_max_chars = std::max(1000, config.web_context_max_chars);
        bcfg.prefer_explore = config.web_prefer_explore;
        bcfg.providers = config.web_providers;
        bcfg.searxng = fusion_searxng_options(config);
        bcfg.max_sub_queries = 3;
        bcfg.max_results_per_query = 8;

        auto deep = browser::gather_deep_web_research(bcfg, transport);
        r.used = deep.used;
        r.queries = deep.queries;
        r.urls_fetched = deep.urls_fetched;
        r.markdown_context = deep.markdown_context;
        r.steps = deep.steps;
        r.pages_ok = deep.pages_ok;
        r.tool_calls = deep.tool_calls;
        r.error = deep.error;
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
            if (!config.web_providers.empty()) sc.arguments["providers"] = config.web_providers;
            const auto searxng_arg = fusion_searxng_tool_arg(config);
            if (!searxng_arg.empty()) sc.arguments["searxng"] = searxng_arg;
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
