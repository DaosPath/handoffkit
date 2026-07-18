#include <handoffkit/demos/fusion/branch_compare.hpp>
#include <handoffkit/demos/fusion/metrics.hpp>

#include <algorithm>
#include <cctype>
#include <set>
#include <sstream>
#include <utility>

namespace handoffkit {
namespace demos {
namespace fusion {

nlohmann::json BranchDiff::to_json() const {
    return nlohmann::json{
        {"token_jaccard", token_jaccard},
        {"line_overlap", line_overlap},
        {"longest_common_ratio", longest_common_ratio},
        {"shared_bullets", shared_bullets},
        {"only_a_bullets", only_a_bullets},
        {"only_b_bullets", only_b_bullets},
        {"conflicts", conflicts},
    };
}

std::vector<std::string> extract_bullet_lines(std::string_view text) {
    std::vector<std::string> out;
    std::string line;
    auto flush = [&]() {
        // trim
        std::size_t a = 0;
        while (a < line.size() && std::isspace(static_cast<unsigned char>(line[a]))) ++a;
        std::size_t b = line.size();
        while (b > a && std::isspace(static_cast<unsigned char>(line[b - 1]))) --b;
        if (b <= a) {
            line.clear();
            return;
        }
        std::string t = line.substr(a, b - a);
        // bullet prefixes
        if (t.rfind("- ", 0) == 0 || t.rfind("* ", 0) == 0) t = t.substr(2);
        else if (t.size() > 2 && std::isdigit(static_cast<unsigned char>(t[0])) && t[1] == '.') {
            t = t.substr(2);
            while (!t.empty() && t[0] == ' ') t.erase(t.begin());
        }
        if (!t.empty()) out.push_back(t);
        line.clear();
    };
    for (char c : text) {
        if (c == '\n') flush();
        else line.push_back(c);
    }
    flush();
    return out;
}

std::size_t longest_common_subsequence_len(std::string_view a, std::string_view b) {
    // classic DP on characters; cap length for demo safety
    const std::size_t n = std::min<std::size_t>(a.size(), 400);
    const std::size_t m = std::min<std::size_t>(b.size(), 400);
    std::vector<std::size_t> prev(m + 1, 0), cur(m + 1, 0);
    for (std::size_t i = 1; i <= n; ++i) {
        for (std::size_t j = 1; j <= m; ++j) {
            if (a[i - 1] == b[j - 1]) cur[j] = prev[j - 1] + 1;
            else cur[j] = std::max(prev[j], cur[j - 1]);
        }
        prev.swap(cur);
        std::fill(cur.begin(), cur.end(), 0);
    }
    return prev[m];
}

double line_overlap_ratio(std::string_view a, std::string_view b) {
    auto la = extract_bullet_lines(a);
    auto lb = extract_bullet_lines(b);
    if (la.empty() && lb.empty()) {
        // fall back to raw lines
        std::set<std::string> sa, sb;
        std::string line;
        auto add_lines = [&](std::string_view t, std::set<std::string>& s) {
            line.clear();
            for (char c : t) {
                if (c == '\n') {
                    if (!line.empty()) s.insert(line);
                    line.clear();
                } else line.push_back(c);
            }
            if (!line.empty()) s.insert(line);
        };
        add_lines(a, sa);
        add_lines(b, sb);
        if (sa.empty() && sb.empty()) return 1.0;
        std::size_t inter = 0;
        for (const auto& x : sa) if (sb.count(x)) ++inter;
        const std::size_t uni = sa.size() + sb.size() - inter;
        return uni == 0 ? 0.0 : static_cast<double>(inter) / static_cast<double>(uni);
    }
    std::set<std::string> sa(la.begin(), la.end());
    std::set<std::string> sb(lb.begin(), lb.end());
    std::size_t inter = 0;
    for (const auto& x : sa) if (sb.count(x)) ++inter;
    const std::size_t uni = sa.size() + sb.size() - inter;
    return uni == 0 ? 0.0 : static_cast<double>(inter) / static_cast<double>(uni);
}

BranchDiff compare_branch_outputs(std::string_view a, std::string_view b) {
    BranchDiff d;
    auto ta = tokenize_simple(a);
    auto tb = tokenize_simple(b);
    std::set<std::string> sa(ta.begin(), ta.end());
    std::set<std::string> sb(tb.begin(), tb.end());
    std::size_t inter = 0;
    for (const auto& t : sa) if (sb.count(t)) ++inter;
    const std::size_t uni = sa.size() + sb.size() - inter;
    d.token_jaccard = uni == 0 ? 0.0 : static_cast<double>(inter) / static_cast<double>(uni);
    d.line_overlap = line_overlap_ratio(a, b);
    const auto lcs = longest_common_subsequence_len(a, b);
    const auto denom = std::max(a.size(), b.size());
    d.longest_common_ratio = denom == 0 ? 0.0 : static_cast<double>(lcs) / static_cast<double>(denom);

    auto ba = extract_bullet_lines(a);
    auto bb = extract_bullet_lines(b);
    std::set<std::string> bsa(ba.begin(), ba.end());
    std::set<std::string> bsb(bb.begin(), bb.end());
    for (const auto& x : bsa) {
        if (bsb.count(x)) ++d.shared_bullets;
        else ++d.only_a_bullets;
    }
    for (const auto& x : bsb) {
        if (!bsa.count(x)) ++d.only_b_bullets;
    }

    // Conflict heuristics: opposite polarity keywords
    const char* pos[] = {"should", "prefer", "recommend", "must", "always"};
    const char* neg[] = {"avoid", "never", "against", "reject", "don't", "do not"};
    auto has_any = [](std::string_view t, const char* words[], std::size_t n) {
        std::string low(t);
        for (char& c : low) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        for (std::size_t i = 0; i < n; ++i) {
            if (low.find(words[i]) != std::string::npos) return true;
        }
        return false;
    };
    if (has_any(a, pos, 5) && has_any(b, neg, 6)) {
        d.conflicts.push_back("A sounds prescriptive while B is prohibitive");
    }
    if (has_any(b, pos, 5) && has_any(a, neg, 6)) {
        d.conflicts.push_back("B sounds prescriptive while A is prohibitive");
    }
    if (d.token_jaccard < 0.15 && !a.empty() && !b.empty()) {
        d.conflicts.push_back("very low lexical overlap between branches");
    }
    return d;
}

BranchDiff compare_fusion_branches(const FusionRunResult& run) {
    if (run.branches.size() < 2) return {};
    return compare_branch_outputs(run.branches[0].combined, run.branches[1].combined);
}

int prefer_branch_index(const std::vector<std::string>& outputs) {
    if (outputs.empty()) return -1;
    int best = 0;
    double best_score = -1.0;
    for (std::size_t i = 0; i < outputs.size(); ++i) {
        auto toks = tokenize_simple(outputs[i]);
        std::set<std::string> uniq(toks.begin(), toks.end());
        int digits = 0;
        for (const auto& t : toks) {
            if (std::any_of(t.begin(), t.end(), [](char c) { return std::isdigit(static_cast<unsigned char>(c)); })) {
                ++digits;
            }
        }
        // specificity: unique tokens + numbers + moderate length
        double score = static_cast<double>(uniq.size()) + 2.0 * digits + 0.001 * static_cast<double>(outputs[i].size());
        if (score > best_score) {
            best_score = score;
            best = static_cast<int>(i);
        }
    }
    return best;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
