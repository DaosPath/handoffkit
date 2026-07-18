#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/team.hpp>

#include <filesystem>
#include <string>
#include <string_view>

namespace handoffkit {

/// Write a JSON object report to path (pretty-printed). Returns path on success.
[[nodiscard]] Result<std::string> write_report_json(
    const std::filesystem::path& path,
    const nlohmann::json& report
);

/// Convenience: write RunTrace as report JSON.
[[nodiscard]] Result<std::string> write_report_json(
    const std::filesystem::path& path,
    const RunTrace& trace
);

/// Convenience: write TeamRunResult as report JSON (snake_case wire).
[[nodiscard]] Result<std::string> write_report_json(
    const std::filesystem::path& path,
    const TeamRunResult& result
);

[[nodiscard]] Result<nlohmann::json> load_report_json(const std::filesystem::path& path);

/// Also write a sidecar .md timeline when writing a RunTrace.
[[nodiscard]] Result<std::string> write_report_files(
    const std::filesystem::path& directory,
    std::string_view basename,
    const RunTrace& trace
);

}  // namespace handoffkit
