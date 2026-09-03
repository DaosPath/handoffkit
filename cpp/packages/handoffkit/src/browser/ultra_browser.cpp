#include <handoffkit/browser/ultra_browser.hpp>
#include <handoffkit/browser/explorer.hpp>
#include <handoffkit/browser/html_extract.hpp>
#include <handoffkit/browser/page.hpp>
#include <handoffkit/browser/rank.hpp>
#include <handoffkit/browser/util.hpp>

#include <algorithm>
#include <chrono>
#include <iostream>
#include <regex>
#include <set>
#include <sstream>

namespace handoffkit {
namespace browser {

namespace {

std::string clean_query(std::string_view q) {
    std::string s(q);
    s = std::regex_replace(s, std::regex(R"([\r\n\t]+)"), " ");
    s = std::regex_replace(s, std::regex(R"(\s+)"), " ");
    while (!s.empty() && s.front() == ' ') s.erase(s.begin());
    while (!s.empty() && s.back() == ' ') s.pop_back();
    return s;
}

std::string format_table_matrix(std::string_view raw_md) {
    std::string out(raw_md);
    // Ensure table headers and divider rows have crisp spacing
    out = std::regex_replace(out, std::regex(R"(\|[\t ]*\|)"), "| |");
    return out;
}

}  // namespace

UltraBrowser::UltraBrowser(UltraBrowserConfig config, TransportPtr transport)
    : config_(std::move(config)), transport_(transport ? transport : make_transport("http")) {}

std::vector<std::string> UltraBrowser::plan_sub_queries(std::string_view task) {
    std::vector<std::string> queries;
    std::string clean_task = clean_query(task);

    // 1. Core concise primary query
    std::string primary = make_search_query_from_task(clean_task, 120);
    if (!primary.empty()) queries.push_back(primary);

    // 2. Specialized domain regex search (Financial 10-K/10-Q, SEC, Medical guidelines, Technical standards)
    std::regex domain_pattern(
        R"(\b(10-K|10-Q|8-K|Q[1-4]\s+\d{4}|\d{4}\s+Annual Report|SEBI|FDA|NIST|AS/NZS|NEPSY-II|WISC-V|TWFE|Did2s|Callaway|Sant'Anna)\b)",
        std::regex::icase);
    auto words_begin = std::sregex_iterator(clean_task.begin(), clean_task.end(), domain_pattern);
    auto words_end = std::sregex_iterator();

    std::string domain_terms;
    for (std::sregex_iterator i = words_begin; i != words_end; ++i) {
        std::smatch match = *i;
        domain_terms += " " + match.str();
    }

    if (!domain_terms.empty()) {
        std::string sub2 = clean_query(primary + domain_terms);
        if (sub2 != primary && queries.size() < static_cast<std::size_t>(config_.max_sub_queries)) {
            queries.push_back(sub2);
        }
    }

    // 3. Sentence-level decomposition
    std::stringstream ss(clean_task);
    std::string line;
    while (std::getline(ss, line)) {
        line = clean_query(line);
        if (line.size() > 15 && queries.size() < static_cast<std::size_t>(config_.max_sub_queries)) {
            std::string line_q = make_search_query_from_task(line, 100);
            if (!line_q.empty() && std::find(queries.begin(), queries.end(), line_q) == queries.end()) {
                queries.push_back(line_q);
            }
        }
    }

    // 4. Multi-hop Deep Research Decomposition (Generates up to 30 targeted sub-queries)
    static const char* search_angles[] = {
        "technical specifications architectural overview",
        "official documentation data sheet specs",
        "performance benchmarks throughput latency",
        "financial metrics balance sheet quarterly report",
        "10-Q filing SEC EDGAR table report",
        "10-K annual report revenue breakdown",
        "clinical guidelines medical efficacy trials",
        "comparative analysis alternative models",
        "historical development evolution timeline",
        "regulatory compliance standards framework",
        "hardware requirements system architecture",
        "troubleshooting common issues edge cases",
        "pricing cost analysis licensing terms",
        "case studies enterprise deployment",
        "security vulnerabilities threat model",
        "api reference integration guide code example",
        "implementation details best practices",
        "future roadmap planned features 2026",
        "quantitative metrics data table matrix",
        "academic research paper methodology",
        "expert reviews community feedback rating",
        "installation configuration setup guide",
        "database schema data storage model",
        "network protocol latency bandwidth",
        "memory consumption RAM VRAM optimization",
        "open source repository GitHub releases",
        "vendor documentation release notes",
        "industry standards ISO IEEE NIST certification"
    };

    for (const char* angle : search_angles) {
        if (queries.size() >= static_cast<std::size_t>(config_.max_sub_queries)) break;
        std::string extra_q = clean_query(primary + " " + angle);
        if (std::find(queries.begin(), queries.end(), extra_q) == queries.end()) {
            queries.push_back(extra_q);
        }
    }

    if (queries.empty()) {
        queries.push_back(clean_task.substr(0, std::min<std::size_t>(clean_task.size(), 120)));
    }

    return queries;
}

std::vector<std::string> UltraBrowser::generate_reflection_queries(
    std::string_view task, const std::vector<PageMarkdown>& current_pages) {
    std::vector<std::string> reflection_queries;
    if (current_pages.empty()) return reflection_queries;

    // Build combined text snippet from existing pages
    std::string combined_evidence;
    for (const auto& p : current_pages) {
        combined_evidence += p.markdown + " ";
    }
    std::string low_evidence = combined_evidence;
    std::transform(low_evidence.begin(), low_evidence.end(), low_evidence.begin(), ::tolower);

    // Look for missing key requirements in financial/medical/technical tasks
    static const struct {
        const char* key_term;
        const char* query_suffix;
    } checks[] = {
        {"10-q", "10-Q filing quarterly financial report"},
        {"10-k", "10-K annual report financial metrics"},
        {"interest expense", "interest expense breakdown debt report"},
        {"fair value", "fair value swap balance sheet"},
        {"margin", "operating margin breakdown"},
        {"guidelines", "clinical guidelines official documentation"},
        {"benchmark", "performance benchmark comparison specs"},
        {"specification", "technical specifications data sheet"},
    };

    std::string task_low(task);
    std::transform(task_low.begin(), task_low.end(), task_low.begin(), ::tolower);

    for (const auto& c : checks) {
        if (task_low.find(c.key_term) != std::string::npos && low_evidence.find(c.key_term) == std::string::npos) {
            std::string q = clean_query(std::string(make_search_query_from_task(task, 60)) + " " + c.query_suffix);
            if (!q.empty()) reflection_queries.push_back(q);
        }
    }

    return reflection_queries;
}

WebResearchResult UltraBrowser::execute() {
    WebResearchResult res;
    res.enabled = true;
    res.used = false;
    res.mode = "ultra_pro_deep_research";
    res.transport = transport_ ? transport_->name() : "http";

    if (config_.task.empty()) {
        res.error = "empty task provided to UltraProBrowser";
        return res;
    }

    // Step 1: Initial Sub-Query Planning
    std::vector<std::string> sub_queries = plan_sub_queries(config_.task);
    res.queries = sub_queries;

    std::set<std::string> visited_urls;
    std::vector<PageMarkdown> accumulated_pages;
    int current_hop = 0;

    // Step 2: Multi-Hop Iterative Search Loop
    auto process_query_list = [&](const std::vector<std::string>& q_list) {
        for (const auto& q : q_list) {
            if (current_hop >= config_.max_depth) break;
            if (static_cast<int>(accumulated_pages.size()) >= config_.max_pages_per_hop * config_.max_depth) break;

            nlohmann::json search_res = web_search(q, transport_, 8, config_.timeout_ms);
            res.tool_calls++;

            // The canonical Browser Lite search contract is `results`; the old
            // `hits` spelling made this experimental route silently empty.
            if (!search_res.contains("results") || !search_res["results"].is_array()) continue;

            std::vector<std::string> hop_urls;
            for (const auto& hit : search_res["results"]) {
                if (hit.contains("url") && hit["url"].is_string()) {
                    std::string url = hit["url"].get<std::string>();
                    if (visited_urls.find(url) == visited_urls.end()) {
                        visited_urls.insert(url);
                        hop_urls.push_back(url);
                        if (static_cast<int>(hop_urls.size()) >= config_.max_pages_per_hop) break;
                    }
                }
            }

            for (const auto& url : hop_urls) {
                ExplorePolicy pol;
                pol.max_depth = 0;
                pol.max_pages = 1;
                pol.timeout_ms = config_.timeout_ms;
                pol.emit_markdown = true;

                auto fetch_res = web_fetch(url, transport_, pol);
                res.tool_calls++;

                if (fetch_res && fetch_res.value().success) {
                    PageMarkdown pm = PageMarkdown::from_explore_result(fetch_res.value(), 60000);
                    if (!pm.markdown.empty()) {
                        pm.markdown = format_table_matrix(pm.markdown);
                        res.urls_fetched.push_back(url);
                        accumulated_pages.push_back(pm);
                        res.pages_ok++;

                        nlohmann::json step;
                        step["hop"] = current_hop;
                        step["query"] = q;
                        step["url"] = url;
                        step["title"] = pm.title;
                        step["chars"] = pm.markdown.size();
                        res.steps.push_back(step);
                    }
                }
            }

            current_hop++;
        }
    };

    // Execute initial query batch
    process_query_list(sub_queries);

    // Step 3: Reflection & Coverage Auditor Pass
    if (config_.enable_reflection && current_hop < config_.max_depth) {
        std::vector<std::string> reflection_queries = generate_reflection_queries(config_.task, accumulated_pages);
        if (!reflection_queries.empty()) {
            for (const auto& rq : reflection_queries) {
                if (std::find(res.queries.begin(), res.queries.end(), rq) == res.queries.end()) {
                    res.queries.push_back(rq);
                }
            }
            process_query_list(reflection_queries);
        }
    }

    res.pages = accumulated_pages;

    // Step 4: Synthesize Extended Dense Markdown Context Buffer (128KB Cap)
    std::string context;
    context.reserve(config_.context_max_chars);

    context += "# ULTRA-PRO BROWSER DEEP RESEARCH EVIDENCE\n\n";
    context += "Total Targeted Queries Executed: " + std::to_string(res.queries.size()) + "\n";
    context += "Total Verified Source Pages: " + std::to_string(accumulated_pages.size()) + "\n";
    context += "Reflection Audit Loop: " + std::string(config_.enable_reflection ? "ACTIVE" : "DISABLED") + "\n\n";

    for (std::size_t i = 0; i < accumulated_pages.size(); ++i) {
        const auto& p = accumulated_pages[i];
        std::string section = "--- SOURCE [" + std::to_string(i + 1) + "]: " + p.title + " ---\n";
        section += "URL: " + p.url + "\n\n";
        section += p.markdown + "\n\n";

        if (context.size() + section.size() > static_cast<std::size_t>(config_.context_max_chars)) {
            std::size_t remaining = static_cast<std::size_t>(config_.context_max_chars) - context.size();
            if (remaining > 200) {
                context += section.substr(0, remaining);
                context += "\n...[TRUNCATED ULTRA-PRO DEEP RESEARCH CONTEXT]...\n";
            }
            break;
        }
        context += section;

        nlohmann::json citation;
        citation["index"] = i + 1;
        citation["title"] = p.title;
        citation["url"] = p.url;
        res.citations.push_back(citation);
    }

    res.markdown_context = std::move(context);
    res.used = res.pages_ok > 0 || !res.queries.empty();
    if (res.pages_ok == 0 && res.error.empty()) {
        res.error = "no pages fetched successfully";
    }
    return res;
}

WebResearchResult gather_ultra_web_research(const UltraBrowserConfig& config, TransportPtr transport) {
    UltraBrowser ub(config, transport);
    return ub.execute();
}

}  // namespace browser
}  // namespace handoffkit
