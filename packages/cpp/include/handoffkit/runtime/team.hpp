#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/agent.hpp>
#include <handoffkit/runtime/protocol.hpp>

#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace handoffkit {

struct AgentOutput {
    std::string agent;
    std::string output;

    nlohmann::json to_json() const {
        return nlohmann::json{{"agent", agent}, {"output", output}};
    }
};

struct TeamRunResult {
    std::string task;
    std::string final_output;
    std::vector<AgentOutput> agent_outputs;
    std::vector<HandoffState> handoffs;
    bool success = true;

    nlohmann::json to_json() const {
        nlohmann::json outputs = nlohmann::json::array();
        for (const auto& item : agent_outputs) {
            outputs.push_back(item.to_json());
        }
        nlohmann::json handoff_json = nlohmann::json::array();
        for (const auto& handoff : handoffs) {
            handoff_json.push_back(handoff.to_json());
        }
        return nlohmann::json{
            {"task", task},
            {"final_output", final_output},
            {"agent_outputs", std::move(outputs)},
            {"handoffs", std::move(handoff_json)},
            {"success", success},
        };
    }
};

class Team {
public:
    explicit Team(std::vector<Agent> agents, HandoffProtocol protocol = HandoffProtocol{})
        : agents_(std::move(agents)), protocol_(std::move(protocol)) {}

    [[nodiscard]] const std::vector<Agent>& agents() const noexcept { return agents_; }
    [[nodiscard]] const HandoffProtocol& protocol() const noexcept { return protocol_; }

    Result<TeamRunResult> run(std::string_view task);

private:
    std::vector<Agent> agents_;
    HandoffProtocol protocol_;
};

}  // namespace handoffkit
