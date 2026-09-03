#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/util/text.hpp>

#include <sstream>

namespace handoffkit {

nlohmann::json EvalCheck::to_json() const {
    return nlohmann::json{
        {"name", name},
        {"description", description},
        {"passed", passed},
        {"weight", weight},
        {"detail", detail},
    };
}

nlohmann::json WorkflowEvalReport::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& c : checks) arr.push_back(c.to_json());
    return nlohmann::json{
        {"success", success},
        {"score", score},
        {"grade", grade},
        {"checks", std::move(arr)},
        {"recommendations", recommendations},
        {"metadata", metadata},
    };
}

std::string WorkflowEvalReport::to_markdown() const {
    std::ostringstream ss;
    ss << "# Workflow Evaluation\n\n"
       << "Success: " << (success ? "true" : "false") << "\n"
       << "Score: " << score << " (" << grade << ")\n\n"
       << "## Checks\n\n";
    for (const auto& c : checks) {
        ss << "- [" << (c.passed ? "x" : " ") << "] **" << c.name << "** (w=" << c.weight << "): "
           << c.detail << "\n";
    }
    if (!recommendations.empty()) {
        ss << "\n## Recommendations\n\n";
        for (const auto& r : recommendations) ss << "- " << r << "\n";
    }
    return ss.str();
}

std::string WorkflowEvaluator::grade_for(double score) {
    if (score >= 0.9) return "A";
    if (score >= 0.75) return "B";
    if (score >= 0.6) return "C";
    if (score >= 0.4) return "D";
    return "F";
}

EvalCheck WorkflowEvaluator::check_non_empty_final(const std::string& final_output) const {
    EvalCheck c{"non_empty_final", "Final output must be non-empty", false, 1.5, {}};
    c.passed = !text::trim(final_output).empty();
    c.detail = c.passed ? "final_output present" : "final_output empty";
    return c;
}

EvalCheck WorkflowEvaluator::check_handoff_count(std::size_t agents, std::size_t handoffs) const {
    EvalCheck c{"handoff_count", "Handoffs should equal agents-1 for sequential teams", false, 1.0, {}};
    if (agents <= 1) {
        c.passed = handoffs == 0;
        c.detail = "single agent; handoffs=" + std::to_string(handoffs);
        return c;
    }
    const std::size_t expected = agents - 1;
    c.passed = handoffs == expected;
    c.detail = "handoffs=" + std::to_string(handoffs) + " expected=" + std::to_string(expected);
    return c;
}

EvalCheck WorkflowEvaluator::check_wire_keys(const nlohmann::json& wire) const {
    EvalCheck c{"wire_keys", "Wire JSON includes task/final_output/handoffs", false, 1.2, {}};
    const bool ok = wire.contains("task") && wire.contains("final_output") && wire.contains("handoffs");
    c.passed = ok;
    c.detail = ok ? "snake_case keys present" : "missing one of task/final_output/handoffs";
    return c;
}

EvalCheck WorkflowEvaluator::check_handoff_validation(const std::vector<HandoffState>& handoffs) const {
    EvalCheck c{"handoff_validation", "All handoffs pass HandoffStateValidator", false, 1.4, {}};
    if (handoffs.empty()) {
        c.passed = true;
        c.detail = "no handoffs";
        return c;
    }
    int bad = 0;
    for (const auto& h : handoffs) {
        if (!validator_.validate(h).success) ++bad;
    }
    c.passed = bad == 0;
    c.detail = "invalid_handoffs=" + std::to_string(bad);
    return c;
}

EvalCheck WorkflowEvaluator::check_avg_quality(const std::vector<HandoffState>& handoffs) const {
    EvalCheck c{"avg_quality", "Average handoff quality above floor", false, 1.3, {}};
    if (handoffs.empty()) {
        c.passed = true;
        c.detail = "no handoffs";
        return c;
    }
    double sum = 0;
    for (const auto& h : handoffs) sum += quality_.evaluate(h).score;
    const double avg = sum / static_cast<double>(handoffs.size());
    c.passed = avg >= 0.4;
    c.detail = "avg_quality=" + std::to_string(avg);
    return c;
}

EvalCheck WorkflowEvaluator::check_actionable_next_steps(const std::vector<HandoffState>& handoffs) const {
    EvalCheck c{"actionable_next_steps", "Next steps look action-oriented when present", false, 1.0, {}};
    int total = 0, actionable = 0;
    for (const auto& h : handoffs) {
        for (const auto& step : h.next_steps) {
            ++total;
            if (text::looks_like_action(step) || text::word_count(step) >= 4) ++actionable;
        }
    }
    if (total == 0) {
        c.passed = true;
        c.detail = "no next_steps";
        return c;
    }
    const double ratio = static_cast<double>(actionable) / static_cast<double>(total);
    c.passed = ratio >= 0.4;
    c.detail = "actionable_ratio=" + std::to_string(ratio);
    return c;
}

