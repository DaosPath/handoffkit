#pragma once

#include <handoffkit/core/quality.hpp>
#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

struct EvalCheck {
    std::string name;
    std::string description;
    bool passed = false;
    double weight = 1.0;
    std::string detail;
    nlohmann::json to_json() const;
};

struct WorkflowEvalReport {
    bool success = false;
    double score = 0.0;
    std::string grade;
    std::vector<EvalCheck> checks;
    std::vector<std::string> recommendations;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

/// Offline evaluator for team runs / traces / handoff sets.
class WorkflowEvaluator {
public:
    explicit WorkflowEvaluator(double min_score = 0.6) : min_score_(min_score) {}

    WorkflowEvalReport evaluate_team(const TeamRunResult& team) const;
    WorkflowEvalReport evaluate_trace(const RunTrace& trace) const;
    WorkflowEvalReport evaluate_handoffs(const std::vector<HandoffState>& handoffs) const;
    WorkflowEvalReport evaluate_combined(
        const TeamRunResult& team,
        const RunTrace& trace
    ) const;

private:
    EvalCheck check_non_empty_final(const std::string& final_output) const;
    EvalCheck check_handoff_count(std::size_t agents, std::size_t handoffs) const;
    EvalCheck check_wire_keys(const nlohmann::json& wire) const;
    EvalCheck check_handoff_validation(const std::vector<HandoffState>& handoffs) const;
    EvalCheck check_avg_quality(const std::vector<HandoffState>& handoffs) const;
    EvalCheck check_actionable_next_steps(const std::vector<HandoffState>& handoffs) const;
    EvalCheck check_trace_steps(const RunTrace& trace) const;
    static std::string grade_for(double score);

    double min_score_;
    HandoffStateValidator validator_{};
    HandoffQualityEvaluator quality_{0.5};
};

}  // namespace handoffkit
