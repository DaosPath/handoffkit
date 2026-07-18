#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/orchestrator.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace handoffkit {

struct GalleryArtifact {
    std::string kind;  // json|md|html|timeline
    std::filesystem::path path;
    std::string summary;
};

struct GalleryReport {
    bool success = false;
    std::string title;
    std::vector<GalleryArtifact> artifacts;
    nlohmann::json index = nlohmann::json::object();
    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

/// Writes a multi-format offline report gallery for demos/CLI.
class ReportGallery {
public:
    explicit ReportGallery(std::filesystem::path root) : root_(std::move(root)) {}

    Result<GalleryReport> write_team_gallery(
        std::string_view name,
        const TeamRunResult& team,
        const RunTrace& trace,
        const WorkflowEvalReport* eval = nullptr
    ) const;

    Result<GalleryReport> write_orchestrator_gallery(
        std::string_view name,
        const OrchestratorResult& result,
        const WorkflowEvalReport* eval = nullptr
    ) const;

    Result<GalleryReport> write_quality_gallery(
        std::string_view name,
        const std::vector<HandoffState>& handoffs
    ) const;

    Result<GalleryReport> write_comparison_gallery(
        std::string_view name,
        const nlohmann::json& comparison_table
    ) const;

private:
    Result<std::string> write_text(const std::filesystem::path& path, const std::string& body) const;
    std::filesystem::path root_;
};

}  // namespace handoffkit
