#include <handoffkit/browser/rank.hpp>
#include <handoffkit/browser/web_types.hpp>

#include <algorithm>
#include <cctype>

namespace handoffkit {
namespace browser {
namespace {

bool host_matches(std::string_view host, std::string_view pattern) {
    const std::string h = normalize_host(host);
    const std::string p = normalize_host(pattern);
    if (p.empty() || h.empty()) return false;
    if (h == p) return true;
    return h.size() > p.size() && h[h.size() - p.size() - 1] == '.' &&
           h.compare(h.size() - p.size(), p.size(), p) == 0;
}

}  // namespace

int host_score(std::string_view url) {
    auto parts = parse_url(url);
    const std::string host = normalize_host(parts.host);
    if (host.empty()) return 0;
    if (host.find("pinterest.") != std::string::npos || host.find("facebook.com") != std::string::npos ||
        host.find("twitter.com") != std::string::npos || host == "x.com" ||
        host.find("tiktok.com") != std::string::npos || host.find("instagram.com") != std::string::npos) {
        return 5;
    }
    int best = 40;
    struct Pair { const char* pat; int score; };
    static const Pair k[] = {
        {"wikipedia.org", 100}, {"nih.gov", 95}, {"nlm.nih.gov", 95},
        {"pubmed.ncbi.nlm.nih.gov", 95}, {"ncbi.nlm.nih.gov", 94}, {"fda.gov", 93},
        {"ema.europa.eu", 92}, {"who.int", 90}, {"drugs.com", 85}, {"medlineplus.gov", 85},
        {"mayoclinic.org", 80}, {"github.com", 75}, {"pypi.org", 75}, {"npmjs.com", 75},
        {"readthedocs.io", 70}, {"arxiv.org", 70}, {"nature.com", 70}, {"frontiersin.org", 60},
    };
    for (const auto& p : k) {
        if (host.find(p.pat) != std::string::npos) best = std::max(best, p.score);
    }
    if (host.size() >= 4 && (host.compare(host.size() - 4, 4, ".edu") == 0 ||
                             host.compare(host.size() - 4, 4, ".gov") == 0)) {
        best = std::max(best, 88);
    }
    return best;
}

std::vector<RankedHit> rank_search_hits(
    const std::vector<std::pair<std::string, std::string>>& hits,
    const std::vector<std::string>& allow_hosts,
    const std::vector<std::string>& deny_hosts
) {
    std::vector<RankedHit> out;
    for (const auto& [title, url] : hits) {
        auto parts = parse_url(url);
        if (!parts.valid || parts.host.empty()) continue;
        bool denied = false;
        for (const auto& d : deny_hosts) {
            if (host_matches(parts.host, d)) { denied = true; break; }
        }
        if (denied) continue;
        if (!allow_hosts.empty()) {
            bool ok = false;
            for (const auto& a : allow_hosts) {
                if (host_matches(parts.host, a)) { ok = true; break; }
            }
            if (!ok) continue;
        }
        RankedHit h;
        h.title = title;
        h.url = url;
        h.score = host_score(url) + (title.empty() ? 0 : 5);
        out.push_back(std::move(h));
    }
    std::sort(out.begin(), out.end(), [](const RankedHit& a, const RankedHit& b) {
        if (a.score != b.score) return a.score > b.score;
        return a.url < b.url;
    });
    return out;
}

}  // namespace browser
}  // namespace handoffkit
