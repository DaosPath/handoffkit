#include <handoffkit/core/quality.hpp>

#include <algorithm>
#include <cctype>
#include <sstream>

namespace handoffkit {
namespace {

std::size_t word_count(const std::string& text) {
    std::size_t count = 0;
    bool in_word = false;
    for (unsigned char ch : text) {
        if (std::isspace(ch)) {
            in_word = false;
        } else if (!in_word) {
            in_word = true;
            ++count;
        }
    }
    return count;
}

bool starts_with_action(const std::string& item) {
    static const char* words[] = {
        "run", "write", "create", "implement", "test", "review", "fix", "verify",
    };
    std::string lower;
    lower.reserve(item.size());
    for (unsigned char ch : item) {
        lower.push_back(static_cast<char>(std::tolower(ch)));
    }
    // trim leading space
    std::size_t start = lower.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) {
        return false;
    }
    lower = lower.substr(start);
    for (const char* w : words) {
        const std::size_t n = std::char_traits<char>::length(w);
        if (lower.size() >= n && lower.compare(0, n, w) == 0) {
            if (lower.size() == n || !std::isalpha(static_cast<unsigned char>(lower[n]))) {
                return true;
            }
        }
    }
    return false;
}

}  // namespace

HandoffQualityMetric HandoffQualityEvaluator::completeness(
    const HandoffState& state,
    const ValidationReport& validation
) const {
    HandoffQualityMetric metric;
    metric.name = "completeness";
    metric.weight = 1.4;
    double score = 0.0;
    if (validation.success) {
        score += 0.3;
    } else {
        metric.notes.push_back("contract validation failed");
    }
    auto check = [&](const std::string& field, bool present) {
        if (present) {
            score += 0.14;
        } else {
            metric.notes.push_back("missing " + field);
        }
    };
    check("summary", !state.summary.empty());
    check("decisions", !state.decisions.empty());
    check("next_steps", !state.next_steps.empty());
    check("important_files", !state.important_files.empty());
    check("context_refs", !state.context_refs.empty());
    metric.score = std::min(score, 1.0);
    return metric;
}

HandoffQualityMetric HandoffQualityEvaluator::clarity(const HandoffState& state) const {
    HandoffQualityMetric metric;
    metric.name = "clarity";
    metric.weight = 1.0;
    const auto words = word_count(state.summary);
    double score = 0.2;
    if (words >= 8) {
        score = 1.0;
    } else if (words >= 3) {
        score = 0.6;
        metric.notes.push_back("summary is short");
    } else {
        metric.notes.push_back("summary needs more detail");
    }
    for (const auto& decision : state.decisions) {
        if (word_count(decision) <= 1) {
            score -= 0.15;
            metric.notes.push_back("some decisions are too terse");
            break;
        }
    }
    metric.score = std::max(score, 0.0);
    return metric;
}

HandoffQualityMetric HandoffQualityEvaluator::actionability(const HandoffState& state) const {
    HandoffQualityMetric metric;
    metric.name = "actionability";
    metric.weight = 1.2;
    if (state.next_steps.empty()) {
        metric.score = 0.2;
        metric.notes.push_back("missing next steps");
        return metric;
    }
    std::size_t actionable = 0;
    for (const auto& step : state.next_steps) {
        if (starts_with_action(step)) {
            ++actionable;
        }
    }
    metric.score = 0.5 + 0.5 * (static_cast<double>(actionable) / static_cast<double>(state.next_steps.size()));
    if (actionable < state.next_steps.size()) {
        metric.notes.push_back("some next steps are not action-oriented");
    }
    return metric;
}

HandoffQualityMetric HandoffQualityEvaluator::traceability(const HandoffState& state) const {
    HandoffQualityMetric metric;
    metric.name = "traceability";
    metric.weight = 1.0;
    const auto refs = state.important_files.size() + state.context_refs.size();
    if (refs >= 2) {
        metric.score = 1.0;
    } else if (refs == 1) {
        metric.score = 0.65;
        metric.notes.push_back("only one traceability reference");
    } else {
        metric.score = 0.25;
        metric.notes.push_back("missing files or context refs");
    }
    return metric;
}

