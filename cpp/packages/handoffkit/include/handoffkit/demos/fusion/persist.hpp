#pragma once

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/error.hpp>

#include <filesystem>

namespace handoffkit {
namespace demos {
namespace fusion {

struct PersistPaths {
    std::filesystem::path root;
    std::filesystem::path manifest;
    std::filesystem::path config;
    std::filesystem::path metrics;
    std::filesystem::path report_md;
    std::filesystem::path report_json;
    std::filesystem::path report_html;
    std::filesystem::path handoffs;
    std::filesystem::path branches_dir;
};

[[nodiscard]] PersistPaths make_persist_paths(const std::filesystem::path& output_dir, const std::string& run_id);

Result<std::vector<std::string>> write_fusion_run(const FusionRunResult& run);

Result<FusionRunResult> load_fusion_run(const std::filesystem::path& run_root);

std::string fusion_run_html(const FusionRunResult& run);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
