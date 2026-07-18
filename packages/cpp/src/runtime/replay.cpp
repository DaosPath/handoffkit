#include <handoffkit/runtime/replay.hpp>
#include <handoffkit/core/quality.hpp>
#include <handoffkit/core/validation.hpp>
#include <handoffkit/io/reports.hpp>
#include <handoffkit/util/text.hpp>

#include <sstream>

namespace handoffkit {

nlohmann::json ReplayStepReport::to_json() const {
    return nlohmann::json{
        {"step_name", step_name},
        {"agent", agent},
        {"success", success},
        {"original_output", original_output},
        {"replay_output", replay_output},
        {"notes", notes},
    };
}

nlohmann::json ReplayReport::to_json() const {
    nlohmann::json steps_json = nlohmann::json::array();
    for (const auto& s : steps) steps_json.push_back(s.to_json());
    nlohmann::json vals = nlohmann::json::array();
    for (const auto& v : handoff_validations) vals.push_back(v.to_json());
    nlohmann::json quals = nlohmann::json::array();
    for (const auto& q : handoff_qualities) quals.push_back(q.to_json());
    return nlohmann::json{
        {"success", success},
        {"source_run_id", source_run_id},
        {"source_name", source_name},
        {"steps", std::move(steps_json)},
        {"handoff_validations", std::move(vals)},
        {"handoff_qualities", std::move(quals)},
        {"timeline", timeline},
        {"metadata", metadata},
    };
}

std::string ReplayReport::to_markdown() const {
    std::ostringstream ss;
    ss << "# Replay Report\n\n"
       << "- source_run_id: `" << source_run_id << "`\n"
       << "- source_name: " << source_name << "\n"
       << "- success: " << (success ? "true" : "false") << "\n"
       << "- steps: " << steps.size() << "\n\n"
       << "## Timeline\n\n" << timeline << "\n\n"
       << "## Steps\n\n";
    for (const auto& s : steps) {
        ss << "### " << s.step_name << " (" << s.agent << ")\n"
           << "- success: " << (s.success ? "true" : "false") << "\n"
           << "- original: " << text::truncate(s.original_output, 120) << "\n";
        if (!s.replay_output.empty()) {
            ss << "- replay: " << text::truncate(s.replay_output, 120) << "\n";
        }
        ss << "\n";
    }
    return ss.str();
}

Agent* ReplayRunner::find(const std::string& name) {
    for (auto& a : agents_) {
        if (a.name() == name) return &a;
    }
    return nullptr;
}

Result<ReplayReport> ReplayRunner::replay(const RunTrace& trace, const ReplayOptions& options) {
    ReplayReport report;
    report.source_run_id = trace.run_id;
    report.source_name = trace.name;
    report.timeline = trace.to_timeline();
    report.metadata = {
        {"reexecute_agents", options.reexecute_agents},
        {"revalidate_handoffs", options.revalidate_handoffs},
        {"rescore_quality", options.rescore_quality},
        {"original_success", trace.success},
        {"step_count", trace.steps.size()},
        {"handoff_count", trace.handoffs.size()},
    };

    HandoffStateValidator validator;
    HandoffQualityEvaluator quality;

    for (const auto& step : trace.steps) {
        ReplayStepReport sr;
        sr.step_name = step.name;
        sr.agent = step.agent;
        sr.original_output = step.output;
        sr.success = step.success;
        if (options.reexecute_agents) {
            Agent* agent = find(step.agent);
            if (agent) {
                auto out = agent->run(step.task.empty() ? trace.name : step.task);
                if (out) {
                    sr.replay_output = out.value();
                    sr.notes["similarity"] = text::jaccard_words(sr.original_output, sr.replay_output);
                } else {
                    sr.success = false;
                    sr.notes["error"] = out.error().message;
                }
            } else {
                sr.notes["warning"] = "agent not available for reexecute";
            }
        }
        report.steps.push_back(std::move(sr));
    }

    if (options.revalidate_handoffs) {
        for (const auto& h : trace.handoffs) {
            report.handoff_validations.push_back(validator.validate(h));
        }
    }
    if (options.rescore_quality) {
        for (const auto& h : trace.handoffs) {
            report.handoff_qualities.push_back(quality.evaluate(h));
        }
    }

    bool vals_ok = true;
    for (const auto& v : report.handoff_validations) {
        if (!v.success) vals_ok = false;
    }
    report.success = !report.steps.empty() && vals_ok && !trace.final_output.empty();
    return Result<ReplayReport>::success(std::move(report));
}

Result<ReplayReport> ReplayRunner::replay_file(
    const std::filesystem::path& path,
    const ReplayOptions& options
) {
    auto loaded = load_report_json(path);
    if (!loaded) return loaded.error();
    // Accept raw RunTrace or demo report with nested trace
    nlohmann::json j = loaded.value();
    if (j.contains("trace") && j["trace"].is_object()) {
        j = j["trace"];
    }
    RunTrace trace = RunTrace::from_json(j);
    return replay(trace, options);
}

}  // namespace handoffkit
