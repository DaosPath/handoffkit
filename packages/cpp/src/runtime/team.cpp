#include <handoffkit/runtime/team.hpp>

namespace handoffkit {

Result<TeamRunResult> Team::run(std::string_view task) {
    if (agents_.empty()) {
        return Error::invalid_argument("Team requires at least one agent.", "agents");
    }
    if (task.empty()) {
        return Error::invalid_argument("Task cannot be empty.", "task");
    }

    TeamRunResult result;
    result.task = std::string(task);

    Agent& first = agents_.front();
    auto first_out = first.run(task);
    if (!first_out) {
        return first_out.error();
    }
    std::string current_output = std::move(first_out.value());
    result.agent_outputs.push_back(AgentOutput{first.name(), current_output});

    for (std::size_t i = 1; i < agents_.size(); ++i) {
        Agent& previous = agents_[i - 1];
        Agent& current = agents_[i];

        TransferOptions transfer;
        transfer.task = result.task;
        transfer.from_agent = previous.name();
        transfer.to_agent = current.name();
        transfer.summary = current_output;

        auto handoff = protocol_.transfer(transfer);
        if (!handoff) {
            return handoff.error();
        }
        result.handoffs.push_back(handoff.value());

        RunOptions opts;
        opts.handoff = &result.handoffs.back();
        auto step = current.run(task, opts);
        if (!step) {
            return step.error();
        }
        current_output = std::move(step.value());
        result.agent_outputs.push_back(AgentOutput{current.name(), current_output});
    }

    result.final_output = std::move(current_output);
    result.success = true;
    return Result<TeamRunResult>::success(std::move(result));
}

}  // namespace handoffkit
