#include <handoffkit/browser/research.hpp>
#include <handoffkit/browser/explorer.hpp>
#include <handoffkit/browser/html_extract.hpp>
#include <handoffkit/browser/rank.hpp>
#include <handoffkit/browser/util.hpp>
#include <handoffkit/browser/page.hpp>
#include <handoffkit/util/text.hpp>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cctype>
#include <functional>
#include <regex>
#include <sstream>
#include <thread>
#include <utility>

namespace handoffkit {
namespace browser {
namespace {

using Clock = std::chrono::steady_clock;

int64_t elapsed_ms(Clock::time_point start) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - start).count();
}

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
            const int hi = hex(s[i + 1]);
            const int lo = hex(s[i + 2]);
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

bool is_stopword(const std::string& w) {
    static const char* k[] = {
        "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "that", "this", "was",
        "were", "is", "are", "had", "have", "has", "with", "its", "it", "as", "by", "from", "what",
        "which", "who", "when", "where", "how", "name", "title", "old", "new", "been", "be", "do",
        "does", "did", "into", "about", "over", "under", "their", "there", "these", "those", "than",
        "then", "them", "they", "you", "your", "our", "we", "i", "me", "my",
    };
    for (const char* s : k) {
        if (w == s) return true;
    }
    return false;
}

std::string strip_tags(std::string_view html) {
    static const std::regex kTags(R"(<[^>]+>)");
    static const std::regex kSpaces(R"(\s+)");
    std::string out(html);
    out = std::regex_replace(out, kTags, " ");
    out = std::regex_replace(out, kSpaces, " ");
    while (!out.empty() && out.front() == ' ') out.erase(out.begin());
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

void push_hit(std::vector<std::pair<std::string, std::string>>& hits, std::string title, std::string url,
              int max_results) {
    if (static_cast<int>(hits.size()) >= max_results) return;
    if (url.rfind("http", 0) != 0) return;
    if (url.find("duckduckgo.com") != std::string::npos) return;
    if (url.find("wikipedia.org/w/api.php") != std::string::npos) return;
    url = canonical_url(url);
    std::string low_url = url;
    std::transform(low_url.begin(), low_url.end(), low_url.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (low_url.find("googleadservices.com") != std::string::npos ||
        low_url.find("doubleclick.net") != std::string::npos ||
        low_url.find("/aclk?") != std::string::npos ||
        low_url.find("/pagead/") != std::string::npos ||
        low_url.find("adurl=") != std::string::npos ||
        low_url.find("/ads/") != std::string::npos ||
        (low_url.size() >= 4 && low_url.ends_with("/ads"))) {
        return;
    }
    for (auto& h : hits) {
        if (h.second == url) {
            if (h.first.empty() && !title.empty()) h.first = std::move(title);
            return;
        }
    }
    hits.emplace_back(std::move(title), std::move(url));
}

/// GET JSON with bounded retries on 429/5xx (250ms exponential backoff).
/// Returns {parsed, error_code, error}; parsed is null on failure.
struct JsonFetch {
    nlohmann::json data = nullptr;
    std::string error_code;
    std::string error;
};

bool retryable_status(int status) {
    return status == 408 || status == 425 || status == 429 ||
           status == 500 || status == 502 || status == 503 || status == 504;
}

JsonFetch fetch_json(TransportPtr transport, const std::string& url,
                     const std::unordered_map<std::string, std::string>& headers,
                     int timeout_ms, const std::string& provider, int attempts = 3) {
    JsonFetch out;
    out.error_code = provider + "_empty_response";
    out.error = provider + " returned no JSON results";
    const int rounds = std::max(1, attempts);
    for (int attempt = 1; attempt <= rounds; ++attempt) {
        TransportRequest req;
        req.url = url;
        req.timeout_ms = timeout_ms > 0 ? timeout_ms : 20000;
        req.headers["User-Agent"] = "HandoffKit-Browser/1.0";
        req.headers["Accept"] = "application/json";
        for (const auto& [key, value] : headers) req.headers[key] = value;
        nlohmann::json data = nullptr;
        bool fetched = false;
        try {
            const auto resp = transport->get(req);
            if (!resp.error.empty()) {
                out.error_code = provider + "_transport_error";
                out.error = resp.error;
                return out;
            }
            if (resp.status < 200 || resp.status >= 300 || resp.body.empty()) {
                out.error_code = provider + "_empty_response";
                out.error = provider + " returned no JSON results";
                if (!retryable_status(resp.status) || attempt >= rounds) return out;
            } else {
                try {
                    data = nlohmann::json::parse(resp.body);
                    fetched = true;
                } catch (...) {
                    out.error_code = provider + "_invalid_response";
                    out.error = provider + " returned invalid JSON";
                    return out;
                }
            }
        } catch (const std::exception& e) {
            out.error_code = provider + "_transport_error";
            out.error = e.what();
            return out;
        }
        if (fetched) {
            out.data = std::move(data);
            out.error_code.clear();
            out.error.clear();
            return out;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(250 * (1 << (attempt - 1))));
    }
    return out;
}

std::vector<std::pair<std::string, std::string>> wikipedia_opensearch(TransportPtr transport,
                                                                      std::string_view query,
                                                                      int max_results, int timeout_ms) {
    std::vector<std::pair<std::string, std::string>> hits;
    if (!transport || query.empty() || max_results < 1) return hits;

    std::string q(query);
    const std::string kw = keyword_compress(query, 8);
    if (!kw.empty() && kw.size() + 10 < q.size()) q = kw;

    const std::string api =
        "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=" +
        std::to_string(max_results) + "&search=" + url_encode_component(q);

    TransportRequest req;
    req.url = api;
    req.timeout_ms = timeout_ms > 0 ? timeout_ms : 15000;
    req.headers["User-Agent"] = "HandoffKit-Browser/1.0";
    req.headers["Accept"] = "application/json";
    const auto resp = transport->get(req);
    if (!resp.error.empty() || resp.status < 200 || resp.status >= 300 || resp.body.empty()) {
        return hits;
    }

    try {
        const auto j = nlohmann::json::parse(resp.body);
        if (!j.is_array() || j.size() < 4 || !j[1].is_array() || !j[3].is_array()) {
            return hits;
        }
        const auto& titles = j[1];
        const auto& urls = j[3];
        const std::size_t n =
            std::min({titles.size(), urls.size(), static_cast<std::size_t>(max_results)});
        for (std::size_t i = 0; i < n; ++i) {
            if (!titles[i].is_string() || !urls[i].is_string()) continue;
            push_hit(hits, titles[i].get<std::string>(), urls[i].get<std::string>(), max_results);
        }
    } catch (...) {
        return hits;
    }
    return hits;
}

namespace {

std::vector<std::string> split_option_list(const std::string& value) {
    std::vector<std::string> out;
    std::string current;
    for (char c : value) {
        if (c == ',') {
            if (!current.empty()) { out.push_back(current); current.clear(); }
        } else if (!std::isspace(static_cast<unsigned char>(c))) {
            current.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
        }
    }
    if (!current.empty()) out.push_back(current);
    return out;
}

std::string getenv_str(const char* name) {
    const char* value = std::getenv(name);
    return value ? std::string(value) : std::string{};
}

bool valid_engine_token(const std::string& token) {
    if (token.empty()) return false;
    for (char c : token) {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                        c == '_' || c == '+' || c == '-';
        if (!ok) return false;
    }
    return true;
}

}  // namespace

struct SearxngOptions {
    std::vector<std::string> base_urls;
    std::string base_url;
    std::vector<std::string> engines;
    std::vector<std::string> categories;
    int page = 1;
    int safesearch = -1;  // -1 = unset, else 0..2
    std::string language;
};

std::vector<std::pair<std::string, std::string>> searxng_json_search(TransportPtr transport,
                                                                       std::string_view query,
                                                                       int max_results, int timeout_ms,
                                                                       SearxngOptions options);

std::vector<std::pair<std::string, std::string>> searxng_json_search(TransportPtr transport,
                                                                       std::string_view query,
                                                                       int max_results, int timeout_ms,
                                                                       SearxngOptions options) {
    std::vector<std::pair<std::string, std::string>> hits;
    if (!transport || query.empty() || max_results < 1) return hits;
    std::vector<std::string> bases;
    for (auto base : options.base_urls) {
        while (!base.empty() && base.back() == '/') base.pop_back();
        if (!base.empty()) bases.push_back(std::move(base));
    }
    if (!options.base_url.empty()) {
        auto base = options.base_url;
        while (!base.empty() && base.back() == '/') base.pop_back();
        if (!base.empty()) bases.push_back(std::move(base));
    }
    for (const auto& env_base : split_option_list(getenv_str("HANDOFFKIT_SEARXNG_URLS"))) {
        auto base = env_base;
        while (!base.empty() && base.back() == '/') base.pop_back();
        if (!base.empty()) bases.push_back(std::move(base));
    }
    {
        auto base = getenv_str("HANDOFFKIT_SEARXNG_URL");
        while (!base.empty() && base.back() == '/') base.pop_back();
        if (!base.empty()) bases.push_back(std::move(base));
    }
    if (bases.empty()) return hits;  // unconfigured => empty in C++ (provider layer reports error)
    std::vector<std::string> engines = options.engines.empty()
        ? split_option_list(getenv_str("HANDOFFKIT_SEARXNG_ENGINES"))
        : options.engines;
    for (const auto& token : engines) {
        if (!valid_engine_token(token)) return hits;  // fail closed on bad engine
    }
    static const char* kCategories[] = {"general", "images", "videos", "news"};
    for (const auto& category : options.categories) {
        bool known = false;
        for (const char* known_category : kCategories) {
            if (category == known_category) { known = true; break; }
        }
        if (!known) return hits;  // fail closed on unknown category
    }
    if (options.page < 1) return hits;
    if (options.safesearch < -1 || options.safesearch > 2) return hits;
    std::string extra;
    if (!engines.empty()) {
        extra += "&engines=";
        for (std::size_t i = 0; i < engines.size(); ++i) {
            if (i) extra.push_back(',');
            extra += url_encode_component(engines[i]);
        }
    }
    if (!options.categories.empty()) {
        extra += "&categories=";
        for (std::size_t i = 0; i < options.categories.size(); ++i) {
            if (i) extra.push_back(',');
            extra += url_encode_component(options.categories[i]);
        }
    }
    if (options.page > 1) extra += "&pageno=" + std::to_string(options.page);
    if (options.safesearch >= 0) extra += "&safesearch=" + std::to_string(options.safesearch);
    std::unordered_map<std::string, std::string> headers;
    headers["User-Agent"] = "HandoffKit-Browser/1.0";
    headers["Accept"] = "application/json";
    if (!options.language.empty()) {
        extra += "&language=" + url_encode_component(options.language);
        headers["Accept-Language"] = options.language;
    }
    const std::string query_encoded = url_encode_component(std::string(query));
    for (const auto& base : bases) {
        const std::string url = base + "/search?q=" + query_encoded + "&format=json" + extra;
        auto fetched = fetch_json(transport, url, headers, timeout_ms, "searxng");
        if (!fetched.error_code.empty()) continue;
        const auto& j = fetched.data;
        const auto it = j.find("results");
        std::vector<std::pair<std::string, std::string>> attempt;
        if (it != j.end() && it->is_array()) {
            for (const auto& item : *it) {
                if (static_cast<int>(attempt.size()) >= max_results) break;
                if (!item.is_object()) continue;
                const auto u = item.find("url");
                const auto t = item.find("title");
                if (u == item.end() || !u->is_string()) continue;
                std::string surl = u->get<std::string>();
                if (surl.rfind("http://", 0) != 0 && surl.rfind("https://", 0) != 0) continue;
                std::string title;
                if (t != item.end() && t->is_string()) title = strip_tags(t->get<std::string>());
                if (title.empty()) title = surl;
                push_hit(attempt, std::move(title), std::move(surl), max_results);
            }
        }
        const auto boxes = j.find("infoboxes");
        if (boxes != j.end() && boxes->is_array()) {
            for (const auto& box : *boxes) {
                if (!box.is_object()) continue;
                const auto links = box.find("urls");
                if (links == box.end() || !links->is_array()) continue;
                const auto content = box.find("content");
                const std::string fallback = content != box.end() && content->is_string()
                    ? strip_tags(content->get<std::string>()) : std::string{};
                for (const auto& link : *links) {
                    if (static_cast<int>(attempt.size()) >= max_results) break;
                    if (!link.is_object()) continue;
                    const auto u = link.find("url");
                    if (u == link.end() || !u->is_string()) continue;
                    std::string surl = u->get<std::string>();
                    if (surl.rfind("http://", 0) != 0 && surl.rfind("https://", 0) != 0) continue;
                    const auto t = link.find("title");
                    std::string title = (t != link.end() && t->is_string())
                        ? strip_tags(t->get<std::string>()) : fallback;
                    if (title.empty()) title = surl;
                    push_hit(attempt, std::move(title), std::move(surl), max_results);
                }
                if (static_cast<int>(attempt.size()) >= max_results) break;
            }
        }
        if (!attempt.empty()) return attempt;
    }
    return hits;
}

std::vector<std::pair<std::string, std::string>> searxng_json_search(TransportPtr transport,
                                                                       std::string_view query,
                                                                       int max_results, int timeout_ms) {
    SearxngOptions options;
    options.base_urls = split_option_list(getenv_str("HANDOFFKIT_SEARXNG_URLS"));
    options.engines = split_option_list(getenv_str("HANDOFFKIT_SEARXNG_ENGINES"));
    return searxng_json_search(transport, query, max_results, timeout_ms, std::move(options));
}

/// Key-gated JSON provider helper: env key or fail-closed empty.
std::vector<std::pair<std::string, std::string>> keyed_json_search(
    TransportPtr transport, std::string_view query, int max_results, int timeout_ms,
    const std::string& provider, const std::string& url,
    const std::unordered_map<std::string, std::string>& extra_headers,
    const std::function<void(const nlohmann::json&,
                             std::vector<std::pair<std::string, std::string>>&, int)>& parse) {
    std::vector<std::pair<std::string, std::string>> hits;
    if (!transport || query.empty() || max_results < 1) return hits;
    auto fetched = fetch_json(transport, url, extra_headers, timeout_ms, provider);
    if (!fetched.error_code.empty()) return hits;
    try {
        parse(fetched.data, hits, max_results);
    } catch (...) {
        hits.clear();
    }
    return hits;
}

std::vector<std::pair<std::string, std::string>> brave_json_search(TransportPtr transport,
                                                                     std::string_view query,
                                                                     int max_results, int timeout_ms) {
    const std::string key = getenv_str("HANDOFFKIT_BRAVE_API_KEY");
    if (key.empty() || !transport || query.empty() || max_results < 1) return {};
    const int count = std::max(1, std::min(max_results, 20));
    const std::string url = "https://api.search.brave.com/res/v1/web/search?q=" +
                            url_encode_component(std::string(query)) + "&count=" + std::to_string(count);
    return keyed_json_search(transport, query, max_results, timeout_ms, "brave", url,
                             {{"X-Subscription-Token", key}},
                             [](const nlohmann::json& data,
                                std::vector<std::pair<std::string, std::string>>& hits, int max_results) {
                                 const auto web = data.find("web");
                                 if (web == data.end()) return;
                                 const auto results = web->find("results");
                                 if (results == web->end() || !results->is_array()) return;
                                 for (const auto& item : *results) {
                                     if (static_cast<int>(hits.size()) >= max_results) break;
                                     if (!item.is_object()) continue;
                                     const auto u = item.find("url");
                                     if (u == item.end() || !u->is_string()) continue;
                                     std::string surl = u->get<std::string>();
                                     if (surl.rfind("http", 0) != 0) continue;
                                     const auto t = item.find("title");
                                     std::string title = (t != item.end() && t->is_string())
                                         ? strip_tags(t->get<std::string>()) : surl;
                                     push_hit(hits, std::move(title), std::move(surl), max_results);
                                 }
                             });
}

std::vector<std::pair<std::string, std::string>> bing_json_search(TransportPtr transport,
                                                                    std::string_view query,
                                                                    int max_results, int timeout_ms) {
    const std::string key = getenv_str("HANDOFFKIT_BING_API_KEY");
    if (key.empty() || !transport || query.empty() || max_results < 1) return {};
    const int count = std::max(1, std::min(max_results, 20));
    const std::string url = "https://api.bing.microsoft.com/v7.0/search?q=" +
                            url_encode_component(std::string(query)) + "&count=" + std::to_string(count) +
                            "&responseFilter=Webpages";
    return keyed_json_search(transport, query, max_results, timeout_ms, "bing", url,
                             {{"Ocp-Apim-Subscription-Key", key}},
                             [](const nlohmann::json& data,
                                std::vector<std::pair<std::string, std::string>>& hits, int max_results) {
                                 const auto pages = data.find("webPages");
                                 if (pages == data.end()) return;
                                 const auto values = pages->find("value");
                                 if (values == pages->end() || !values->is_array()) return;
                                 for (const auto& item : *values) {
                                     if (static_cast<int>(hits.size()) >= max_results) break;
                                     if (!item.is_object()) continue;
                                     const auto u = item.find("url");
                                     if (u == item.end() || !u->is_string()) continue;
                                     std::string surl = u->get<std::string>();
                                     if (surl.rfind("http", 0) != 0) continue;
                                     const auto t = item.find("name");
                                     std::string title = (t != item.end() && t->is_string())
                                         ? strip_tags(t->get<std::string>()) : surl;
                                     push_hit(hits, std::move(title), std::move(surl), max_results);
                                 }
                             });
}

std::vector<std::pair<std::string, std::string>> kagi_json_search(TransportPtr transport,
                                                                    std::string_view query,
                                                                    int max_results, int timeout_ms) {
    const std::string key = getenv_str("HANDOFFKIT_KAGI_API_KEY");
    if (key.empty() || !transport || query.empty() || max_results < 1) return {};
    const std::string url = "https://kagi.com/api/v0/search?q=" + url_encode_component(std::string(query));
    return keyed_json_search(transport, query, max_results, timeout_ms, "kagi", url,
                             {{"Authorization", "Bot " + key}},
                             [](const nlohmann::json& data,
                                std::vector<std::pair<std::string, std::string>>& hits, int max_results) {
                                 const auto results = data.find("data");
                                 if (results == data.end() || !results->is_array()) return;
                                 for (const auto& item : *results) {
                                     if (static_cast<int>(hits.size()) >= max_results) break;
                                     if (!item.is_object()) continue;
                                     const auto u = item.find("url");
                                     if (u == item.end() || !u->is_string()) continue;
                                     std::string surl = u->get<std::string>();
                                     if (surl.rfind("http", 0) != 0) continue;
                                     const auto t = item.find("title");
                                     std::string title = (t != item.end() && t->is_string())
                                         ? strip_tags(t->get<std::string>()) : surl;
                                     push_hit(hits, std::move(title), std::move(surl), max_results);
                                 }
                             });
}

std::vector<std::pair<std::string, std::string>> scrape_anchor_hits(
    const std::string& html, int max_results, const std::vector<std::string>& exclude_hosts) {
    std::vector<std::pair<std::string, std::string>> hits;
    std::size_t pos = 0;
    while (static_cast<int>(hits.size()) < max_results) {
        const auto anchor = html.find("<a", pos);
        if (anchor == std::string::npos) break;
        const auto tag_end = html.find('>', anchor);
        if (tag_end == std::string::npos) break;
        const std::string tag = html.substr(anchor, tag_end - anchor);
        std::string href;
        for (const char* quote : {"\"", "'"}) {
            const std::string key = std::string("href=") + quote;
            const auto hpos = tag.find(key);
            if (hpos != std::string::npos) {
                const auto start = hpos + key.size();
                const auto end = tag.find(quote[0], start);
                if (end != std::string::npos) href = tag.substr(start, end - start);
                break;
            }
        }
        const auto close = html.find("</a>", tag_end);
        std::string title = (close == std::string::npos) ? "" : strip_tags(html.substr(tag_end + 1, close - tag_end - 1));
        pos = (close == std::string::npos) ? tag_end + 1 : close + 4;
        if (href.rfind("http", 0) != 0 || title.size() < 2) continue;
        const auto scheme = href.find("://");
        const auto host_start = scheme == std::string::npos ? 0 : scheme + 3;
        const auto host_end = href.find('/', host_start);
        std::string host = text::to_lower(href.substr(host_start, host_end == std::string::npos ? host_end : host_end - host_start));
        bool excluded = false;
        for (const auto& domain : exclude_hosts) {
            if (host == domain || (host.size() > domain.size() + 1 &&
                host.compare(host.size() - domain.size() - 1, domain.size() + 1, "." + domain) == 0)) {
                excluded = true;
                break;
            }
        }
        if (excluded) continue;
        push_hit(hits, std::move(title), std::move(href), max_results);
    }
    return hits;
}

std::vector<std::pair<std::string, std::string>> html_engine_search(
    TransportPtr transport, std::string_view query, int max_results, int timeout_ms,
    const std::string& provider, const std::string& url,
    const std::vector<std::string>& exclude_hosts) {
    (void)provider;  // used by callers for error context; transport is provider-agnostic here
    std::vector<std::pair<std::string, std::string>> hits;
    if (!transport || query.empty() || max_results < 1) return hits;
    TransportRequest req;
    req.url = url;
    req.timeout_ms = timeout_ms > 0 ? timeout_ms : 20000;
    req.headers["User-Agent"] = "HandoffKit-Browser/1.0";
    req.headers["Accept"] = "text/html,application/xhtml+xml";
    try {
        const auto resp = transport->get(req);
        if (!resp.error.empty() || resp.status < 200 || resp.status >= 300 || resp.body.empty()) return hits;
        return scrape_anchor_hits(resp.body, max_results, exclude_hosts);
    } catch (...) {
        return hits;
    }
}

std::vector<std::pair<std::string, std::string>> mojeek_html_search(TransportPtr transport,
                                                                      std::string_view query,
                                                                      int max_results, int timeout_ms) {
    return html_engine_search(transport, query, max_results, timeout_ms, "mojeek",
                              "https://www.mojeek.com/search?q=" + url_encode_component(std::string(query)),
                              {"mojeek.com"});
}

std::vector<std::pair<std::string, std::string>> marginalia_html_search(TransportPtr transport,
                                                                          std::string_view query,
                                                                          int max_results, int timeout_ms) {
    return html_engine_search(transport, query, max_results, timeout_ms, "marginalia",
                              "https://search.marginalia.nu/search?query=" + url_encode_component(std::string(query)),
                              {"marginalia.nu", "marginalia-search.com"});
}

std::vector<std::pair<std::string, std::string>> startpage_html_search(TransportPtr transport,
                                                                         std::string_view query,
                                                                         int max_results, int timeout_ms) {
    return html_engine_search(transport, query, max_results, timeout_ms, "startpage",
                              "https://www.startpage.com/sp/search?query=" + url_encode_component(std::string(query)),
                              {"startpage.com", "startmail.com"});
}

std::vector<std::pair<std::string, std::string>> duckduckgo_html_search(TransportPtr transport,
                                                                        std::string_view query,
                                                                        int max_results, int timeout_ms) {
    std::vector<std::pair<std::string, std::string>> hits;
    if (!transport || query.empty() || max_results < 1) return hits;

    std::string q(query);
    const std::string kw = keyword_compress(query, 10);
    if (!kw.empty()) q = kw;

    const std::string url = "https://html.duckduckgo.com/html/?q=" + url_encode_component(q);

    TransportRequest req;
    req.url = url;
    req.timeout_ms = timeout_ms > 0 ? timeout_ms : 20000;
    req.headers["User-Agent"] = "HandoffKit-Browser/1.0";
    req.headers["Accept"] = "text/html,application/xhtml+xml";
    const auto resp = transport->get(req);
    if (!resp.error.empty() || resp.status < 200 || resp.status >= 300 || resp.body.empty()) {
        return hits;
    }

    const std::string& html = resp.body;

    std::size_t pos = 0;
    while (static_cast<int>(hits.size()) < max_results) {
        const auto a = html.find("result__a", pos);
        if (a == std::string::npos) break;
        auto href = html.find("href=\"", a);
        if (href == std::string::npos || href > a + 120) {
            pos = a + 8;
            continue;
        }
        href += 6;
        const auto hend = html.find('"', href);
        if (hend == std::string::npos) break;
        std::string link = html.substr(href, hend - href);
        if (link.find("uddg=") != std::string::npos) {
            const auto u = link.find("uddg=");
            link = url_decode_basic(link.substr(u + 5));
            const auto amp = link.find('&');
            if (amp != std::string::npos) link = link.substr(0, amp);
        }
        std::string title;
        const auto gt = html.find('>', hend);
        const auto close = gt == std::string::npos ? std::string::npos : html.find("</a>", gt);
        if (gt != std::string::npos && close != std::string::npos) {
            title = strip_tags(html.substr(gt + 1, close - gt - 1));
        }
        push_hit(hits, std::move(title), link, max_results);
        pos = hend;
    }

    pos = 0;
    while (static_cast<int>(hits.size()) < max_results) {
        const auto u = html.find("uddg=", pos);
        if (u == std::string::npos) break;
        std::size_t end = u + 5;
        while (end < html.size()) {
            const char c = html[end];
            if (c == '&' || c == '"' || c == '\'' || c == ' ' || c == '<' || c == '>') break;
            ++end;
        }
        const std::string dec = url_decode_basic(html.substr(u + 5, end - u - 5));
        push_hit(hits, {}, dec, max_results);
        pos = end;
    }
    return hits;
}

TransportPtr resolve_tool_transport(const nlohmann::json& args, TransportPtr default_transport) {
    if (args.contains("transport") && args["transport"].is_string()) {
        const auto kind = args["transport"].get<std::string>();
        // Preserve an injected fixture/map transport. Creating a fresh map
        // here would discard its pages and make `transport: map` appear to
        // fail even though the registry was configured with fixtures.
        if ((kind == "map" || kind == "fixture" || kind == "stub" || kind == "offline") &&
            default_transport && default_transport->name() == "map") {
            return default_transport;
        }
        return make_transport(kind);
    }
    return default_transport ? default_transport : make_transport("http");
}

PageMarkdown page_from_cache_json(const nlohmann::json& j) {
    PageMarkdown p;
    p.success = j.value("success", true);
    p.url = j.value("url", std::string{});
    p.title = j.value("title", std::string{});
    p.markdown = j.value("markdown", std::string{});
    p.excerpt = j.value("excerpt", std::string{});
    p.text = j.value("text", std::string{});
    p.fetched_at = j.value("fetched_at", std::string{});
    p.format = j.value("format", std::string{"markdown"});
    p.blocked = j.value("blocked", false);
    p.error = j.value("error", std::string{});
    p.markdown_chars = j.value("markdown_chars", static_cast<int>(p.markdown.size()));
    return p;
}

void append_unique_url(std::vector<std::string>& urls, const std::string& url) {
    const std::string canon = canonical_url(url);
    if (canon.empty()) return;
    if (std::find(urls.begin(), urls.end(), canon) == urls.end()) {
        urls.push_back(canon);
    }
}

ExplorePolicy research_policy(const WebResearchConfig& config) {
    ExplorePolicy p;
    p.max_depth = config.max_depth;
    p.max_pages = config.prefer_explore ? config.max_pages : 1;
    p.timeout_ms = config.timeout_ms;
    p.same_host_only = config.prefer_explore;
    p.emit_markdown = true;
    p.allow_hosts = config.allow_hosts;
    p.deny_hosts = config.deny_hosts;
    p.max_markdown_chars = config.context_max_chars;
    return p;
}

}  // namespace

std::string keyword_compress(std::string_view query, std::size_t max_words) {
    std::string out;
    std::string word;
    std::size_t count = 0;
    auto flush = [&]() {
        if (word.empty()) return;
        const std::string low = text::to_lower(word);
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

std::vector<std::string> extract_urls_from_text(std::string_view text) {
    std::vector<std::string> out;
    const std::string s(text);
    std::size_t i = 0;
    while (i < s.size()) {
        const auto pos = s.find("http", i);
        if (pos == std::string::npos) break;
        if (pos + 7 > s.size()) break;
        const bool ok = s.compare(pos, 8, "https://") == 0 || s.compare(pos, 7, "http://") == 0;
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
            append_unique_url(out, url);
        }
        i = end;
    }
    return out;
}

std::string make_search_query_from_task(std::string_view task, std::size_t max_chars) {
    std::string s(task);
    auto tpos = s.find("TASK:");
    if (tpos == std::string::npos) tpos = s.find("Task:");
    if (tpos != std::string::npos) {
        s = s.substr(tpos + 5);
    }
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
    while (!out.empty() &&
           (out.front() == ':' || std::isspace(static_cast<unsigned char>(out.front())))) {
        out.erase(out.begin());
    }
    if (out.size() > max_chars) {
        const auto cut = out.find(". ");
        if (cut != std::string::npos && cut >= 40 && cut < max_chars) {
            out = out.substr(0, cut);
        } else {
            out = out.substr(0, max_chars);
        }
    }
    if (out.empty()) return out;
    const std::string kw = keyword_compress(out, 12);
    if (!kw.empty()) return kw.size() > max_chars ? kw.substr(0, max_chars) : kw;
    return out;
}

std::string canonical_provider(std::string value) {
    value = text::to_lower(std::move(value));
    if (value == "g" || value == "google_http" || value == "google_html") return "google";
    if (value == "ddg") return "duckduckgo";
    if (value == "wiki") return "wikipedia";
    if (value == "sx" || value == "dodo") return "searxng";
    if (value == "user-browser") return "user_browser";
    return value;
}

std::string unwrap_google_link(std::string link) {
    link = decode_html_entities(link);
    if (link.empty()) return {};
    const auto is_google = [](const std::string& value) {
        std::string low = value;
        std::transform(low.begin(), low.end(), low.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
        });
        return low.rfind("https://www.google.com", 0) == 0 ||
               low.rfind("https://google.com", 0) == 0 ||
               low.rfind("/url?", 0) == 0;
    };
    if (is_google(link)) {
        const auto qpos = link.find("q=");
        const auto upos = link.find("url=");
        const auto start = qpos != std::string::npos ? qpos + 2 : upos != std::string::npos ? upos + 4 : std::string::npos;
        if (start == std::string::npos) return {};
        auto end = link.find('&', start);
        if (end == std::string::npos) end = link.size();
        link = url_decode_basic(link.substr(start, end - start));
    }
    if (link.rfind("http://", 0) != 0 && link.rfind("https://", 0) != 0) return {};
    std::string low = link;
    std::transform(low.begin(), low.end(), low.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (low.find("google.com") != std::string::npos || low.find("googleadservices.com") != std::string::npos ||
        low.find("doubleclick.net") != std::string::npos || low.find("/aclk?") != std::string::npos ||
        low.find("/pagead/") != std::string::npos || low.find("adurl=") != std::string::npos ||
        low.find("/ads/") != std::string::npos || (low.size() >= 4 && low.ends_with("/ads"))) {
        return {};
    }
    const auto hash = link.find('#');
    if (hash != std::string::npos) link.resize(hash);
    return link;
}

std::vector<std::pair<std::string, std::string>> google_html_search(TransportPtr transport,
                                                                     std::string_view query,
                                                                     int max_results, int timeout_ms) {
    std::vector<std::pair<std::string, std::string>> hits;
    if (!transport || query.empty() || max_results < 1) return hits;
    const std::string q = keyword_compress(query, 10).empty()
                              ? std::string(query)
                              : keyword_compress(query, 10);
    const std::string url = "https://www.google.com/search?hl=en&num=" +
                            std::to_string(std::max(max_results, 8)) + "&q=" + url_encode_component(q);
    TransportRequest req;
    req.url = url;
    req.timeout_ms = timeout_ms > 0 ? timeout_ms : 20000;
    req.headers["User-Agent"] = "HandoffKit-Browser/1.0";
    req.headers["Accept"] = "text/html,application/xhtml+xml";
    const auto resp = transport->get(req);
    if (!resp.error.empty() || resp.status < 200 || resp.status >= 300 || resp.body.empty()) return hits;

    const std::string& html = resp.body;
    std::size_t pos = 0;
    while (static_cast<int>(hits.size()) < max_results) {
        const auto a = html.find("<a", pos);
        if (a == std::string::npos) break;
        auto href = html.find("href=\"", a);
        char quote = '\"';
        if (href == std::string::npos || href > a + 180) {
            href = html.find("href='", a);
            quote = '\'';
        }
        if (href == std::string::npos || href > a + 180) {
            pos = a + 2;
            continue;
        }
        href += 6;
        const auto hend = html.find(quote, href);
        if (hend == std::string::npos) break;
        const std::string link = unwrap_google_link(html.substr(href, hend - href));
        const auto gt = html.find('>', hend);
        const auto close = gt == std::string::npos ? std::string::npos : html.find("</a>", gt);
        if (link.empty() || gt == std::string::npos || close == std::string::npos) {
            pos = hend + 1;
            continue;
        }
        const std::string title = strip_tags(html.substr(gt + 1, close - gt - 1));
        if (title.size() >= 2) push_hit(hits, decode_html_entities(title), link, max_results);
        pos = hend + 1;
    }
    return hits;
}

std::string provider_engine(const std::vector<std::string>& providers) {
    std::vector<std::string> engines;
    for (const auto& raw : providers) {
        const auto provider = canonical_provider(raw);
        const std::string engine = provider == "google"
                                ? "google_html"
                                : provider == "duckduckgo"
                                ? "duckduckgo_html"
                                : provider == "searxng"   ? "searxng_json"
                                : provider == "brave"     ? "brave_json"
                                : provider == "bing"      ? "bing_json"
                                : provider == "kagi"      ? "kagi_json"
                                : provider == "mojeek"    ? "mojeek_html"
                                : provider == "marginalia" ? "marginalia_html"
                                : provider == "startpage" ? "startpage_html"
                                : provider == "wikipedia"
                                    ? "wikipedia_opensearch"
                                    : provider == "user_browser" ? "user_browser_bridge" : "";
        if (!engine.empty() && std::find(engines.begin(), engines.end(), engine) == engines.end()) {
            engines.push_back(engine);
        }
    }
    std::string out;
    for (const auto& engine : engines) {
        if (!out.empty()) out += "+";
        out += engine;
    }
    return out.empty() ? "none" : out;
}

nlohmann::json web_search(std::string_view query, TransportPtr transport, int max_results, int timeout_ms,
                          const std::vector<std::string>& allow_hosts,
                          const std::vector<std::string>& deny_hosts,
                          const std::vector<std::string>& providers) {
    const std::string q(query);
    max_results = std::max(1, std::min(8, max_results));
    const std::vector<std::string> requested =
        providers.empty()
            ? std::vector<std::string>{"google_browser", "project_index", "google_http", "duckduckgo", "wikipedia", "searxng"}
            : providers;
    std::vector<std::string> normalized;
    std::vector<std::string> provider_errors;
    std::vector<std::string> provider_codes;
    for (const auto& raw : requested) {
        const auto provider = canonical_provider(raw);
        if (provider.empty()) continue;
        if (provider != "google" && provider != "duckduckgo" && provider != "wikipedia" && provider != "searxng" &&
            provider != "brave" && provider != "bing" && provider != "kagi" &&
            provider != "mojeek" && provider != "marginalia" && provider != "startpage" &&
            provider != "user_browser" && provider != "google_browser" && provider != "project_index") {
            provider_errors.push_back("unsupported provider: " + provider);
            continue;
        }
        if (std::find(normalized.begin(), normalized.end(), provider) == normalized.end()) {
            normalized.push_back(provider);
        }
    }
    if (normalized.empty() && provider_errors.empty()) {
        provider_errors.push_back("no search providers configured");
    }
    if (q.empty()) {
        return {
            {"success", false},
            {"query", ""},
            {"keywords", ""},
            {"results", nlohmann::json::array()},
            {"count", 0},
            {"providers_requested", requested},
            {"providers_used", nlohmann::json::array()},
            {"provider_trace", nlohmann::json::array()},
            {"errors", nlohmann::json::array({"query is required"})},
            {"provider_codes", nlohmann::json::array()},
            {"engine", provider_engine(requested)},
            {"error_code", "query_required"},
            {"error", "query is required"},
        };
    }
    if (!transport) transport = make_transport("http");

    std::vector<std::pair<std::string, std::string>> raw_hits;
    std::vector<std::string> providers_used;
    nlohmann::json provider_trace = nlohmann::json::array();
    for (const auto& provider : normalized) {
        nlohmann::json trace = {
            {"provider", provider == "google" ? "google_http" : provider},
            {"attempted", true},
            {"used", false},
            {"result_count", 0},
            {"error_code", ""},
            {"fallback_reason", ""},
        };
        if (provider == "user_browser") {
            provider_codes.push_back("user_browser_bridge_required");
            provider_errors.push_back("user_browser: user_browser requires an injected search bridge");
            trace["error_code"] = "user_browser_bridge_required";
            trace["fallback_reason"] = "user_browser_empty";
            provider_trace.push_back(trace);
            continue;
        }
        if (provider == "google_browser") {
            provider_codes.push_back("provider_unavailable");
            provider_errors.push_back("google_browser: google_browser requires an explicit Browser Real search hook");
            trace["error_code"] = "provider_unavailable";
            trace["fallback_reason"] = "google_browser_unavailable";
            provider_trace.push_back(trace);
            continue;
        }
        if (provider == "project_index") {
            provider_codes.push_back("index_unavailable");
            provider_errors.push_back("project_index: project_index is opt-in and was not configured");
            trace["error_code"] = "index_unavailable";
            trace["fallback_reason"] = "project_index_disabled";
            provider_trace.push_back(trace);
            continue;
        }
        std::vector<std::pair<std::string, std::string>> hits;
        if (provider == "google") {
            hits = google_html_search(transport, q, max_results, timeout_ms);
        } else if (provider == "duckduckgo") {
            hits = duckduckgo_html_search(transport, q, max_results, timeout_ms);
        } else if (provider == "searxng") {
            const char* base_env = std::getenv("HANDOFFKIT_SEARXNG_URL");
            const char* bases_env = std::getenv("HANDOFFKIT_SEARXNG_URLS");
            if ((!base_env || std::string(base_env).empty()) &&
                (!bases_env || std::string(bases_env).empty())) {
                provider_codes.push_back("provider_unavailable");
                provider_errors.push_back("searxng: searxng requires HANDOFFKIT_SEARXNG_URL");
                trace["error_code"] = "provider_unavailable";
                trace["fallback_reason"] = "searxng_unconfigured";
                provider_trace.push_back(trace);
                continue;
            }
            hits = searxng_json_search(transport, q, max_results, timeout_ms);
        } else if (provider == "brave" || provider == "bing" || provider == "kagi") {
            const char* env_name = provider == "brave" ? "HANDOFFKIT_BRAVE_API_KEY"
                : provider == "bing" ? "HANDOFFKIT_BING_API_KEY" : "HANDOFFKIT_KAGI_API_KEY";
            const char* key_env = std::getenv(env_name);
            if (!key_env || std::string(key_env).empty()) {
                provider_codes.push_back("provider_unavailable");
                provider_errors.push_back(provider + ": no API key configured");
                trace["error_code"] = "provider_unavailable";
                trace["fallback_reason"] = provider + "_unconfigured";
                provider_trace.push_back(trace);
                continue;
            }
            if (provider == "brave") hits = brave_json_search(transport, q, max_results, timeout_ms);
            else if (provider == "bing") hits = bing_json_search(transport, q, max_results, timeout_ms);
            else hits = kagi_json_search(transport, q, max_results, timeout_ms);
        } else if (provider == "mojeek") {
            hits = mojeek_html_search(transport, q, max_results, timeout_ms);
        } else if (provider == "marginalia") {
            hits = marginalia_html_search(transport, q, max_results, timeout_ms);
        } else if (provider == "startpage") {
            hits = startpage_html_search(transport, q, max_results, timeout_ms);
        } else {
            hits = wikipedia_opensearch(transport, q, max_results, timeout_ms);
        }
        for (const auto& hit : hits) push_hit(raw_hits, hit.first, hit.second, max_results);
        if (!hits.empty()) {
            providers_used.push_back(provider);
            trace["used"] = true;
            trace["result_count"] = static_cast<int>(hits.size());
        } else {
            provider_errors.push_back(provider + ": empty");
            trace["error_code"] = "no_results";
            trace["fallback_reason"] = (provider == "google" ? std::string("google_http") : provider) + "_empty";
        }
        provider_trace.push_back(trace);
    }
    if (raw_hits.empty() &&
        std::find(normalized.begin(), normalized.end(), "wikipedia") != normalized.end()) {
        const auto short_q = keyword_compress(q, 4);
        if (!short_q.empty() && short_q != q) {
            const auto fallback = wikipedia_opensearch(transport, short_q, max_results, timeout_ms);
            for (const auto& hit : fallback) push_hit(raw_hits, hit.first, hit.second, max_results);
            if (!fallback.empty() &&
                std::find(providers_used.begin(), providers_used.end(), "wikipedia") == providers_used.end()) {
                providers_used.push_back("wikipedia");
            }
        }
    }
    const auto ranked = rank_search_hits(raw_hits, allow_hosts, deny_hosts);
    nlohmann::json results = nlohmann::json::array();
    const int n = std::min(max_results, static_cast<int>(ranked.size()));
    for (int i = 0; i < n; ++i) {
        results.push_back({{"title", ranked[static_cast<std::size_t>(i)].title},
                           {"url", ranked[static_cast<std::size_t>(i)].url},
                           {"score", ranked[static_cast<std::size_t>(i)].score}});
    }
    return {
        {"success", !results.empty()},
        {"query", q},
        {"keywords", keyword_compress(q)},
        {"results", results},
        {"count", results.size()},
        {"providers_requested", requested},
        {"providers_used", providers_used},
        {"provider_trace", provider_trace},
        {"errors", provider_errors},
        {"provider_codes", provider_codes},
        {"engine", provider_engine(requested)},
        {"error_code", results.empty()
                           ? (!provider_codes.empty() ? provider_codes.front()
                              : std::any_of(provider_errors.begin(), provider_errors.end(), [](const auto& error) {
                                 return error.rfind("unsupported provider:", 0) == 0;
                             })
                                  ? "provider_unavailable"
                                  : "no_results")
                           : ""},
        {"error", results.empty() ? "no search results" : ""},
    };
}

nlohmann::json WebResearchResult::to_json() const {
    nlohmann::json pages_j = nlohmann::json::array();
    for (const auto& p : pages) pages_j.push_back(p.to_json());
    return {
        {"enabled", enabled},
        {"used", used},
        {"queries", queries},
        {"urls_fetched", urls_fetched},
        {"markdown_chars", markdown_context.size()},
        {"markdown_context", markdown_context},
        {"pages", pages_j},
        {"citations", citations},
        {"steps", steps},
        {"pages_ok", pages_ok},
        {"tool_calls", tool_calls},
        {"error", error},
        {"transport", transport},
        {"mode", mode},
        {"metadata", metadata},
    };
}

std::vector<std::string> make_research_queries(std::string_view query,
                                               std::string_view task,
                                               int max_sub_queries) {
    const int limit = std::max(1, std::min(8, max_sub_queries));
    std::vector<std::string> out;
    auto add = [&](std::string value) {
        if (value.empty()) return;
        if (std::find(out.begin(), out.end(), value) == out.end() &&
            static_cast<int>(out.size()) < limit) {
            out.push_back(std::move(value));
        }
    };
    std::vector<std::string> candidates;
    if (!std::string(query).empty()) candidates.emplace_back(query);
    std::string task_part(task);
    std::string sentence;
    for (const char c : task_part) {
        if (c == '.' || c == '!' || c == '?' || c == '\n') {
            if (!sentence.empty()) candidates.push_back(std::move(sentence));
            sentence.clear();
        } else {
            sentence.push_back(c);
        }
    }
    if (!sentence.empty()) candidates.push_back(std::move(sentence));
    for (const auto& candidate : candidates) {
        add(make_search_query_from_task(candidate, 140));
        if (static_cast<int>(out.size()) >= limit) break;
    }
    return out;
}

WebResearchResult gather_deep_web_research(const WebResearchConfig& config, TransportPtr transport) {
    const auto started = Clock::now();
    WebResearchConfig base = config;
    base.max_pages = std::max(1, std::min(100, config.max_pages));
    base.max_depth = std::max(0, std::min(4, config.max_depth));
    base.max_sub_queries = std::max(1, std::min(8, config.max_sub_queries));
    base.max_results_per_query = std::max(1, std::min(20, config.max_results_per_query));
    base.prefer_explore = true;
    base.auto_search = false;
    base.seed_only = false;
    if (!transport) transport = make_transport("http");

    WebResearchResult result;
    result.enabled = true;
    result.transport = transport ? transport->name() : "";
    result.mode = "deep_search_then_explore";
    const bool user_browser_requested = std::any_of(
        base.providers.begin(), base.providers.end(), [](const std::string& provider) {
            return canonical_provider(provider) == "user_browser";
        });
    result.metadata = {
        {"execution_mode", user_browser_requested ? "background_user_browser_bridge" : "background_http"},
        {"user_browser_required", user_browser_requested},
        {"user_browser_bridge_configured", false},
        {"max_pages", base.max_pages},
        {"max_depth", base.max_depth},
        {"max_sub_queries", base.max_sub_queries},
        {"max_results_per_query", base.max_results_per_query},
        {"timeout_ms", base.timeout_ms},
        {"context_max_chars", base.context_max_chars},
        {"concurrency", 1},
        {"cache_enabled", base.cache != nullptr},
        {"allow_hosts", base.allow_hosts},
        {"deny_hosts", base.deny_hosts},
        {"providers_requested", base.providers},
        {"providers_used", nlohmann::json::array()},
        {"provider_errors", nlohmann::json::array()},
        {"error_code", ""},
        {"provider_transport", result.transport},
        {"auto_search", config.auto_search},
    };

    const bool auto_search = config.auto_search;
    const std::vector<std::string> auto_queries = auto_search
        ? make_research_queries(config.query, config.task, base.max_sub_queries)
        : std::vector<std::string>{};
    result.queries = auto_queries;

    std::vector<std::string> seeds;
    for (const auto& u : config.seed_urls) append_unique_url(seeds, u);
    for (const auto& u : extract_urls_from_text(config.task)) append_unique_url(seeds, u);
    for (const auto& u : extract_urls_from_text(config.query)) append_unique_url(seeds, u);

    if (auto_search) {
        for (const auto& subquery : auto_queries) {
            ++result.tool_calls;
            const auto t0 = Clock::now();
            const auto search = web_search(subquery, transport, base.max_results_per_query,
                                           base.timeout_ms, base.allow_hosts, base.deny_hosts,
                                           base.providers);
            nlohmann::json step = {
                {"tool", "web_search"},
                {"query", subquery},
                {"success", search.value("success", false)},
                {"count", search.value("count", 0)},
                {"ms", elapsed_ms(t0)},
                {"engine", search.value("engine", "")},
                {"providers_requested", search.value("providers_requested", nlohmann::json::array())},
                {"providers_used", search.value("providers_used", nlohmann::json::array())},
                {"provider_errors", search.value("errors", nlohmann::json::array())},
                {"error", search.value("error", "")},
            };
            for (const auto& provider : search.value("providers_used", nlohmann::json::array())) {
                if (std::find(result.metadata["providers_used"].begin(),
                              result.metadata["providers_used"].end(), provider) ==
                    result.metadata["providers_used"].end()) {
                    result.metadata["providers_used"].push_back(provider);
                }
            }
            for (const auto& error : search.value("errors", nlohmann::json::array())) {
                if (std::find(result.metadata["provider_errors"].begin(),
                              result.metadata["provider_errors"].end(), error) ==
                    result.metadata["provider_errors"].end()) {
                    result.metadata["provider_errors"].push_back(error);
                }
            }
            if (search.contains("results") && search["results"].is_array()) {
                for (const auto& hit : search["results"]) {
                    if (hit.contains("url") && hit["url"].is_string()) {
                        append_unique_url(seeds, hit["url"].get<std::string>());
                    }
                }
            }
            result.steps.push_back(std::move(step));
        }
    }

    base.query.clear();
    base.task.clear();
    base.seed_urls = std::move(seeds);
    const int candidate_cap = std::max(base.max_pages * 3, base.max_pages);
    if (static_cast<int>(base.seed_urls.size()) > candidate_cap) {
        base.seed_urls.resize(static_cast<std::size_t>(candidate_cap));
    }
    WebResearchResult fetched = gather_web_research(base, transport);
    result.used = fetched.used || !result.queries.empty();
    result.urls_fetched = std::move(fetched.urls_fetched);
    result.markdown_context = std::move(fetched.markdown_context);
    result.pages = std::move(fetched.pages);
    result.citations = std::move(fetched.citations);
    for (auto& step : fetched.steps) result.steps.push_back(std::move(step));
    result.pages_ok = fetched.pages_ok;
    result.tool_calls += fetched.tool_calls;
    result.error = fetched.error;
    if (!result.pages_ok) {
        result.metadata["error_code"] = fetched.error == "no urls to fetch"
                                              ? "no_urls_to_explore"
                                              : "no_pages_explored";
    }
    for (const char* key : {"cache_hits", "cache_misses", "cache_writes"}) {
        result.metadata[key] = fetched.metadata.value(key, 0);
    }
    result.metadata["candidates"] = base.seed_urls;
    result.metadata["duration_ms"] = elapsed_ms(started);
    result.steps.push_back({
        {"tool", "deep_research_done"},
        {"pages_ok", result.pages_ok},
        {"ms", result.metadata["duration_ms"]},
    });
    if (result.pages_ok == 0 && result.error.empty()) result.error = "no pages explored successfully";
    return result;
}

std::string WebResearchResult::prompt_section() const {
    if (markdown_context.empty()) return {};
    std::ostringstream ss;
    ss << "### Live web research (Markdown from HandoffKit browser)\n"
       << "Use the following fetched page content as evidence. Prefer these sources over invention.\n"
       << "Tools used: web_search, web_fetch_markdown, html_to_markdown.\n";
    if (!citations.empty()) {
        ss << "\nCitations:\n";
        for (const auto& c : citations) {
            const std::string title = c.value("title", std::string{});
            const std::string url = c.value("url", std::string{});
            ss << "- [" << (title.empty() ? url : title) << "](" << url << ")\n";
        }
        ss << "\n";
    }
    ss << markdown_context;
    return ss.str();
}

WebResearchResult gather_web_research(const WebResearchConfig& config, TransportPtr transport) {
    const auto started = Clock::now();
    WebResearchResult result;
    result.enabled = true;
    if (!transport) transport = make_transport("http");
    result.transport = transport ? transport->name() : "";

    const bool seed_only = config.seed_only;
    const bool auto_search = seed_only ? false : config.auto_search;
    const int max_pages = std::max(1, config.max_pages);
    const int context_max_chars = std::max(1000, config.context_max_chars);
    result.mode = seed_only ? "seed_only" : (auto_search ? "search_then_fetch" : "urls_only");
    const bool user_browser_requested = std::any_of(
        config.providers.begin(), config.providers.end(), [](const std::string& provider) {
            return canonical_provider(provider) == "user_browser";
        });
    result.metadata = {
        {"execution_mode", user_browser_requested ? "background_user_browser_bridge" : "background_http"},
        {"user_browser_required", user_browser_requested},
        {"user_browser_bridge_configured", false},
        {"cache_enabled", config.cache != nullptr},
        {"cache_hits", 0},
        {"cache_misses", 0},
        {"cache_writes", 0},
        {"providers_requested", config.providers},
        {"providers_used", nlohmann::json::array()},
        {"provider_errors", nlohmann::json::array()},
        {"error_code", ""},
    };

    std::vector<std::string> urls;
    for (const auto& u : config.seed_urls) append_unique_url(urls, u);
    for (const auto& u : extract_urls_from_text(config.task)) append_unique_url(urls, u);
    for (const auto& u : extract_urls_from_text(config.query)) append_unique_url(urls, u);

    if (urls.empty() && auto_search) {
        const std::string q =
            config.query.empty() ? make_search_query_from_task(config.task) : config.query;
        if (!q.empty()) {
            result.queries.push_back(q);
            ++result.tool_calls;
            const auto t0 = Clock::now();
            const auto search = web_search(q, transport, std::min(8, std::max(4, max_pages * 2)),
                                           config.timeout_ms, config.allow_hosts, config.deny_hosts,
                                           config.providers);
            nlohmann::json step = {{"tool", "web_search"},
                                   {"query", q},
                                   {"success", search.value("success", false)},
                                   {"count", search.value("count", 0)},
                                   {"ms", elapsed_ms(t0)},
                                   {"result",
                                    {{"success", search.value("success", false)},
                                     {"count", search.value("count", 0)},
                                     {"results", search.value("results", nlohmann::json::array())},
                                     {"error", search.value("error", std::string{})}}}};
            if (search.value("success", false) && search.contains("results") &&
                search["results"].is_array()) {
                for (const auto& hit : search["results"]) {
                    if (hit.contains("url") && hit["url"].is_string()) {
                        append_unique_url(urls, hit["url"].get<std::string>());
                    }
                }
            } else if (search.contains("error") && search["error"].is_string()) {
                result.error = search["error"].get<std::string>();
            }
            for (const auto& provider : search.value("providers_used", nlohmann::json::array())) {
                if (std::find(result.metadata["providers_used"].begin(),
                              result.metadata["providers_used"].end(), provider) ==
                    result.metadata["providers_used"].end()) {
                    result.metadata["providers_used"].push_back(provider);
                }
            }
            for (const auto& error : search.value("errors", nlohmann::json::array())) {
                if (std::find(result.metadata["provider_errors"].begin(),
                              result.metadata["provider_errors"].end(), error) ==
                    result.metadata["provider_errors"].end()) {
                    result.metadata["provider_errors"].push_back(error);
                }
            }
            result.steps.push_back(std::move(step));
        }
    }

    std::vector<std::pair<std::string, std::string>> url_hits;
    url_hits.reserve(urls.size());
    for (const auto& u : urls) url_hits.emplace_back("", u);
    const auto ranked = rank_search_hits(url_hits, config.allow_hosts, config.deny_hosts);
    std::vector<std::string> candidates;
    candidates.reserve(ranked.size());
    for (const auto& h : ranked) candidates.push_back(h.url);
    const int candidate_cap = std::max(max_pages * 3, max_pages);
    if (static_cast<int>(candidates.size()) > candidate_cap) {
        candidates.resize(static_cast<std::size_t>(candidate_cap));
    }

    if (candidates.empty()) {
        if (result.error.empty()) result.error = "no urls to fetch";
        result.metadata["error_code"] = "no_urls_to_fetch";
        result.used = !result.queries.empty();
        result.steps.push_back(
            {{"tool", "research_done"}, {"ms", elapsed_ms(started)}, {"pages_ok", result.pages_ok}});
        return result;
    }

    WebExplorer explorer(transport);
    const ExplorePolicy policy = research_policy(config);
    std::ostringstream md_parts;

    for (const auto& url : candidates) {
        if (result.pages_ok >= max_pages) break;

        const auto t0 = Clock::now();
        ++result.tool_calls;
        nlohmann::json step;

        if (config.cache) {
            if (const auto hit = config.cache->get(url)) {
                if (hit->contains("markdown") && (*hit)["markdown"].is_string() &&
                    !(*hit)["markdown"].get<std::string>().empty()) {
                    result.metadata["cache_hits"] = result.metadata.value("cache_hits", 0) + 1;
                    PageMarkdown page = page_from_cache_json(*hit);
                    if (page.url.empty()) page.url = url;
                    page.markdown = smart_truncate(page.markdown, context_max_chars);
                    page.markdown_chars = static_cast<int>(page.markdown.size());
                    page.excerpt = make_excerpt(page.markdown);
                    result.pages_ok += 1;
                    result.urls_fetched.push_back(page.url);
                    result.pages.push_back(page);
                    result.citations.push_back({{"title", page.title}, {"url", page.url}});
                    if (!page.markdown.empty()) {
                        if (!md_parts.str().empty()) md_parts << "\n\n---\n\n";
                        md_parts << page.markdown;
                    }
                    step = {{"tool", "cache_hit"},
                            {"url", url},
                            {"success", true},
                            {"title", page.title},
                            {"chars", page.markdown_chars},
                            {"ms", elapsed_ms(t0)}};
                    result.steps.push_back(std::move(step));
                    continue;
                }
            }
            result.metadata["cache_misses"] = result.metadata.value("cache_misses", 0) + 1;
        }

        Result<ExploreResult> fetched = config.prefer_explore ? explorer.explore(url, policy)
                                                              : explorer.fetch(url, policy);
        step["tool"] = config.prefer_explore ? "web_explore" : "web_fetch";
        step["url"] = url;

        if (!fetched) {
            step["success"] = false;
            step["error"] = fetched.error().message;
            step["ms"] = elapsed_ms(t0);
            result.steps.push_back(std::move(step));
            continue;
        }

        const ExploreResult& er = fetched.value();
        PageMarkdown page =
            PageMarkdown::from_explore_result(er, context_max_chars, config.format);
        step["success"] = er.success;
        step["title"] = er.title;
        step["error"] = er.error;
        step["chars"] = page.markdown_chars;
        step["ms"] = elapsed_ms(t0);
        if (!er.steps.empty()) step["status"] = er.steps.front().status;

        if (!er.success) {
            result.steps.push_back(std::move(step));
            continue;
        }

        if (config.cache) {
            if (config.cache->set(url, page.to_json())) {
                result.metadata["cache_writes"] = result.metadata.value("cache_writes", 0) + 1;
            }
        }

        result.pages_ok += 1;
        result.urls_fetched.push_back(page.url);
        result.pages.push_back(page);
        result.citations.push_back({{"title", page.title}, {"url", page.url}});
        if (!page.markdown.empty()) {
            if (!md_parts.str().empty()) md_parts << "\n\n---\n\n";
            md_parts << page.markdown;
        }
        result.steps.push_back(std::move(step));
    }

    result.markdown_context = smart_truncate(md_parts.str(), context_max_chars);
    result.used = result.pages_ok > 0 || !result.queries.empty();
    if (result.pages_ok == 0 && result.error.empty()) {
        result.error = "no pages fetched successfully";
    }
    if (result.pages_ok == 0 && result.metadata.value("error_code", std::string{}).empty()) {
        result.metadata["error_code"] = "no_pages_fetched";
    }
    result.steps.push_back(
        {{"tool", "research_done"}, {"ms", elapsed_ms(started)}, {"pages_ok", result.pages_ok}});
    return result;
}

Tool make_web_search_tool(TransportPtr default_transport, std::vector<std::string> default_providers) {
    auto transport = default_transport;
    auto configured_providers = std::move(default_providers);
    return Tool(
        "web_search",
        "Search the live web for a query. Returns ranked {title,url,score} hits. Follow up with "
        "web_fetch_markdown on the best URLs.",
        [transport, configured_providers](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("query") || !args["query"].is_string()) {
                return Error::invalid_argument("query is required", "query");
            }
            int max_results = 6;
            if (args.contains("max_results") && args["max_results"].is_number_integer()) {
                max_results = std::max(1, std::min(8, args["max_results"].get<int>()));
            }
            int timeout_ms = 20000;
            if (args.contains("timeout_ms") && args["timeout_ms"].is_number_integer()) {
                timeout_ms = args["timeout_ms"].get<int>();
            }
            std::vector<std::string> allow_hosts;
            std::vector<std::string> deny_hosts;
            std::vector<std::string> providers = configured_providers;
            if (args.contains("allow_hosts") && args["allow_hosts"].is_array()) {
                for (const auto& h : args["allow_hosts"]) {
                    if (h.is_string()) allow_hosts.push_back(h.get<std::string>());
                }
            }
            if (args.contains("deny_hosts") && args["deny_hosts"].is_array()) {
                for (const auto& h : args["deny_hosts"]) {
                    if (h.is_string()) deny_hosts.push_back(h.get<std::string>());
                }
            }
            if (args.contains("providers") && args["providers"].is_array()) {
                for (const auto& provider : args["providers"]) {
                    if (provider.is_string()) providers.push_back(provider.get<std::string>());
                }
            }
            const auto t = resolve_tool_transport(args, transport);
            return web_search(args["query"].get<std::string>(), t, max_results, timeout_ms,
                              allow_hosts, deny_hosts, providers);
        },
        nlohmann::json{
            {"type", "object"},
            {"properties",
             {{"query", {{"type", "string"}}},
              {"max_results", {{"type", "integer"}}},
              {"timeout_ms", {{"type", "integer"}}},
              {"transport", {{"type", "string"}}},
              {"allow_hosts", {{"type", "array"}}},
              {"deny_hosts", {{"type", "array"}}},
              {"providers", {{"type", "array"}}}}},
            {"required", nlohmann::json::array({"query"})},
        });
}

Tool make_web_research_tool(TransportPtr default_transport, std::vector<std::string> default_providers) {
    auto transport = default_transport;
    auto configured_providers = std::move(default_providers);
    return Tool(
        "web_research",
        "Run search-then-fetch research and return markdown_context and citations for grounded "
        "answers.",
        [transport, configured_providers](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("query") || !args["query"].is_string()) {
                return Error::invalid_argument("query is required", "query");
            }
            WebResearchConfig cfg;
            if (!configured_providers.empty()) cfg.providers = configured_providers;
            cfg.query = args["query"].get<std::string>();
            if (args.contains("max_pages") && args["max_pages"].is_number_integer()) {
                cfg.max_pages = std::max(1, std::min(8, args["max_pages"].get<int>()));
            }
            if (args.contains("timeout_ms") && args["timeout_ms"].is_number_integer()) {
                cfg.timeout_ms = args["timeout_ms"].get<int>();
            }
            if (args.contains("allow_hosts") && args["allow_hosts"].is_array()) {
                for (const auto& h : args["allow_hosts"]) {
                    if (h.is_string()) cfg.allow_hosts.push_back(h.get<std::string>());
                }
            }
            if (args.contains("deny_hosts") && args["deny_hosts"].is_array()) {
                for (const auto& h : args["deny_hosts"]) {
                    if (h.is_string()) cfg.deny_hosts.push_back(h.get<std::string>());
                }
            }
            if (args.contains("providers") && args["providers"].is_array()) {
                cfg.providers.clear();
                for (const auto& provider : args["providers"]) {
                    if (provider.is_string()) cfg.providers.push_back(provider.get<std::string>());
                }
            }
            if (args.contains("seed_only") && args["seed_only"].is_boolean()) {
                cfg.seed_only = args["seed_only"].get<bool>();
            }
            if (args.contains("seed_urls") && args["seed_urls"].is_array()) {
                for (const auto& u : args["seed_urls"]) {
                    if (u.is_string()) cfg.seed_urls.push_back(u.get<std::string>());
                }
            }
            if (args.contains("format") && args["format"].is_string()) {
                cfg.format = args["format"].get<std::string>();
            }
            const auto t = resolve_tool_transport(args, transport);
            WebResearchResult pack = gather_web_research(cfg, t);
            nlohmann::json out = pack.to_json();
            out["success"] = pack.pages_ok > 0;
            return out;
        },
        nlohmann::json{
            {"type", "object"},
            {"properties",
             {{"query", {{"type", "string"}}},
              {"max_pages", {{"type", "integer"}}},
              {"timeout_ms", {{"type", "integer"}}},
              {"transport", {{"type", "string"}}},
              {"allow_hosts", {{"type", "array"}}},
              {"deny_hosts", {{"type", "array"}}},
              {"providers", {{"type", "array"}}},
              {"seed_only", {{"type", "boolean"}}},
              {"seed_urls", {{"type", "array"}}},
              {"format", {{"type", "string"}}}}},
            {"required", nlohmann::json::array({"query"})},
        });
}

Tool make_deep_web_research_tool(TransportPtr default_transport, std::vector<std::string> default_providers) {
    auto transport = default_transport;
    auto configured_providers = std::move(default_providers);
    return Tool(
        "web_deep_research",
        "Run bounded multi-query, multi-hop research; user_browser is explicit and unavailable without a host bridge.",
        [transport, configured_providers](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("query") || !args["query"].is_string()) {
                return Error::invalid_argument("query is required", "query");
            }
            WebResearchConfig cfg;
            if (!configured_providers.empty()) cfg.providers = configured_providers;
            cfg.query = args["query"].get<std::string>();
            if (args.contains("task") && args["task"].is_string()) cfg.task = args["task"].get<std::string>();
            if (args.contains("max_pages") && args["max_pages"].is_number_integer()) {
                cfg.max_pages = std::max(1, std::min(100, args["max_pages"].get<int>()));
            }
            if (args.contains("max_depth") && args["max_depth"].is_number_integer()) {
                cfg.max_depth = std::max(0, std::min(4, args["max_depth"].get<int>()));
            }
            if (args.contains("max_sub_queries") && args["max_sub_queries"].is_number_integer()) {
                cfg.max_sub_queries = args["max_sub_queries"].get<int>();
            }
            if (args.contains("max_results_per_query") && args["max_results_per_query"].is_number_integer()) {
                cfg.max_results_per_query = args["max_results_per_query"].get<int>();
            }
            if (args.contains("timeout_ms") && args["timeout_ms"].is_number_integer()) cfg.timeout_ms = args["timeout_ms"].get<int>();
            if (args.contains("context_max_chars") && args["context_max_chars"].is_number_integer()) cfg.context_max_chars = args["context_max_chars"].get<int>();
            if (args.contains("auto_search") && args["auto_search"].is_boolean()) cfg.auto_search = args["auto_search"].get<bool>();
            if (args.contains("allow_hosts") && args["allow_hosts"].is_array()) {
                for (const auto& h : args["allow_hosts"]) if (h.is_string()) cfg.allow_hosts.push_back(h.get<std::string>());
            }
            if (args.contains("deny_hosts") && args["deny_hosts"].is_array()) {
                for (const auto& h : args["deny_hosts"]) if (h.is_string()) cfg.deny_hosts.push_back(h.get<std::string>());
            }
            if (args.contains("providers") && args["providers"].is_array()) {
                cfg.providers.clear();
                for (const auto& provider : args["providers"]) if (provider.is_string()) cfg.providers.push_back(provider.get<std::string>());
            }
            if (args.contains("seed_urls") && args["seed_urls"].is_array()) {
                for (const auto& u : args["seed_urls"]) if (u.is_string()) cfg.seed_urls.push_back(u.get<std::string>());
            }
            if (args.contains("format") && args["format"].is_string()) cfg.format = args["format"].get<std::string>();
            const auto t = resolve_tool_transport(args, transport);
            WebResearchResult pack = gather_deep_web_research(cfg, t);
            auto out = pack.to_json();
            out["success"] = pack.pages_ok > 0;
            return out;
        },
        nlohmann::json{
            {"type", "object"},
            {"properties", {
                {"query", {{"type", "string"}}},
                {"task", {{"type", "string"}}},
                {"max_pages", {{"type", "integer"}, {"minimum", 1}, {"maximum", 100}}},
                {"max_depth", {{"type", "integer"}, {"minimum", 0}, {"maximum", 4}}},
                {"max_sub_queries", {{"type", "integer"}}},
                {"max_results_per_query", {{"type", "integer"}}},
                {"timeout_ms", {{"type", "integer"}}},
                {"context_max_chars", {{"type", "integer"}}},
                {"auto_search", {{"type", "boolean"}}},
                {"allow_hosts", {{"type", "array"}}},
                {"deny_hosts", {{"type", "array"}}},
                {"providers", {{"type", "array"}}},
                {"seed_urls", {{"type", "array"}}},
                {"format", {{"type", "string"}}},
                {"transport", {{"type", "string"}}},
            }},
            {"required", nlohmann::json::array({"query"})},
        });
}

}  // namespace browser
}  // namespace handoffkit
