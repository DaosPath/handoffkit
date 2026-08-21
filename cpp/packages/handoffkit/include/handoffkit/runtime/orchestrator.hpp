#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/agent.hpp>
#include <handoffkit/runtime/protocol.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/core/quality.hpp>

#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

struct OrchestratorStage {
    std::string name;
    std::vector<std::string> agent_names;
    ProtocolMode protocol = ProtocolMode::HybridState;
    bool quality_gate = false;
    double min_quality = 0.5;
    int max_retries = 0;
    std::string rescue_agent;  // optional single-agent rescue on failure
};

struct OrchestratorPlan {
    std::string name;
    std::string description;
    std::vector<OrchestratorStage> stages;
    nlohmann::json metadata = nlohmann::json::object();
};

struct StageRunRecord {
    std::string stage_name;
    bool success = false;
    int attempts = 0;
    TeamRunResult team_result;
    HandoffQualityReport quality;
    std::string notes;
    nlohmann::json to_json() const;
};

struct OrchestratorResult {
    bool success = false;
    std::string plan_name;
    std::string task;
    std::string final_output;
    std::vector<StageRunRecord> stages;
    std::vector<HandoffState> all_handoffs;
    RunTrace trace;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
};

/// Multi-stage team orchestrator with optional quality gates, retries, and rescue agents.
class Orchestrator {
public:
    explicit Orchestrator(std::vector<Agent> agents) : agents_(std::move(agents)) {}

    Result<OrchestratorResult> run(const OrchestratorPlan& plan, std::string_view task);

    /// Built-in plans used by CLI/demos.
    static OrchestratorPlan support_escalation_plan();
    static OrchestratorPlan coding_ship_plan();
    static OrchestratorPlan research_then_edit_plan();
    static OrchestratorPlan incident_with_rescue_plan();
    static OrchestratorPlan product_to_eng_plan();
    static std::vector<OrchestratorPlan> catalog();

private:
    Agent* find(const std::string& name);
    Result<TeamRunResult> run_stage_team(
        const OrchestratorStage& stage,
        std::string_view task,
        const HandoffState* inbound
    );

    std::vector<Agent> agents_;
};

}  // namespace handoffkit
