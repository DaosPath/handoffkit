#include <handoffkit/demos/fusion/audit_loc.hpp>

#include <filesystem>
#include <fstream>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

bool is_fusion_source_path(const std::filesystem::path& p) {
    const auto ext = p.extension().string();
    if (ext != ".cpp" && ext != ".hpp" && ext != ".h") return false;
    const auto s = p.generic_string();
    if (s.find("/demos/fusion/") != std::string::npos) return true;
    if (s.find("\\demos\\fusion\\") != std::string::npos) return true;
    if (s.find("/include/handoffkit/demos/fusion/") != std::string::npos) return true;
    if (s.find("\\include\\handoffkit\\demos\\fusion\\") != std::string::npos) return true;
    const auto name = p.filename().string();
    if (name.rfind("test_fusion_", 0) == 0) return true;
    return false;
}

bool path_looks_pad(const std::string& path) {
    const auto lower = [&]() {
        std::string s = path;
        for (char& c : s) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        return s;
    }();
    if (lower.find("ops_text_batch_") != std::string::npos) return true;
    if (lower.find("ops_score_batch_") != std::string::npos) return true;
    if (lower.find("ops_cache_batch_") != std::string::npos) return true;
    if (lower.find("ops_prompt_batch_") != std::string::npos) return true;
    if (lower.find("ops_struct_batch_") != std::string::npos) return true;
    if (lower.find("ops_engine_batch_") != std::string::npos) return true;
    if (lower.find("scenarios_ext") != std::string::npos) return true;
    if (lower.find("cases_medcase_") != std::string::npos && lower.find("loader") == std::string::npos) {
        return true;  // embedded corpus chunks
    }
    if (lower.find("gen_fusion_ops") != std::string::npos) return true;
    if (lower.find("gen_medcase") != std::string::npos) return true;
    if (lower.find("bench_fixtures_ext") != std::string::npos) return true;
    if (lower.find("pure_book_") != std::string::npos) return true;  // template-skeleton pad family
    if (lower.find("gen_template_diverse") != std::string::npos) return true;
    return false;
}

bool looks_like_numbered_clone_def(const std::string& t) {
    // Detect parameter-cycled clone families that previously padded LOC:
    //   static double fusion_rank_feature_00(...)
    //   PolicyRule make_rule_12()
    //   static int fusion_dag_priority_07(...)
    // Require a function-def-like line ending with _NN(
    auto is_digit = [](char c) { return c >= '0' && c <= '9'; };
    auto is_ident = [&](char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
    };
    // find "_DD(" patterns
    for (std::size_t i = 0; i + 3 < t.size(); ++i) {
        if (t[i] != '_') continue;
        if (!is_digit(t[i + 1]) || !is_digit(t[i + 2])) continue;
        // optional more digits? only exactly 2 for NN families
        if (i + 3 < t.size() && is_digit(t[i + 3])) continue;
        // preceding must be identifier char (name stem)
        if (i == 0 || !is_ident(t[i - 1])) continue;
        // skip whitespace then '('
        std::size_t j = i + 3;
        while (j < t.size() && (t[j] == ' ' || t[j] == '\t')) ++j;
        if (j >= t.size() || t[j] != '(') continue;
        // line should look like a definition: contains return type-ish tokens or starts with static
        // exclude pure calls like foo_00(x) mid-expression by requiring start-ish identifiers
        std::size_t k = 0;
        while (k < t.size() && (t[k] == ' ' || t[k] == '\t')) ++k;
        if (k >= t.size()) continue;
        // accept: static ... name_NN(  OR  Type name_NN(
        if (t.compare(k, 7, "static ") == 0) return true;
        if (t.compare(k, 6, "inline") == 0) return true;
        // common return types at line start
        if (t.compare(k, 4, "void") == 0 || t.compare(k, 3, "int") == 0 || t.compare(k, 4, "bool") == 0
            || t.compare(k, 4, "long") == 0 || t.compare(k, 6, "double") == 0
            || t.compare(k, 6, "float ") == 0 || t.compare(k, 8, "unsigned") == 0
            || t.compare(k, 11, "std::string") == 0 || t.compare(k, 12, "std::vector") == 0
            || t.compare(k, 9, "uint64_t") == 0 || t.compare(k, 9, "uint32_t") == 0
            || t.compare(k, 11, "PolicyRule") == 0 || t.compare(k, 13, "nlohmann::json") == 0) {
            return true;
        }
        // make_rule_NN at beginning of line after type
        if (t.find("make_rule_") != std::string::npos) return true;
        if (t.find("fusion_") != std::string::npos) return true;
    }
    return false;
}

