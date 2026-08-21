#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <filesystem>
#include <string>

namespace handoffkit {

[[nodiscard]] std::string render_trace_html(const RunTrace& trace);
[[nodiscard]] std::string render_team_html(const TeamRunResult& result);
[[nodiscard]] std::string render_quality_html(const HandoffQualityReport& report);

[[nodiscard]] Result<std::string> write_html_report(
    const std::filesystem::path& path,
    const std::string& html
);

}  // namespace handoffkit
