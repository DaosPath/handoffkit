#include <handoffkit/demos/fusion/prompt.hpp>

#include <cctype>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

char map_cp1252ish(unsigned char c) {
    // Common mojibake / Windows bytes that break UTF-8 JSON.
    switch (c) {
        case 0x91:
        case 0x92: return '\'';
        case 0x93:
        case 0x94: return '"';
        case 0x96:
        case 0x97: return '-';
        case 0x85: return '.';
        case 0xA0: return ' ';
        default: break;
    }
    if (c < 0x20 && c != '\n' && c != '\r' && c != '\t') return ' ';
    return static_cast<char>(c);
}

}  // namespace

std::string sanitize_prompt_text(std::string_view input, bool ascii_only) {
    std::string out;
    out.reserve(input.size());
    std::size_t i = 0;
    // UTF-8 BOM
    if (input.size() >= 3 &&
        static_cast<unsigned char>(input[0]) == 0xEF &&
        static_cast<unsigned char>(input[1]) == 0xBB &&
        static_cast<unsigned char>(input[2]) == 0xBF) {
        i = 3;
    }
    while (i < input.size()) {
        const auto c0 = static_cast<unsigned char>(input[i]);
        // UTF-8 em dash E2 80 94, en dash E2 80 93, curly quotes, etc.
        if (c0 == 0xE2 && i + 2 < input.size()) {
            const auto c1 = static_cast<unsigned char>(input[i + 1]);
            const auto c2 = static_cast<unsigned char>(input[i + 2]);
            if (c1 == 0x80 && (c2 == 0x93 || c2 == 0x94)) {
                out.push_back('-');
                i += 3;
                continue;
            }
            if (c1 == 0x80 && (c2 == 0x98 || c2 == 0x99)) {
                out.push_back('\'');
                i += 3;
                continue;
            }
            if (c1 == 0x80 && (c2 == 0x9C || c2 == 0x9D)) {
                out.push_back('"');
                i += 3;
                continue;
            }
            if (c1 == 0x80 && c2 == 0xA6) {
                out.append("...");
                i += 3;
                continue;
            }
        }
        if (ascii_only) {
            if (c0 > 0x7F) {
                // drop or map single bad byte
                const char mapped = map_cp1252ish(c0);
                if (static_cast<unsigned char>(mapped) <= 0x7F) {
                    out.push_back(mapped == static_cast<char>(c0) ? '?' : mapped);
                } else {
                    out.push_back('?');
                }
                ++i;
                continue;
            }
            out.push_back(map_cp1252ish(c0));
            ++i;
            continue;
        }
        out.push_back(static_cast<char>(c0));
        ++i;
    }
    // collapse excessive blank lines
    std::string collapsed;
    collapsed.reserve(out.size());
    int nl = 0;
    for (char c : out) {
        if (c == '\n') {
            ++nl;
            if (nl <= 2) collapsed.push_back(c);
        } else {
            nl = 0;
            collapsed.push_back(c);
        }
    }
    return collapsed;
}

std::string truncate_with_marker(std::string_view input, std::size_t max_chars, std::string_view marker) {
    if (max_chars == 0 || input.size() <= max_chars) return std::string(input);
    if (max_chars <= marker.size() + 8) {
        return std::string(input.substr(0, max_chars));
    }
    const std::size_t keep = max_chars - marker.size();
    std::string out;
    out.reserve(max_chars);
    out.append(input.data(), keep);
    out.append(marker.data(), marker.size());
    return out;
}

std::string render_template(
    std::string_view tmpl,
    const std::unordered_map<std::string, std::string>& vars,
    bool remove_unknown
) {
    std::string out;
    out.reserve(tmpl.size() + 64);
    for (std::size_t i = 0; i < tmpl.size();) {
        if (tmpl[i] == '{' && i + 1 < tmpl.size() && tmpl[i + 1] == '{') {
            const auto end = tmpl.find("}}", i + 2);
            if (end == std::string_view::npos) {
                out.push_back(tmpl[i]);
                ++i;
                continue;
            }
            std::string key(tmpl.substr(i + 2, end - (i + 2)));
            // trim spaces
            while (!key.empty() && std::isspace(static_cast<unsigned char>(key.front()))) key.erase(key.begin());
            while (!key.empty() && std::isspace(static_cast<unsigned char>(key.back()))) key.pop_back();
            auto it = vars.find(key);
            if (it != vars.end()) {
                out += it->second;
            } else if (!remove_unknown) {
                out.append(tmpl.substr(i, end + 2 - i));
            }
            i = end + 2;
            continue;
        }
        out.push_back(tmpl[i]);
        ++i;
    }
    return out;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