void analyze_line(const std::string& line, LocFileStat& st, bool& in_raw) {
    // track raw strings R"...(  ... )" or R"DELIM( ... )DELIM"
    std::string t = line;
    // crude: count control-flow keywords
    auto has = [&](const char* k) {
        return t.find(k) != std::string::npos;
    };
    // strip leading spaces for comment detect
    std::size_t i = 0;
    while (i < t.size() && (t[i] == ' ' || t[i] == '\t')) ++i;
    const bool blank = i >= t.size();
    const bool comment = !blank && t.compare(i, 2, "//") == 0;
    if (!blank && !comment) ++st.code_lines;

    if (has("if ") || has("if(") || has("for ") || has("for(") || has("while ") || has("while(")
        || has("switch ") || has("switch(") || has("case ") || has("return ") || has("return;")
        || has(" ? ") || has("catch ") || has("throw ")) {
        ++st.control_flow_hits;
    }

    if (!blank && !comment && looks_like_numbered_clone_def(t)) {
        ++st.numbered_clone_defs;
    }

    // raw string open/close heuristic
    if (t.find("R\"") != std::string::npos && t.find('(') != std::string::npos) in_raw = true;
    if (in_raw) ++st.raw_string_lines;
    // close: )something"
    if (in_raw) {
        auto pos = t.find(')');
        if (pos != std::string::npos && t.find('"', pos) != std::string::npos) in_raw = false;
    }
}

LocFileStat scan_file(const std::filesystem::path& path) {
    LocFileStat st;
    st.path = path.generic_string();
    std::ifstream in(path, std::ios::binary);
    if (!in) return st;
    std::string line;
    bool in_raw = false;
    while (std::getline(in, line)) {
        ++st.lines;
        analyze_line(line, st, in_raw);
    }
    if (path_looks_pad(st.path)) {
        st.pad_like = true;
        st.pad_reason = "pad_filename_pattern";
        return st;
    }
    // structural: mostly raw strings / almost no control flow on large files
    if (st.lines >= 200) {
        const double raw_frac = st.lines ? double(st.raw_string_lines) / double(st.lines) : 0.0;
        const double cf_per_100 = st.lines ? (100.0 * double(st.control_flow_hits) / double(st.lines)) : 0.0;
        if (raw_frac >= 0.45 && cf_per_100 < 3.0) {
            st.pad_like = true;
            st.pad_reason = "data_table_raw_string_heavy";
        } else if (st.code_lines >= 150 && st.control_flow_hits < 8 && raw_frac >= 0.25) {
            st.pad_like = true;
            st.pad_reason = "low_control_flow_data_file";
        }
    }
    // Numbered clone families (fusion_foo_00..N / make_rule_12): combinatorial pad
    // even when each body contains if/for to satisfy CF density.
    if (!st.pad_like && st.numbered_clone_defs >= 8) {
        st.pad_like = true;
        st.pad_reason = "numbered_function_clone_family";
    } else if (!st.pad_like && st.lines >= 400 && st.numbered_clone_defs >= 4) {
        // large file with several clone defs still suspicious
        st.pad_like = true;
        st.pad_reason = "numbered_function_clone_family";
    }
    return st;
}

void walk(const std::filesystem::path& root, LocAudit& audit) {
    std::error_code ec;
    if (!std::filesystem::exists(root, ec)) return;
    for (std::filesystem::recursive_directory_iterator it(root, ec), end; it != end; it.increment(ec)) {
        if (ec) break;
        if (!it->is_regular_file()) continue;
        const auto p = it->path();
        const auto gs = p.generic_string();
        if (gs.find("/build") != std::string::npos || gs.find("\\build") != std::string::npos) continue;
        if (gs.find("/_deps/") != std::string::npos || gs.find("\\_deps\\") != std::string::npos) continue;
        if (!is_fusion_source_path(p)) continue;
        auto st = scan_file(p);
        audit.total_lines += st.lines;
        ++audit.file_count;
        if (st.pad_like) {
            ++audit.pad_file_count;
            audit.pad_files.push_back(st);
        } else {
            audit.counted_lines += st.lines;
            audit.files.push_back(std::move(st));
        }
    }
}

}  // namespace

bool is_pad_path(const std::string& path) { return path_looks_pad(path); }

bool is_pad_content(const LocFileStat& st) { return st.pad_like; }

LocAudit audit_fusion_suite_loc(const std::string& packages_cpp_root) {
    LocAudit audit;
    const std::filesystem::path root(packages_cpp_root);
    walk(root / "src" / "demos" / "fusion", audit);
    walk(root / "include" / "handoffkit" / "demos" / "fusion", audit);
    walk(root / "tests", audit);
    return audit;
}

std::string format_loc_audit(const LocAudit& audit) {
    std::ostringstream ss;
    ss << "fusion_suite_files=" << audit.file_count << "\n"
       << "fusion_suite_lines_all=" << audit.total_lines << "\n"
       << "fusion_suite_lines_counted=" << audit.counted_lines << "\n"
       << "fusion_suite_pad_files=" << audit.pad_file_count << "\n";
    for (const auto& f : audit.files) {
        ss << f.lines << "\t" << f.path << "\n";
    }
    if (!audit.pad_files.empty()) {
        ss << "# pad_excluded\n";
        for (const auto& f : audit.pad_files) {
            ss << "PAD\t" << f.lines << "\t" << f.pad_reason << "\t" << f.path << "\n";
        }
    }
    return ss.str();
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
