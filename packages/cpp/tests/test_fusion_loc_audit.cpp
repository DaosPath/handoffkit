#include <handoffkit/demos/fusion/audit_loc.hpp>

#include <filesystem>
#include <iostream>

using namespace handoffkit::demos::fusion;

// Baseline LOC report for the main fusion demo surface.
// No longer gated on >=30000 lines (pure algorithm islands were removed).
int main() {
    std::vector<std::filesystem::path> candidates = {
        "packages/cpp",
        "../packages/cpp",
        "../../packages/cpp",
        "packages/cpp",
    };
    LocAudit audit;
    std::filesystem::path root;
    for (const auto& c : candidates) {
        if (std::filesystem::exists(c / "src" / "demos" / "fusion")) {
            root = c;
            audit = audit_fusion_suite_loc(c.string());
            std::cout << "root=" << c << "\n";
            break;
        }
    }
    if (root.empty()) {
        std::cerr << "packages/cpp root not found\n";
        return 2;
    }
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
