#include <handoffkit/util/text.hpp>

#include <algorithm>
#include <cctype>
#include <sstream>

namespace handoffkit {
namespace text {

std::string trim(std::string_view s) {
    std::size_t b = 0;
    while (b < s.size() && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
    std::size_t e = s.size();
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
    return std::string(s.substr(b, e - b));
}

std::string to_lower(std::string s) {
    for (char& ch : s) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return s;
}

std::vector<std::string> split_words(std::string_view s) {
    std::vector<std::string> out;
    std::string cur;
    for (unsigned char ch : s) {
        if (std::isalnum(ch) || ch == '_' || ch == '-') {
            cur.push_back(static_cast<char>(std::tolower(ch)));
        } else if (!cur.empty()) {
            out.push_back(cur);
            cur.clear();
        }
    }
    if (!cur.empty()) out.push_back(cur);
    return out;
}

std::vector<std::string> split_lines(std::string_view s) {
    std::vector<std::string> out;
    std::string cur;
    for (char ch : s) {
        if (ch == '\n') {
            out.push_back(cur);
            cur.clear();
        } else if (ch != '\r') {
            cur.push_back(ch);
        }
    }
    out.push_back(cur);
    return out;
}

std::size_t word_count(std::string_view s) {
    return split_words(s).size();
}

std::size_t line_count(std::string_view s) {
    if (s.empty()) return 0;
    return split_lines(s).size();
}

bool starts_with(std::string_view s, std::string_view prefix) {
    return s.size() >= prefix.size() && s.substr(0, prefix.size()) == prefix;
}

bool ends_with(std::string_view s, std::string_view suffix) {
    return s.size() >= suffix.size() && s.substr(s.size() - suffix.size()) == suffix;
}

bool contains_ci(std::string_view hay, std::string_view needle) {
    auto h = to_lower(std::string(hay));
    auto n = to_lower(std::string(needle));
    return h.find(n) != std::string::npos;
}

std::string replace_all(std::string s, std::string_view from, std::string_view to) {
    if (from.empty()) return s;
    std::string out;
    out.reserve(s.size());
    std::size_t pos = 0;
    while (true) {
        auto found = s.find(from, pos);
        if (found == std::string::npos) {
            out.append(s, pos, std::string::npos);
            break;
        }
        out.append(s, pos, found - pos);
        out.append(to);
        pos = found + from.size();
    }
    return out;
}

std::string truncate(std::string_view s, std::size_t max_chars, std::string_view ellipsis) {
    if (s.size() <= max_chars) return std::string(s);
    if (max_chars <= ellipsis.size()) return std::string(s.substr(0, max_chars));
    return std::string(s.substr(0, max_chars - ellipsis.size())) + std::string(ellipsis);
}

std::string join(const std::vector<std::string>& parts, std::string_view sep) {
    std::ostringstream ss;
    for (std::size_t i = 0; i < parts.size(); ++i) {
        if (i) ss << sep;
        ss << parts[i];
    }
    return ss.str();
}

std::string slugify(std::string_view s) {
    std::string out;
    bool prev_dash = false;
    for (unsigned char ch : s) {
        if (std::isalnum(ch)) {
            out.push_back(static_cast<char>(std::tolower(ch)));
            prev_dash = false;
        } else if (!prev_dash && !out.empty()) {
            out.push_back('-');
            prev_dash = true;
        }
    }
    while (!out.empty() && out.back() == '-') out.pop_back();
    return out;
}

double jaccard_words(std::string_view a, std::string_view b) {
    auto wa = split_words(a);
    auto wb = split_words(b);
    std::sort(wa.begin(), wa.end());
    wa.erase(std::unique(wa.begin(), wa.end()), wa.end());
    std::sort(wb.begin(), wb.end());
    wb.erase(std::unique(wb.begin(), wb.end()), wb.end());
    if (wa.empty() && wb.empty()) return 1.0;
    std::size_t inter = 0;
    for (const auto& w : wa) {
        if (std::binary_search(wb.begin(), wb.end(), w)) ++inter;
    }
    const std::size_t uni = wa.size() + wb.size() - inter;
    return uni == 0 ? 0.0 : static_cast<double>(inter) / static_cast<double>(uni);
}

int levenshtein(std::string_view a, std::string_view b) {
    const std::size_t n = a.size();
    const std::size_t m = b.size();
    std::vector<int> prev(m + 1), cur(m + 1);
    for (std::size_t j = 0; j <= m; ++j) prev[j] = static_cast<int>(j);
    for (std::size_t i = 1; i <= n; ++i) {
        cur[0] = static_cast<int>(i);
        for (std::size_t j = 1; j <= m; ++j) {
            const int cost = a[i - 1] == b[j - 1] ? 0 : 1;
            cur[j] = std::min({prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost});
        }
        prev.swap(cur);
    }
    return prev[m];
}

std::unordered_map<std::string, int> term_frequencies(std::string_view s) {
    std::unordered_map<std::string, int> freq;
    for (const auto& w : split_words(s)) {
        if (w.size() >= 3) freq[w]++;
    }
    return freq;
}

std::vector<std::pair<std::string, int>> top_terms(std::string_view s, std::size_t k) {
    auto freq = term_frequencies(s);
    std::vector<std::pair<std::string, int>> ranked(freq.begin(), freq.end());
    std::sort(ranked.begin(), ranked.end(), [](const auto& x, const auto& y) {
        if (x.second != y.second) return x.second > y.second;
        return x.first < y.first;
    });
    if (ranked.size() > k) ranked.resize(k);
    return ranked;
}

std::string bulletize(const std::vector<std::string>& items) {
    std::ostringstream ss;
    for (const auto& item : items) {
        ss << "- " << item << "\n";
    }
    return ss.str();
}

bool looks_like_action(std::string_view step) {
    static const char* verbs[] = {
        "run", "write", "create", "implement", "test", "review", "fix", "verify",
        "add", "update", "remove", "deploy", "document", "investigate", "escalate",
        "schedule", "notify", "measure", "refactor", "migrate", "validate",
    };
    auto t = trim(to_lower(std::string(step)));
    for (const char* v : verbs) {
        const std::size_t n = std::char_traits<char>::length(v);
        if (starts_with(t, v) && (t.size() == n || !std::isalpha(static_cast<unsigned char>(t[n])))) {
            return true;
        }
    }
    return false;
}

std::string ensure_trailing_newline(std::string s) {
    if (s.empty() || s.back() != '\n') s.push_back('\n');
    return s;
}

std::string indent_block(std::string_view s, std::size_t spaces) {
    const std::string pad(spaces, ' ');
    std::ostringstream ss;
    for (const auto& line : split_lines(s)) {
        ss << pad << line << "\n";
    }
    return ss.str();
}

std::string wrap_paragraph(std::string_view s, std::size_t width) {
    if (width < 8) width = 8;
    std::istringstream iss{std::string(s)};
    std::string token;
    std::ostringstream out;
    std::size_t col = 0;
    bool first = true;
    while (iss >> token) {
        if (!first) {
            if (col + 1 + token.size() > width) {
                out << "\n";
                col = 0;
            } else {
                out << " ";
                ++col;
            }
        }
        out << token;
        col += token.size();
        first = false;
    }
    return out.str();
}

std::string common_prefix(std::string_view a, std::string_view b) {
    const std::size_t n = std::min(a.size(), b.size());
    std::size_t i = 0;
    while (i < n && a[i] == b[i]) ++i;
    return std::string(a.substr(0, i));
}

std::vector<std::string> unique_sorted(std::vector<std::string> items) {
    std::sort(items.begin(), items.end());
    items.erase(std::unique(items.begin(), items.end()), items.end());
    return items;
}

std::string percent(double num, double den, int digits) {
    if (den == 0.0) return "n/a";
    const double p = 100.0 * num / den;
    std::ostringstream ss;
    ss.setf(std::ios::fixed);
    ss.precision(digits);
    ss << p << "%";
    return ss.str();
}

bool is_blank(std::string_view s) {
    return trim(s).empty();
}

std::string repeat(std::string_view unit, std::size_t n) {
    std::string out;
    out.reserve(unit.size() * n);
    for (std::size_t i = 0; i < n; ++i) out.append(unit);
    return out;
}

std::string pad_right(std::string s, std::size_t width, char ch) {
    if (s.size() >= width) return s;
    s.append(width - s.size(), ch);
    return s;
}

std::string pad_left(std::string s, std::size_t width, char ch) {
    if (s.size() >= width) return s;
    return std::string(width - s.size(), ch) + s;
}

std::size_t count_substring(std::string_view hay, std::string_view needle) {
    if (needle.empty()) return 0;
    std::size_t count = 0;
    std::size_t pos = 0;
    while ((pos = hay.find(needle, pos)) != std::string::npos) {
        ++count;
        pos += needle.size();
    }
    return count;
}

std::string strip_prefix(std::string s, std::string_view prefix) {
    if (starts_with(s, prefix)) return s.substr(prefix.size());
    return s;
}

std::string strip_suffix(std::string s, std::string_view suffix) {
    if (ends_with(s, suffix)) return s.substr(0, s.size() - suffix.size());
    return s;
}

std::vector<std::string> filter_nonempty(std::vector<std::string> items) {
    std::vector<std::string> out;
    for (auto& i : items) {
        if (!is_blank(i)) out.push_back(std::move(i));
    }
    return out;
}

std::string format_kv_list(const std::vector<std::pair<std::string, std::string>>& kvs) {
    std::ostringstream ss;
    for (const auto& kv : kvs) {
        ss << kv.first << "=" << kv.second << "\n";
    }
    return ss.str();
}

}  // namespace text
}  // namespace handoffkit
