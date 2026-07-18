#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/agent.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

struct ReplayOptions {
    bool reexecute_agents = false;  // if true, re-run agents on step tasks with Echo
    bool revalidate_handoffs = true;
    bool rescore_quality = true;
    std::filesystem::path output_dir;
};

struct ReplayStepReport {
    std::string step_name;
    std::string agent;
    bool success = true;
    std::string original_output;
    std::string replay_output;
    nlohmann::json notes = nlohmann::json::object();
    nlohmann::json to_json() const;
};

struct ReplayReport {
    bool success = false;
    std::string source_run_id;
    std::string source_name;
    std::vector<ReplayStepReport> steps;
    std::vector<ValidationReport> handoff_validations;
    std::vector<HandoffQualityReport> handoff_qualities;
    std::string timeline;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

class ReplayRunner {
public:
    explicit ReplayRunner(std::vector<Agent> agents = {}) : agents_(std::move(agents)) {}

    Result<ReplayReport> replay(const RunTrace& trace, const ReplayOptions& options = {});
    Result<ReplayReport> replay_file(const std::filesystem::path& path, const ReplayOptions& options = {});

private:
    Agent* find(const std::string& name);
    std::vector<Agent> agents_;
};

}  // namespace handoffkit
