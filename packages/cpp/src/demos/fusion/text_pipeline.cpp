#include <handoffkit/demos/fusion/text_pipeline.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/metrics.hpp>
#include <handoffkit/demos/fusion/branch_compare.hpp>

#include <cctype>

namespace handoffkit {
namespace demos {
namespace fusion {

nlohmann::json TextPipelineStats::to_json() const {
    return nlohmann::json{
        {"raw_chars", raw_chars},
        {"sanitized_chars", sanitized_chars},
        {"tokens", tokens},
        {"sentences", sentences},
        {"bullets", bullets},
        {"digit_tokens", digit_tokens},
        {"upper_runs", upper_runs},
    };
}

std::vector<std::string> split_sentences(std::string_view text) {
    std::vector<std::string> out;
    std::string cur;
    for (std::size_t i = 0; i < text.size(); ++i) {
        char c = text[i];
        cur.push_back(c);
        if (c == '.' || c == '!' || c == '?') {
            // avoid splitting decimals roughly
            if (c == '.' && i + 1 < text.size() && std::isdigit(static_cast<unsigned char>(text[i + 1]))) {
                continue;
            }
            // trim
            while (!cur.empty() && std::isspace(static_cast<unsigned char>(cur.front()))) cur.erase(cur.begin());
            while (!cur.empty() && std::isspace(static_cast<unsigned char>(cur.back()))) cur.pop_back();
            if (!cur.empty()) out.push_back(cur);
            cur.clear();
        }
    }
    while (!cur.empty() && std::isspace(static_cast<unsigned char>(cur.front()))) cur.erase(cur.begin());
    while (!cur.empty() && std::isspace(static_cast<unsigned char>(cur.back()))) cur.pop_back();
    if (!cur.empty()) out.push_back(cur);
    return out;
}

std::vector<std::string> split_paragraphs(std::string_view text) {
    std::vector<std::string> out;
    std::string cur;
    int nl = 0;
    for (char c : text) {
        if (c == '\n') {
            ++nl;
            if (nl >= 2) {
                while (!cur.empty() && (cur.back() == '\n' || cur.back() == ' ')) cur.pop_back();
                if (!cur.empty()) out.push_back(cur);
                cur.clear();
                nl = 0;
            } else {
                cur.push_back(c);
            }
        } else {
            nl = 0;
            cur.push_back(c);
        }
    }
    while (!cur.empty() && std::isspace(static_cast<unsigned char>(cur.back()))) cur.pop_back();
    if (!cur.empty()) out.push_back(cur);
    return out;
}

std::string collapse_whitespace(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    bool sp = false;
    for (char c : text) {
        if (std::isspace(static_cast<unsigned char>(c))) {
            if (!sp) out.push_back(' ');
            sp = true;
        } else {
            out.push_back(c);
            sp = false;
        }
    }
    while (!out.empty() && out.front() == ' ') out.erase(out.begin());
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

std::string strip_markdown_emphasis(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '*' || text[i] == '_') {
            // skip emphasis markers but keep content
            continue;
        }
        if (text[i] == '`' ) continue;
        out.push_back(text[i]);
    }
    return out;
}

int count_digit_tokens(const std::vector<std::string>& tokens) {
    int n = 0;
    for (const auto& t : tokens) {
        bool any = false;
        for (char c : t) {
            if (std::isdigit(static_cast<unsigned char>(c))) {
                any = true;
                break;
            }
        }
        if (any) ++n;
    }
    return n;
}

int count_uppercase_runs(std::string_view text) {
    int runs = 0;
    int run = 0;
    for (char c : text) {
        if (c >= 'A' && c <= 'Z') {
            ++run;
        } else {
            if (run >= 2) ++runs;
            run = 0;
        }
    }
    if (run >= 2) ++runs;
    return runs;
}

TextPipelineStats analyze_text_pipeline(std::string_view text, bool ascii_sanitize) {
    TextPipelineStats st;
    st.raw_chars = text.size();
    std::string s = ascii_sanitize ? sanitize_prompt_text(text, true) : std::string(text);
    s = strip_markdown_emphasis(s);
    s = collapse_whitespace(s);
    st.sanitized_chars = s.size();
    auto toks = tokenize_simple(s);
    st.tokens = toks.size();
    st.sentences = split_sentences(s).size();
    st.bullets = extract_bullet_lines(text).size();
    st.digit_tokens = count_digit_tokens(toks);
    st.upper_runs = count_uppercase_runs(text);
    return st;
}

std::string guess_primary_label(std::string_view model_output) {
    // Look for patterns: "Primary diagnosis: X" or first non-empty line
    std::string low(model_output);
    for (char& c : low) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    const char* keys[] = {
        "primary diagnosis:",
        "primary dx:",
        "diagnosis:",
        "1) primary diagnosis",
        "1. primary diagnosis",
    };
    for (const char* k : keys) {
        auto pos = low.find(k);
        if (pos != std::string::npos) {
            auto start = pos + std::char_traits<char>::length(k);
            while (start < low.size() && std::isspace(static_cast<unsigned char>(low[start]))) ++start;
            std::size_t end = start;
            while (end < low.size() && low[end] != '\n' && low[end] != ';') ++end;
            std::string label = std::string(model_output.substr(start, end - start));
            while (!label.empty() && std::isspace(static_cast<unsigned char>(label.back()))) label.pop_back();
            return label;
        }
    }
    auto lines = extract_bullet_lines(model_output);
    if (!lines.empty()) return lines.front();
    // first line
    std::string line;
    for (char c : model_output) {
        if (c == '\n') break;
        line.push_back(c);
    }
    while (!line.empty() && std::isspace(static_cast<unsigned char>(line.front()))) line.erase(line.begin());
    return line;
}

bool looks_like_shipping_plan(std::string_view text) {
    std::string low(text);
    for (char& c : low) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    int hits = 0;
    if (low.find("goals") != std::string::npos) ++hits;
    if (low.find("architecture") != std::string::npos) ++hits;
    if (low.find("next steps") != std::string::npos) ++hits;
    if (low.find("cmake") != std::string::npos) ++hits;
    if (low.find("conan") != std::string::npos) ++hits;
    if (low.find("cli") != std::string::npos && low.find("handoffkit") != std::string::npos) ++hits;
    return hits >= 3;
}

bool prompt_has_task_faithful_rules(std::string_view merge_prompt) {
    std::string low(merge_prompt);
    for (char& c : low) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    const bool has_original = low.find("original task") != std::string::npos;
    const bool bans_product = low.find("product roadmap") != std::string::npos
        || low.find("packaging plan") != std::string::npos
        || low.find("do not invent") != std::string::npos;
    return has_original && bans_product;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
