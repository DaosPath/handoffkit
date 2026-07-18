#include <handoffkit/workflows/recipe.hpp>

namespace handoffkit {

nlohmann::json RecipeRunResult::to_json() const {
    nlohmann::json outputs = nlohmann::json::array();
    for (const auto& item : agent_outputs) {
        outputs.push_back(item.to_json());
    }
    nlohmann::json handoff_json = nlohmann::json::array();
    for (const auto& h : handoffs) {
        handoff_json.push_back(h.to_json());
    }
    return nlohmann::json{
        {"success", success},
        {"recipe_name", recipe_name},
        {"task", task},
        {"final_output", final_output},
        {"agent_outputs", std::move(outputs)},
        {"handoffs", std::move(handoff_json)},
        {"trace", trace.to_json()},
        {"metadata", metadata.is_null() ? nlohmann::json::object() : metadata},
    };
}

Agent* RecipeRunner::find_agent(const std::string& name) {
    for (auto& agent : agents_) {
        if (agent.name() == name) {
            return &agent;
        }
    }
    return nullptr;
}

Result<RecipeRunResult> RecipeRunner::run(const Recipe& recipe, std::string_view task) {
    if (recipe.steps.empty()) {
        return Error::invalid_argument("Recipe has no steps", "steps");
    }
    if (task.empty()) {
        return Error::invalid_argument("Task cannot be empty", "task");
    }

    RecipeRunResult result;
    result.recipe_name = recipe.name;
    result.task = std::string(task);
    result.metadata = recipe.metadata.is_null() ? nlohmann::json::object() : recipe.metadata;
    result.metadata["protocol_mode"] = std::string(protocol_mode_name(recipe.protocol));

    protocol_ = HandoffProtocol(recipe.protocol);
    std::string current_output;
    Agent* previous = nullptr;

    for (std::size_t i = 0; i < recipe.steps.size(); ++i) {
        const auto& step = recipe.steps[i];
        Agent* agent = find_agent(step.agent_name);
        if (agent == nullptr) {
            return Error::invalid_argument("Unknown agent in recipe: " + step.agent_name, "agent_name");
        }

        if (previous != nullptr && step.require_handoff) {
            TransferOptions transfer;
            transfer.task = result.task;
            transfer.from_agent = previous->name();
            transfer.to_agent = agent->name();
            transfer.summary = current_output;
            transfer.decisions = {
                previous->name() + " completed recipe step before " + step.name
            };
            transfer.next_steps = {
                "Implement " + step.name,
                agent->name() + " should continue from structured handoff"
            };
            auto handoff = protocol_.transfer(transfer);
            if (!handoff) {
                return handoff.error();
            }
            result.handoffs.push_back(std::move(handoff.value()));
        }

        RunOptions opts;
        if (!result.handoffs.empty() && step.require_handoff && previous != nullptr) {
            opts.handoff = &result.handoffs.back();
        }
        const std::string step_task = result.task + "\n\nStep: " + step.name + "\n" + step.instruction;
        auto out = agent->run(step_task, opts);
        if (!out) {
            return out.error();
        }
        current_output = std::move(out.value());
        result.agent_outputs.push_back(AgentOutput{agent->name(), current_output});
        previous = agent;
    }

    result.final_output = current_output;
    result.success = true;
    TeamRunResult team_view;
    team_view.task = result.task;
    team_view.final_output = result.final_output;
    team_view.agent_outputs = result.agent_outputs;
    team_view.handoffs = result.handoffs;
    team_view.success = true;
    result.trace = build_run_trace(
        "recipe-" + recipe.name,
        recipe.name,
        team_view,
        protocol_mode_name(recipe.protocol)
    );
    return Result<RecipeRunResult>::success(std::move(result));
}

}  // namespace handoffkit
