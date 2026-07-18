#include <handoffkit/runtime/diff_score.hpp>
#include <handoffkit/util/text.hpp>

#include <algorithm>
#include <sstream>

namespace handoffkit {
namespace {

FieldDelta make_field(std::string field, std::string before, std::string after) {
    FieldDelta d;
    d.field = std::move(field);
    d.before = std::move(before);
    d.after = std::move(after);
    d.similarity = text::jaccard_words(d.before, d.after);
    if (d.before == d.after) d.similarity = 1.0;
    return d;
}

std::string list_join(const std::vector<std::string>& items) {
    return text::join(items, " | ");
}

double avg_similarity(const std::vector<FieldDelta>& fields) {
    if (fields.empty()) return 1.0;
    double sum = 0.0;
    for (const auto& f : fields) sum += f.similarity;
    return sum / static_cast<double>(fields.size());
}

}  // namespace

nlohmann::json FieldDelta::to_json() const {
    return nlohmann::json{
        {"field", field},
        {"before", before},
        {"after", after},
        {"similarity", similarity},
    };
}

nlohmann::json HandoffDelta::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& f : fields) arr.push_back(f.to_json());
    return nlohmann::json{
        {"comparable", comparable},
        {"fields", std::move(arr)},
        {"overall_similarity", overall_similarity},
    };
}

std::string HandoffDelta::to_markdown() const {
    std::ostringstream ss;
    ss << "### Handoff delta (sim=" << overall_similarity << ")\n\n";
    for (const auto& f : fields) {
        ss << "- `" << f.field << "` sim=" << f.similarity << "\n"
           << "  - before: " << text::truncate(f.before, 100) << "\n"
           << "  - after: " << text::truncate(f.after, 100) << "\n";
    }
    return ss.str();
}

nlohmann::json RunDelta::to_json() const {
    nlohmann::json hs = nlohmann::json::array();
    for (const auto& h : handoffs) hs.push_back(h.to_json());
    return nlohmann::json{
        {"comparable", comparable},
        {"final_output_similarity", final_output_similarity},
        {"handoff_count_before", handoff_count_before},
        {"handoff_count_after", handoff_count_after},
        {"handoffs", std::move(hs)},
        {"metadata", metadata},
    };
}

std::string RunDelta::to_markdown() const {
    std::ostringstream ss;
    ss << "# Run delta\n\n"
       << "- final_output_similarity: " << final_output_similarity << "\n"
       << "- handoffs: " << handoff_count_before << " → " << handoff_count_after << "\n\n";
    for (const auto& h : handoffs) ss << h.to_markdown() << "\n";
    return ss.str();
}

HandoffDelta diff_handoffs(const HandoffState& before, const HandoffState& after) {
    HandoffDelta d;
    d.comparable = true;
    d.fields.push_back(make_field("task", before.task, after.task));
    d.fields.push_back(make_field("from_agent", before.from_agent, after.from_agent));
    d.fields.push_back(make_field("to_agent", before.to_agent, after.to_agent));
    d.fields.push_back(make_field("summary", before.summary, after.summary));
    d.fields.push_back(make_field("decisions", list_join(before.decisions), list_join(after.decisions)));
    d.fields.push_back(make_field("next_steps", list_join(before.next_steps), list_join(after.next_steps)));
    d.fields.push_back(make_field("important_files", list_join(before.important_files), list_join(after.important_files)));
    d.fields.push_back(make_field("errors", list_join(before.errors), list_join(after.errors)));
    d.fields.push_back(make_field("context_refs", list_join(before.context_refs), list_join(after.context_refs)));
    d.overall_similarity = avg_similarity(d.fields);
    return d;
}

RunDelta diff_team_runs(const TeamRunResult& before, const TeamRunResult& after) {
    RunDelta d;
    d.comparable = true;
    d.final_output_similarity = text::jaccard_words(before.final_output, after.final_output);
    if (before.final_output == after.final_output) d.final_output_similarity = 1.0;
    d.handoff_count_before = before.handoffs.size();
    d.handoff_count_after = after.handoffs.size();
    const std::size_t n = std::min(before.handoffs.size(), after.handoffs.size());
    for (std::size_t i = 0; i < n; ++i) {
        d.handoffs.push_back(diff_handoffs(before.handoffs[i], after.handoffs[i]));
    }
    d.metadata = {
        {"task_before", before.task},
        {"task_after", after.task},
        {"success_before", before.success},
        {"success_after", after.success},
        {"agent_outputs_before", before.agent_outputs.size()},
        {"agent_outputs_after", after.agent_outputs.size()},
    };
    return d;
}

RunDelta diff_traces(const RunTrace& before, const RunTrace& after) {
    RunDelta d;
    d.comparable = true;
    d.final_output_similarity = text::jaccard_words(before.final_output, after.final_output);
    if (before.final_output == after.final_output) d.final_output_similarity = 1.0;
    d.handoff_count_before = before.handoffs.size();
    d.handoff_count_after = after.handoffs.size();
    const std::size_t n = std::min(before.handoffs.size(), after.handoffs.size());
    for (std::size_t i = 0; i < n; ++i) {
        d.handoffs.push_back(diff_handoffs(before.handoffs[i], after.handoffs[i]));
    }
    d.metadata = {
        {"run_id_before", before.run_id},
        {"run_id_after", after.run_id},
        {"steps_before", before.steps.size()},
        {"steps_after", after.steps.size()},
        {"success_before", before.success},
        {"success_after", after.success},
    };
    return d;
}

nlohmann::json regression_report(
    const std::vector<HandoffState>& baseline,
    const std::vector<HandoffState>& candidate
) {
    nlohmann::json pairs = nlohmann::json::array();
    double sum = 0.0;
    const std::size_t n = std::min(baseline.size(), candidate.size());
    for (std::size_t i = 0; i < n; ++i) {
        auto delta = diff_handoffs(baseline[i], candidate[i]);
        sum += delta.overall_similarity;
        pairs.push_back(delta.to_json());
    }
    const double avg = n == 0 ? 1.0 : sum / static_cast<double>(n);
    return nlohmann::json{
        {"baseline_count", baseline.size()},
        {"candidate_count", candidate.size()},
        {"paired", n},
        {"average_similarity", avg},
        {"pass", avg >= 0.5},
        {"pairs", std::move(pairs)},
    };
}

nlohmann::json build_scorecard(
    const TeamRunResult& team,
    const RunTrace& trace,
    double eval_score
) {
    std::size_t actionable = 0;
    std::size_t next_steps = 0;
    for (const auto& h : team.handoffs) {
        for (const auto& s : h.next_steps) {
            ++next_steps;
            if (text::looks_like_action(s)) ++actionable;
        }
    }
    return nlohmann::json{
        {"task", team.task},
        {"final_output_chars", team.final_output.size()},
        {"agent_count", team.agent_outputs.size()},
        {"handoff_count", team.handoffs.size()},
        {"trace_steps", trace.steps.size()},
        {"eval_score", eval_score},
        {"actionable_next_steps", actionable},
        {"next_steps_total", next_steps},
        {"actionable_ratio", next_steps == 0 ? 0.0 : static_cast<double>(actionable) / static_cast<double>(next_steps)},
        {"success", team.success && !team.final_output.empty()},
        {"wire_keys", nlohmann::json::array({"task", "final_output", "handoffs"})},
    };
}

}  // namespace handoffkit