EvalCheck WorkflowEvaluator::check_trace_steps(const RunTrace& trace) const {
    EvalCheck c{"trace_steps", "Trace contains steps and consistent final_output", false, 1.1, {}};
    c.passed = !trace.steps.empty() && !trace.final_output.empty();
    c.detail = "steps=" + std::to_string(trace.steps.size());
    return c;
}

WorkflowEvalReport WorkflowEvaluator::evaluate_team(const TeamRunResult& team) const {
    WorkflowEvalReport report;
    report.checks = {
        check_non_empty_final(team.final_output),
        check_handoff_count(team.agent_outputs.size(), team.handoffs.size()),
        check_wire_keys(team.to_json()),
        check_handoff_validation(team.handoffs),
        check_avg_quality(team.handoffs),
        check_actionable_next_steps(team.handoffs),
    };
    double wsum = 0, ssum = 0;
    for (const auto& c : report.checks) {
        wsum += c.weight;
        if (c.passed) ssum += c.weight;
        if (!c.passed) {
            report.recommendations.push_back("Fix check: " + c.name + " — " + c.detail);
        }
    }
    report.score = wsum > 0 ? ssum / wsum : 0.0;
    report.grade = grade_for(report.score);
    report.success = report.score >= min_score_ && team.success;
    report.metadata = {{"evaluator", "WorkflowEvaluator"}, {"kind", "team"}, {"min_score", min_score_}};
    return report;
}

WorkflowEvalReport WorkflowEvaluator::evaluate_trace(const RunTrace& trace) const {
    WorkflowEvalReport report;
    report.checks = {
        check_non_empty_final(trace.final_output),
        check_trace_steps(trace),
        check_wire_keys(trace.to_json()),
        check_handoff_validation(trace.handoffs),
        check_avg_quality(trace.handoffs),
    };
    double wsum = 0, ssum = 0;
    for (const auto& c : report.checks) {
        wsum += c.weight;
        if (c.passed) ssum += c.weight;
        if (!c.passed) report.recommendations.push_back("Fix check: " + c.name);
    }
    report.score = wsum > 0 ? ssum / wsum : 0.0;
    report.grade = grade_for(report.score);
    report.success = report.score >= min_score_ && trace.success;
    report.metadata = {{"evaluator", "WorkflowEvaluator"}, {"kind", "trace"}};
    return report;
}

WorkflowEvalReport WorkflowEvaluator::evaluate_handoffs(const std::vector<HandoffState>& handoffs) const {
    WorkflowEvalReport report;
    report.checks = {
        check_handoff_validation(handoffs),
        check_avg_quality(handoffs),
        check_actionable_next_steps(handoffs),
    };
    double wsum = 0, ssum = 0;
    for (const auto& c : report.checks) {
        wsum += c.weight;
        if (c.passed) ssum += c.weight;
    }
    report.score = wsum > 0 ? ssum / wsum : 0.0;
    report.grade = grade_for(report.score);
    report.success = report.score >= min_score_;
    report.metadata = {{"evaluator", "WorkflowEvaluator"}, {"kind", "handoffs"}, {"count", handoffs.size()}};
    return report;
}

WorkflowEvalReport WorkflowEvaluator::evaluate_combined(
    const TeamRunResult& team,
    const RunTrace& trace
) const {
    auto a = evaluate_team(team);
    auto b = evaluate_trace(trace);
    WorkflowEvalReport report;
    report.checks = a.checks;
    for (const auto& c : b.checks) report.checks.push_back(c);
    double wsum = 0, ssum = 0;
    for (const auto& c : report.checks) {
        wsum += c.weight;
        if (c.passed) ssum += c.weight;
        if (!c.passed) report.recommendations.push_back("Fix: " + c.name + " — " + c.detail);
    }
    report.score = wsum > 0 ? ssum / wsum : 0.0;
    report.grade = grade_for(report.score);
    report.success = report.score >= min_score_;
    report.metadata = {
        {"evaluator", "WorkflowEvaluator"},
        {"kind", "combined"},
        {"team_score", a.score},
        {"trace_score", b.score},
    };
    return report;
}

}  // namespace handoffkit
