#include <handoffkit/io/report_gallery.hpp>
#include <handoffkit/core/quality.hpp>
#include <handoffkit/io/html_report.hpp>
#include <handoffkit/io/reports.hpp>
#include <handoffkit/util/text.hpp>

#include <fstream>
#include <sstream>

namespace handoffkit {

nlohmann::json GalleryReport::to_json() const {
    nlohmann::json arts = nlohmann::json::array();
    for (const auto& a : artifacts) {
        arts.push_back({{"kind", a.kind}, {"path", a.path.string()}, {"summary", a.summary}});
    }
    return nlohmann::json{
        {"success", success},
        {"title", title},
        {"artifacts", std::move(arts)},
        {"index", index},
    };
}

std::string GalleryReport::to_markdown() const {
    std::ostringstream ss;
    ss << "# " << title << "\n\n";
    ss << "success: " << (success ? "true" : "false") << "\n\n";
    ss << "## Artifacts\n\n";
    for (const auto& a : artifacts) {
        ss << "- `" << a.kind << "` " << a.path.string() << " — " << a.summary << "\n";
    }
    return ss.str();
}

Result<std::string> ReportGallery::write_text(
    const std::filesystem::path& path,
    const std::string& body
) const {
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    if (ec) return Error::provider_failed(ec.message());
    std::ofstream out(path, std::ios::binary);
    if (!out) return Error::provider_failed("open failed: " + path.string());
    out << body;
    if (!out) return Error::provider_failed("write failed: " + path.string());
    return Result<std::string>::success(path.string());
}

Result<GalleryReport> ReportGallery::write_team_gallery(
    std::string_view name,
    const TeamRunResult& team,
    const RunTrace& trace,
    const WorkflowEvalReport* eval
) const {
    GalleryReport report;
    report.title = std::string("Team gallery: ") + std::string(name);
    const auto dir = root_ / text::slugify(name);

    auto json_path = write_report_json(dir / "team.json", team.to_json());
    if (!json_path) return json_path.error();
    report.artifacts.push_back({"json", dir / "team.json", "team wire JSON"});

    auto trace_path = write_report_json(dir / "trace.json", trace.to_json());
    if (!trace_path) return trace_path.error();
    report.artifacts.push_back({"json", dir / "trace.json", "run trace"});

    auto md = write_text(dir / "timeline.md", trace.to_timeline());
    if (!md) return md.error();
    report.artifacts.push_back({"timeline", dir / "timeline.md", "execution timeline"});

    auto html = write_html_report(dir / "trace.html", render_trace_html(trace));
    if (!html) return html.error();
    report.artifacts.push_back({"html", dir / "trace.html", "HTML trace"});

    auto team_html = write_html_report(dir / "team.html", render_team_html(team));
    if (!team_html) return team_html.error();
    report.artifacts.push_back({"html", dir / "team.html", "HTML team report"});

    std::ostringstream summary_md;
    summary_md << "# Team summary\n\n"
               << "- task: " << team.task << "\n"
               << "- agents: " << team.agent_outputs.size() << "\n"
               << "- handoffs: " << team.handoffs.size() << "\n"
               << "- success: " << (team.success ? "true" : "false") << "\n\n"
               << "## Final output\n\n" << team.final_output << "\n";
    auto sm = write_text(dir / "summary.md", summary_md.str());
    if (!sm) return sm.error();
    report.artifacts.push_back({"md", dir / "summary.md", "markdown summary"});

    if (eval) {
        auto ep = write_report_json(dir / "eval.json", eval->to_json());
        if (!ep) return ep.error();
        report.artifacts.push_back({"json", dir / "eval.json", "workflow evaluation"});
        auto em = write_text(dir / "eval.md", eval->to_markdown());
        if (!em) return em.error();
        report.artifacts.push_back({"md", dir / "eval.md", "evaluation markdown"});
    }

    report.index = {
        {"name", std::string(name)},
        {"task", team.task},
        {"final_output", team.final_output},
        {"handoffs", team.handoffs.size()},
        {"artifact_count", report.artifacts.size()},
    };
    auto idx = write_report_json(dir / "index.json", report.to_json());
    if (!idx) return idx.error();
    report.artifacts.push_back({"json", dir / "index.json", "gallery index"});
    report.success = true;
    return Result<GalleryReport>::success(std::move(report));
}

Result<GalleryReport> ReportGallery::write_orchestrator_gallery(
    std::string_view name,
    const OrchestratorResult& result,
    const WorkflowEvalReport* eval
) const {
    GalleryReport report;
    report.title = std::string("Orchestrator gallery: ") + std::string(name);
    const auto dir = root_ / text::slugify(name);

    auto json_path = write_report_json(dir / "orchestrator.json", result.to_json());
    if (!json_path) return json_path.error();
    report.artifacts.push_back({"json", dir / "orchestrator.json", "orchestrator wire"});

    auto trace_path = write_report_json(dir / "trace.json", result.trace.to_json());
    if (!trace_path) return trace_path.error();
    report.artifacts.push_back({"json", dir / "trace.json", "trace"});

    auto tl = write_text(dir / "timeline.md", result.trace.to_timeline());
    if (!tl) return tl.error();
    report.artifacts.push_back({"timeline", dir / "timeline.md", "timeline"});

    std::ostringstream stages;
    stages << "# Stages\n\n";
    for (const auto& s : result.stages) {
        stages << "## " << s.stage_name << "\n"
               << "- success: " << (s.success ? "true" : "false") << "\n"
               << "- attempts: " << s.attempts << "\n"
               << "- notes: " << s.notes << "\n\n";
    }
    auto st = write_text(dir / "stages.md", stages.str());
    if (!st) return st.error();
    report.artifacts.push_back({"md", dir / "stages.md", "stage breakdown"});

    if (eval) {
        auto ep = write_report_json(dir / "eval.json", eval->to_json());
        if (!ep) return ep.error();
        report.artifacts.push_back({"json", dir / "eval.json", "eval"});
    }

    report.index = result.to_json();
    report.index["gallery_name"] = std::string(name);
    auto idx = write_report_json(dir / "index.json", report.to_json());
    if (!idx) return idx.error();
    report.success = true;
    return Result<GalleryReport>::success(std::move(report));
}

Result<GalleryReport> ReportGallery::write_quality_gallery(
    std::string_view name,
    const std::vector<HandoffState>& handoffs
) const {
    GalleryReport report;
    report.title = std::string("Quality gallery: ") + std::string(name);
    const auto dir = root_ / text::slugify(name);
    HandoffQualityEvaluator evaluator;
    nlohmann::json scores = nlohmann::json::array();
    std::ostringstream md;
    md << "# Quality gallery\n\n";
    int i = 0;
    for (const auto& h : handoffs) {
        auto q = evaluator.evaluate(h);
        scores.push_back(q.to_json());
        md << "## Handoff " << (++i) << ": " << h.from_agent << " → " << h.to_agent << "\n\n";
        md << q.to_markdown() << "\n\n";
        auto html = write_html_report(
            dir / ("quality_" + std::to_string(i) + ".html"),
            render_quality_html(q)
        );
        if (html) {
            report.artifacts.push_back({"html", dir / ("quality_" + std::to_string(i) + ".html"), "quality html"});
        }
    }
    auto jp = write_report_json(dir / "qualities.json", scores);
    if (!jp) return jp.error();
    report.artifacts.push_back({"json", dir / "qualities.json", "all quality reports"});
    auto mp = write_text(dir / "qualities.md", md.str());
    if (!mp) return mp.error();
    report.artifacts.push_back({"md", dir / "qualities.md", "quality markdown"});
    report.index = {{"count", handoffs.size()}, {"scores", scores}};
    report.success = !handoffs.empty();
    auto idx = write_report_json(dir / "index.json", report.to_json());
    if (!idx) return idx.error();
    return Result<GalleryReport>::success(std::move(report));
}

Result<GalleryReport> ReportGallery::write_comparison_gallery(
    std::string_view name,
    const nlohmann::json& comparison_table
) const {
    GalleryReport report;
    report.title = std::string("Comparison gallery: ") + std::string(name);
    const auto dir = root_ / text::slugify(name);
    auto jp = write_report_json(dir / "comparison.json", comparison_table);
    if (!jp) return jp.error();
    report.artifacts.push_back({"json", dir / "comparison.json", "comparison table"});

    std::ostringstream md;
    md << "# Comparison\n\n```json\n" << comparison_table.dump(2) << "\n```\n";
    auto mp = write_text(dir / "comparison.md", md.str());
    if (!mp) return mp.error();
    report.artifacts.push_back({"md", dir / "comparison.md", "comparison markdown"});

    std::ostringstream html;
    html << "<!doctype html><html><body><h1>Comparison</h1><pre>"
         << comparison_table.dump(2) << "</pre></body></html>";
    auto hp = write_html_report(dir / "comparison.html", html.str());
    if (!hp) return hp.error();
    report.artifacts.push_back({"html", dir / "comparison.html", "comparison html"});

    report.index = comparison_table;
    report.success = true;
    auto idx = write_report_json(dir / "index.json", report.to_json());
    if (!idx) return idx.error();
    return Result<GalleryReport>::success(std::move(report));
}

}  // namespace handoffkit
