#pragma once

#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace handoffkit {
namespace ml {

struct SftExample {
    std::string prompt;
    std::string completion;
    std::string chosen;    // preference (F5)
    std::string rejected;  // preference (F5)
};

namespace detail {

inline std::string extract_json_string(const std::string& line, const std::string& key) {
    // Minimal parser: "key"\s*:\s*"..."
    const std::string pat = "\"" + key + "\"";
    auto pos = line.find(pat);
    if (pos == std::string::npos) return {};
    pos = line.find(':', pos + pat.size());
    if (pos == std::string::npos) return {};
    pos = line.find('"', pos + 1);
    if (pos == std::string::npos) return {};
    ++pos;
    std::string out;
    while (pos < line.size()) {
        char c = line[pos++];
        if (c == '\\' && pos < line.size()) {
            char n = line[pos++];
            if (n == 'n') out.push_back('\n');
            else if (n == 't') out.push_back('\t');
            else if (n == '"') out.push_back('"');
            else if (n == '\\') out.push_back('\\');
            else out.push_back(n);
            continue;
        }
        if (c == '"') break;
        out.push_back(c);
    }
    return out;
}

}  // namespace detail

/// Load prompt/completion JSONL (same wire spirit as core train examples; no core link required).
[[nodiscard]] inline std::vector<SftExample> load_sft_jsonl(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open dataset: " + path);
    std::vector<SftExample> out;
    std::string line;
    while (std::getline(in, line)) {
        if (line.find_first_not_of(" \t\r\n") == std::string::npos) continue;
        SftExample ex;
        ex.prompt = detail::extract_json_string(line, "prompt");
        ex.completion = detail::extract_json_string(line, "completion");
        ex.chosen = detail::extract_json_string(line, "chosen");
        ex.rejected = detail::extract_json_string(line, "rejected");
        if (ex.prompt.empty() && ex.completion.empty() && ex.chosen.empty()) continue;
        out.push_back(std::move(ex));
    }
    if (out.empty()) throw std::runtime_error("empty dataset: " + path);
    return out;
}

[[nodiscard]] inline bool write_sft_jsonl(const std::string& path,
                                          const std::vector<SftExample>& examples) {
    {
        std::filesystem::path p(path);
        if (p.has_parent_path()) {
            std::error_code ec;
            std::filesystem::create_directories(p.parent_path(), ec);
        }
    }
    std::ofstream out(path, std::ios::binary);
    if (!out) return false;
    auto esc = [](const std::string& s) {
        std::string r;
        for (char c : s) {
            if (c == '\\' || c == '"') {
                r.push_back('\\');
                r.push_back(c);
            } else if (c == '\n') {
                r += "\\n";
            } else {
                r.push_back(c);
            }
        }
        return r;
    };
    for (const auto& ex : examples) {
        out << "{\"prompt\":\"" << esc(ex.prompt) << "\",\"completion\":\"" << esc(ex.completion)
            << "\"";
        if (!ex.chosen.empty()) out << ",\"chosen\":\"" << esc(ex.chosen) << "\"";
        if (!ex.rejected.empty()) out << ",\"rejected\":\"" << esc(ex.rejected) << "\"";
        out << "}\n";
    }
    return true;
}

}  // namespace ml
}  // namespace handoffkit
