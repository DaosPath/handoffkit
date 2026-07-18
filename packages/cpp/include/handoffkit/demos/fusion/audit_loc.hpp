#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct LocFileStat {
    std::string path;
    std::size_t lines = 0;
    std::size_t code_lines = 0;       // non-blank, non-//-only
    std::size_t control_flow_hits = 0; // if/for/while/switch/case/return/?
    std::size_t raw_string_lines = 0;
    std::size_t numbered_clone_defs = 0;  // fusion_foo_00 / make_rule_12 style defs
    bool pad_like = false;
    std::string pad_reason;
};

struct LocAudit {
    std::size_t total_lines = 0;
    std::size_t counted_lines = 0;  // excludes pad-like files
    std::size_t file_count = 0;
    std::size_t pad_file_count = 0;
    std::vector<LocFileStat> files;
    std::vector<LocFileStat> pad_files;
};

/// Classify path/content as pad (corpus dumps, batch clones, data-only TUs).
[[nodiscard]] bool is_pad_path(const std::string& path);
[[nodiscard]] bool is_pad_content(const LocFileStat& st);

[[nodiscard]] LocAudit audit_fusion_suite_loc(const std::string& packages_cpp_root);
[[nodiscard]] std::string format_loc_audit(const LocAudit& audit);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
