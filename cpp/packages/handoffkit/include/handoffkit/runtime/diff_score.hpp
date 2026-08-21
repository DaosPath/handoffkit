#pragma once

#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <nlohmann/json.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

struct FieldDelta {
    std::string field;
    std::string before;
    std::string after;
    double similarity = 0.0;
    nlohmann::json to_json() const;
};

struct HandoffDelta {
    bool comparable = false;
    std::vector<FieldDelta> fields;
    double overall_similarity = 0.0;
    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

struct RunDelta {
    bool comparable = false;
    double final_output_similarity = 0.0;
    std::size_t handoff_count_before = 0;
    std::size_t handoff_count_after = 0;
    std::vector<HandoffDelta> handoffs;
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

/// Compare two handoff states field-by-field (useful for replay/regression demos).
[[nodiscard]] HandoffDelta diff_handoffs(const HandoffState& before, const HandoffState& after);

/// Compare team runs and aligned handoffs.
[[nodiscard]] RunDelta diff_team_runs(const TeamRunResult& before, const TeamRunResult& after);

/// Compare traces (final output + handoff lists).
[[nodiscard]] RunDelta diff_traces(const RunTrace& before, const RunTrace& after);

/// Score a list of handoffs for regression vs a baseline set (pairwise by index).
[[nodiscard]] nlohmann::json regression_report(
    const std::vector<HandoffState>& baseline,
    const std::vector<HandoffState>& candidate
);

/// Build a compact scorecard used by CLI `evaluate` enrichment.
[[nodiscard]] nlohmann::json build_scorecard(
    const TeamRunResult& team,
    const RunTrace& trace,
    double eval_score
);

}  // namespace handoffkit
