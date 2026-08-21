#include <handoffkit/demos/fusion/metrics.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <set>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

std::string lower(std::string s) {
    for (char& c : s) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return s;
}

}  // namespace

nlohmann::json TextScore::to_json() const {
    return nlohmann::json{
        {"jaccard", jaccard},
        {"containment", containment},
        {"length_ratio", length_ratio},
        {"contains_normalized_gold", contains_normalized_gold},
    };
}

std::vector<std::string> tokenize_simple(std::string_view text) {
    std::vector<std::string> out;
    std::string cur;
    auto flush = [&]() {
        if (!cur.empty()) {
            out.push_back(lower(cur));
            cur.clear();
        }
    };
    for (char ch : text) {
        if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' || ch == '-') {
            cur.push_back(ch);
        } else {
            flush();
        }
    }
    flush();
    return out;
}

std::string normalize_label(std::string_view text) {
    std::string s = lower(std::string(text));
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        if (std::isalnum(static_cast<unsigned char>(c))) out.push_back(c);
        else if (c == ' ' || c == '_' || c == '-' || c == '/') {
            if (out.empty() || out.back() != ' ') out.push_back(' ');
        }
    }
    // trim
    while (!out.empty() && out.front() == ' ') out.erase(out.begin());
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

TextScore score_text_against_gold(std::string_view prediction, std::string_view gold) {
    TextScore sc;
    if (gold.empty()) return sc;
    const auto pt = tokenize_simple(prediction);
    const auto gt = tokenize_simple(gold);
    std::set<std::string> ps(pt.begin(), pt.end());
    std::set<std::string> gs(gt.begin(), gt.end());
    std::size_t inter = 0;
    for (const auto& t : gs) {
        if (ps.count(t)) ++inter;
    }
    const std::size_t uni = ps.size() + gs.size() - inter;
    sc.jaccard = uni == 0 ? 0.0 : static_cast<double>(inter) / static_cast<double>(uni);
    sc.containment = gs.empty() ? 0.0 : static_cast<double>(inter) / static_cast<double>(gs.size());
    sc.length_ratio = gold.empty()
        ? 0.0
        : static_cast<double>(prediction.size()) / static_cast<double>(std::max<std::size_t>(1, gold.size()));
    const auto ng = normalize_label(gold);
    const auto np = normalize_label(prediction);
    sc.contains_normalized_gold = !ng.empty() && np.find(ng) != std::string::npos;
    // also token join without spaces
    std::string gcompact = ng;
    gcompact.erase(std::remove(gcompact.begin(), gcompact.end(), ' '), gcompact.end());
    std::string pcompact = np;
    pcompact.erase(std::remove(pcompact.begin(), pcompact.end(), ' '), pcompact.end());
    if (!gcompact.empty() && pcompact.find(gcompact) != std::string::npos) {
        sc.contains_normalized_gold = true;
    }
    return sc;
}

nlohmann::json score_fusion_run(const FusionRunResult& run, std::string_view gold_label) {
    nlohmann::json j{
        {"llm_calls", run.metrics.llm_calls},
        {"wall_ms", run.metrics.wall_ms},
        {"cache", run.metrics.cache.to_json()},
        {"success", run.success},
        {"handoff_count", run.metrics.handoff_count},
        {"branch_count", run.branches.size()},
    };
    if (!gold_label.empty()) {
        auto sc = score_text_against_gold(run.final_output, gold_label);
        j["gold"] = gold_label;
        j["text_score"] = sc.to_json();
    }
    // per-call summary
    nlohmann::json calls = nlohmann::json::array();
    for (const auto& c : run.metrics.calls) {
        calls.push_back({
            {"step_id", c.step_id},
            {"cache_hit", c.cache_hit},
            {"latency_ms", c.latency_ms},
            {"chars_in", c.chars_in},
            {"chars_out", c.chars_out},
        });
    }
    j["calls"] = std::move(calls);
    return j;
}

std::string metrics_markdown(const FusionMetrics& m) {
    std::ostringstream ss;
    ss << "| metric | value |\n|---|---:|\n"
       << "| llm_calls | " << m.llm_calls << " |\n"
       << "| handoff_count | " << m.handoff_count << " |\n"
       << "| wall_ms | " << m.wall_ms << " |\n"
       << "| cache_hit_rate | " << m.cache.hit_rate() << " |\n"
       << "| cache_hits | " << m.cache.hits << " |\n"
       << "| cache_misses | " << m.cache.misses << " |\n";
    return ss.str();
}

nlohmann::json BatchMetrics::to_json() const {
    return nlohmann::json{
        {"cases", cases},
        {"successes", successes},
        {"gold_hits", gold_hits},
        {"mean_hit_rate", mean_hit_rate},
        {"mean_wall_ms", mean_wall_ms},
        {"total_llm_calls", total_llm_calls},
        {"success_rate", cases == 0 ? 0.0 : static_cast<double>(successes) / cases},
        {"gold_hit_rate", cases == 0 ? 0.0 : static_cast<double>(gold_hits) / cases},
    };
}

std::string BatchMetrics::to_markdown() const {
    std::ostringstream ss;
    ss << "## Batch metrics\n\n" << to_json().dump(2) << "\n";
    return ss.str();
}

void batch_metrics_add(BatchMetrics& agg, const FusionRunResult& run, bool gold_hit) {
    const int n = agg.cases;
    agg.mean_hit_rate = (agg.mean_hit_rate * n + run.metrics.cache.hit_rate()) / (n + 1);
    agg.mean_wall_ms = (agg.mean_wall_ms * n + run.metrics.wall_ms) / (n + 1);
    ++agg.cases;
    if (run.success) ++agg.successes;
    if (gold_hit) ++agg.gold_hits;
    agg.total_llm_calls += run.metrics.llm_calls;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
