#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/agent.hpp>
#include <handoffkit/runtime/protocol.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <functional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace handoffkit {

struct RecipeStep {
    std::string name;
    std::string agent_name;
    std::string instruction;
    bool require_handoff = true;
};

struct Recipe {
    std::string name;
    std::string description;
    ProtocolMode protocol = ProtocolMode::HybridState;
    std::vector<RecipeStep> steps;
    nlohmann::json metadata = nlohmann::json::object();
};

struct RecipeRunResult {
    bool success = false;
    std::string recipe_name;
    std::string task;
    std::string final_output;
    std::vector<AgentOutput> agent_outputs;
    std::vector<HandoffState> handoffs;
    RunTrace trace;
    nlohmann::json metadata = nlohmann::json::object();

    nlohmann::json to_json() const;
};

/// Sequential multi-step recipe runner (offline). Agents are looked up by name.
class RecipeRunner {
public:
    RecipeRunner(std::vector<Agent> agents, HandoffProtocol protocol = HandoffProtocol{})
        : agents_(std::move(agents)), protocol_(std::move(protocol)) {}

    Result<RecipeRunResult> run(const Recipe& recipe, std::string_view task);

private:
    Agent* find_agent(const std::string& name);
    std::vector<Agent> agents_;
    HandoffProtocol protocol_;
};

}  // namespace handoffkit
