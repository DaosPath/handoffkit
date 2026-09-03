#include <handoffkit/runtime/agent.hpp>

#include <sstream>

namespace handoffkit {

std::string Agent::build_prompt(std::string_view task, const RunOptions& options) const {
    std::ostringstream ss;
    ss << "Role: " << role_ << "\n";
    ss << "Task: " << task << "\n";
    if (options.handoff != nullptr) {
        ss << "\nHandoff state:\n" << options.handoff->to_markdown() << "\n";
    }
    if (!options.context.empty()) {
        ss << "\nContext:\n" << options.context << "\n";
    }
    return ss.str();
}

Result<std::string> Agent::run(std::string_view task, const RunOptions& options) {
    auto detailed = run_detailed(task, options);
    if (!detailed) {
        return detailed.error();
    }
    return Result<std::string>::success(std::move(detailed.value().final_output));
}

Result<AgentRunResult> Agent::run_detailed(std::string_view task, const RunOptions& options) {
    if (name_.empty()) {
        return Error::invalid_argument("Agent name cannot be empty.", "name");
    }
    if (role_.empty()) {
        return Error::invalid_argument("Agent role cannot be empty.", "role");
    }
    if (task.empty()) {
        return Error::invalid_argument("Task cannot be empty.", "task");
    }
    if (!provider_.valid()) {
        return Error::provider_failed("Agent has no provider configured: " + name_);
    }

    GenerateOptions gen;
    gen.agent_name = name_;
    gen.task = std::string(task);
    if (options.handoff != nullptr) {
        gen.context = options.handoff->to_markdown();
    } else if (!options.context.empty()) {
        gen.context = std::string(options.context);
    }

    const std::string prompt = build_prompt(task, options);
    memory_->add("user", std::string(task), nlohmann::json{{"agent", name_}});
    auto output = provider_.generate(prompt, gen);
    if (!output) {
        return output.error();
    }

    memory_->add("assistant", output.value(), nlohmann::json{{"agent", name_}});

    AgentRunResult result;
    result.agent_name = name_;
    result.task = std::string(task);
    result.final_output = std::move(output.value());
    result.success = true;
    result.provider = "AnyProvider";
    result.model = std::string(provider_.model());
    return Result<AgentRunResult>::success(std::move(result));
}

}  // namespace handoffkit
