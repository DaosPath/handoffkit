#include <handoffkit/runtime/trace.hpp>

#include <sstream>

namespace handoffkit {

RunTrace build_run_trace(
    std::string_view run_id,
    std::string_view name,
    const TeamRunResult& team_result
) {
    return build_run_trace(run_id, name, team_result, "hybrid_state");
}

RunTrace build_run_trace(
    std::string_view run_id,
    std::string_view name,
    const TeamRunResult& team_result,
    std::string_view protocol_mode
) {
    RunTrace trace;
    trace.run_id = std::string(run_id);
    trace.name = std::string(name);
    trace.success = team_result.success;
    trace.final_output = team_result.final_output;
    trace.handoffs = team_result.handoffs;
    trace.metadata = nlohmann::json{
        {"task", team_result.task},
        {"protocol_mode", std::string(protocol_mode)},
        {"agent_count", team_result.agent_outputs.size()},
    };

    for (std::size_t i = 0; i < team_result.agent_outputs.size(); ++i) {
        const auto& output = team_result.agent_outputs[i];
        TraceStep step;
        step.name = "step_" + std::to_string(i + 1);
        step.agent = output.agent;
        step.task = team_result.task;
        step.mode = std::string(protocol_mode);
        step.success = true;
        step.output = output.output;
        if (i > 0 && (i - 1) < team_result.handoffs.size()) {
            step.handoff = team_result.handoffs[i - 1].to_json();
        }
        step.metadata = nlohmann::json{{"index", i}};
        trace.steps.push_back(std::move(step));
    }
    return trace;
}

}  // namespace handoffkit