HandoffQualityMetric HandoffQualityEvaluator::error_awareness(const HandoffState& state) const {
    HandoffQualityMetric metric;
    metric.name = "error_awareness";
    metric.weight = 0.7;
    if (!state.errors.empty()) {
        metric.score = 1.0;
        metric.notes.push_back("errors explicitly recorded");
    } else if (state.metadata.is_object() && state.metadata.value("errors_checked", false)) {
        metric.score = 1.0;
        metric.notes.push_back("metadata confirms error check");
    } else {
        metric.score = 0.55;
        metric.notes.push_back("no errors or error-check marker");
    }
    return metric;
}

std::string HandoffQualityEvaluator::grade(double score) {
    if (score >= 0.9) return "A";
    if (score >= 0.75) return "B";
    if (score >= 0.6) return "C";
    if (score >= 0.4) return "D";
    return "F";
}

std::vector<std::string> HandoffQualityEvaluator::recommendations(
    const std::vector<HandoffQualityMetric>& metrics,
    const ValidationReport& validation
) {
    std::vector<std::string> out;
    if (!validation.success) {
        out.push_back("Fix validation errors before judging handoff quality.");
    }
    for (const auto& metric : metrics) {
        if (metric.score >= 0.75) {
            continue;
        }
        if (metric.name == "completeness") {
            out.push_back("Include summary, decisions, next steps, and relevant refs.");
        } else if (metric.name == "clarity") {
            out.push_back("Make the summary and decisions more specific.");
        } else if (metric.name == "actionability") {
            out.push_back("Write next steps as concrete actions.");
        } else if (metric.name == "traceability") {
            out.push_back("Add important_files or context_refs for follow-up work.");
        } else if (metric.name == "error_awareness") {
            out.push_back("Record errors or mark that errors were checked.");
        }
    }
    return out;
}

HandoffQualityReport HandoffQualityEvaluator::evaluate(const HandoffState& state) const {
    const auto validation = validator_.validate(state);
    std::vector<HandoffQualityMetric> metrics = {
        completeness(state, validation),
        clarity(state),
        actionability(state),
        traceability(state),
        error_awareness(state),
    };
    double total_weight = 0.0;
    double weighted = 0.0;
    for (const auto& m : metrics) {
        total_weight += m.weight;
        weighted += m.score * m.weight;
    }
    double score = total_weight > 0 ? weighted / total_weight : 0.0;
    if (!validation.success) {
        score = std::min(score, 0.39);
    }
    HandoffQualityReport report;
    report.success = validation.success && score >= min_score_;
    report.score = score;
    report.grade = grade(score);
    report.metrics = std::move(metrics);
    report.recommendations = recommendations(report.metrics, validation);
    report.validation = validation;
    report.metadata = nlohmann::json{
        {"handoffs", 1},
        {"evaluator", "HandoffQualityEvaluator"},
        {"min_score", min_score_},
    };
    return report;
}

HandoffQualityReport HandoffQualityEvaluator::evaluate_many(
    const std::vector<HandoffState>& handoffs
) const {
    if (handoffs.empty()) {
        HandoffQualityReport report;
        report.success = false;
        report.score = 0.0;
        report.grade = "F";
        report.recommendations = {"Provide at least one handoff state."};
        report.validation.success = false;
        report.validation.metadata = nlohmann::json{{"error", "no handoffs provided"}};
        report.metadata = nlohmann::json{{"handoffs", 0}, {"evaluator", "HandoffQualityEvaluator"}};
        return report;
    }
    double sum = 0.0;
    bool all_ok = true;
    ValidationReport aggregated;
    aggregated.success = true;
    for (const auto& state : handoffs) {
        auto one = evaluate(state);
        sum += one.score;
        all_ok = all_ok && one.success;
        if (!one.validation.success) {
            aggregated.success = false;
        }
        for (const auto& issue : one.validation.issues) {
            aggregated.issues.push_back(issue);
        }
    }
    HandoffQualityReport report;
    report.success = all_ok;
    report.score = sum / static_cast<double>(handoffs.size());
    report.grade = grade(report.score);
    report.validation = std::move(aggregated);
    report.recommendations = recommendations({}, report.validation);
    report.metadata = nlohmann::json{
        {"handoffs", handoffs.size()},
        {"evaluator", "HandoffQualityEvaluator"},
        {"average_score", report.score},
    };
    // Re-evaluate first for metrics shape when single; average metric names for multi.
    auto first = evaluate(handoffs.front());
    report.metrics = first.metrics;
    if (handoffs.size() > 1) {
        for (auto& m : report.metrics) {
            m.notes = {"average over " + std::to_string(handoffs.size()) + " handoffs"};
        }
    }
    return report;
}

}  // namespace handoffkit
