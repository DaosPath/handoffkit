#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/memory.hpp>
#include <handoffkit/runtime/provider.hpp>
#include <handoffkit/runtime/tool.hpp>

#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace handoffkit {

struct RunOptions {
    const HandoffState* handoff = nullptr;
    std::string_view context;
};

struct AgentRunResult {
    std::string agent_name;
    std::string task;
    std::string final_output;
    bool success = true;
    std::string provider;
    std::string model;

    nlohmann::json to_json() const {
        return nlohmann::json{
            {"agent_name", agent_name},
            {"task", task},
            {"final_output", final_output},
            {"success", success},
            {"provider", provider},
            {"model", model},
        };
    }
};

class Agent {
public:
    Agent(std::string name, std::string role, AnyProvider provider = {})
        : name_(std::move(name)),
          role_(std::move(role)),
          provider_(std::move(provider)),
          memory_(std::make_shared<AgentMemory>()) {}

    Agent& add_tool(Tool tool) {
        tools_.add(std::move(tool));
        return *this;
    }

    [[nodiscard]] const std::string& name() const noexcept { return name_; }
    [[nodiscard]] const std::string& role() const noexcept { return role_; }
    [[nodiscard]] const AnyProvider& provider() const noexcept { return provider_; }
    [[nodiscard]] ToolRegistry& tools() noexcept { return tools_; }
    [[nodiscard]] const ToolRegistry& tools() const noexcept { return tools_; }
    [[nodiscard]] AgentMemory& memory() noexcept { return *memory_; }
    [[nodiscard]] const AgentMemory& memory() const noexcept { return *memory_; }

    Result<std::string> run(std::string_view task, const RunOptions& options = {});
    Result<AgentRunResult> run_detailed(std::string_view task, const RunOptions& options = {});

private:
    std::string build_prompt(std::string_view task, const RunOptions& options) const;

    std::string name_;
    std::string role_;
    AnyProvider provider_;
    ToolRegistry tools_;
    std::shared_ptr<AgentMemory> memory_;
};

}  // namespace handoffkit
