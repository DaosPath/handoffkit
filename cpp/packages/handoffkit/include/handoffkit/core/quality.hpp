#pragma once

#include <handoffkit/core/validation.hpp>
#include <handoffkit/handoff.hpp>

#include <string>
#include <vector>

namespace handoffkit {

class HandoffQualityEvaluator {
public:
    explicit HandoffQualityEvaluator(double min_score = 0.6) : min_score_(min_score) {}

    [[nodiscard]] HandoffQualityReport evaluate(const HandoffState& state) const;
    [[nodiscard]] HandoffQualityReport evaluate_many(const std::vector<HandoffState>& handoffs) const;

private:
    HandoffQualityMetric completeness(const HandoffState& state, const ValidationReport& validation) const;
    HandoffQualityMetric clarity(const HandoffState& state) const;
    HandoffQualityMetric actionability(const HandoffState& state) const;
    HandoffQualityMetric traceability(const HandoffState& state) const;
    HandoffQualityMetric error_awareness(const HandoffState& state) const;
    static std::string grade(double score);
    static std::vector<std::string> recommendations(
        const std::vector<HandoffQualityMetric>& metrics,
        const ValidationReport& validation
    );

    double min_score_;
    HandoffStateValidator validator_{};
};

}  // namespace handoffkit
