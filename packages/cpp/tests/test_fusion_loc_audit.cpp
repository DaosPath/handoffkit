#include <handoffkit/demos/fusion/audit_loc.hpp>

#include <filesystem>
#include <iostream>
#include <vector>

using namespace handoffkit::demos::fusion;

namespace {

bool looks_like_packages_cpp(const std::filesystem::path& p) {
    return std::filesystem::exists(p / "src" / "demos" / "fusion") &&
           std::filesystem::exists(p / "include" / "handoffkit");
}

/// Resolve packages/cpp whether ctest cwd is repo root, packages/cpp, or packages/cpp/build*.
std::filesystem::path find_packages_cpp_root() {
    namespace fs = std::filesystem;
    std::vector<fs::path> candidates = {
        ".",
        "..",
        "packages/cpp",
        "../packages/cpp",
        "../../packages/cpp",
        "../../../packages/cpp",
    };

    std::error_code ec;
    const fs::path cwd = fs::current_path(ec);
    if (!ec) {
        // Walk up from cwd (covers build/, build-http/, out-of-tree builds a few levels deep).
        fs::path walk = cwd;
        for (int i = 0; i < 8 && !walk.empty(); ++i) {
            candidates.push_back(walk);
            candidates.push_back(walk / "packages" / "cpp");
            if (!walk.has_parent_path() || walk.parent_path() == walk) break;
            walk = walk.parent_path();
        }
    }

    for (const auto& c : candidates) {
        if (looks_like_packages_cpp(c)) {
            return fs::weakly_canonical(c, ec);
        }
    }
    return {};
}

}  // namespace

// Baseline LOC report for the main fusion demo surface.
// No longer gated on >=30000 lines (pure algorithm islands were removed).
int main() {
    const auto root = find_packages_cpp_root();
    if (root.empty()) {
        std::cerr << "packages/cpp root not found (cwd="
                  << std::filesystem::current_path().string() << ")\n";
        return 2;
    }

    const LocAudit audit = audit_fusion_suite_loc(root.string());
    std::cout << "root=" << root << "\n";
    std::cout << format_loc_audit(audit);
    std::cout << "TOTAL_COUNTED=" << audit.counted_lines
              << " TOTAL_ALL=" << audit.total_lines
              << " PAD_FILES=" << audit.pad_file_count
              << " FILES=" << audit.file_count << "\n";

    // Fail only if known pad patterns reappear (not on absolute LOC).
    if (audit.pad_file_count != 0) {
        std::cerr << "FAIL: pad files present: " << audit.pad_file_count << "\n";
        return 1;
    }
    // Sanity: main demo surface must still have non-trivial code.
    if (audit.counted_lines < 1000) {
        std::cerr << "FAIL: fusion suite too small after prune: " << audit.counted_lines << "\n";
        return 1;
    }
    // Structural: pure_* self-islands should be gone.
    for (const auto& f : audit.files) {
        const auto& p = f.path;
        if (p.find("pure_") != std::string::npos && p.find("pure_book") == std::string::npos) {
            // allow nothing: any pure_ under demos/fusion is a prune miss
            if (p.find("demos/fusion") != std::string::npos || p.find("demos\\fusion") != std::string::npos
                || p.find("test_fusion_pure") != std::string::npos) {
                std::cerr << "FAIL: leftover pure island: " << p << "\n";
                return 1;
            }
        }
    }
    std::cout << "fusion LOC baseline ok (no pad, no pure_* islands, counted=" << audit.counted_lines << ")\n";
    return 0;
}
