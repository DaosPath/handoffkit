#include <handoffkit/io/html_report.hpp>
#include <handoffkit/io/reports.hpp>

#include <fstream>
#include <sstream>

namespace handoffkit {
namespace {

std::string escape_html(const std::string& input) {
    std::string out;
    out.reserve(input.size());
    for (char ch : input) {
        switch (ch) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            default: out.push_back(ch); break;
        }
    }
    return out;
}

std::string shell_page(const std::string& title, const std::string& body) {
    std::ostringstream ss;
    ss << "<!doctype html><html><head><meta charset=\"utf-8\">"
       << "<title>" << escape_html(title) << "</title>"
       << "<style>"
       << "body{font-family:system-ui,Segoe UI,sans-serif;margin:2rem;background:#0b1020;color:#e8eefc;}"
       << "h1,h2{color:#9ecbff} .card{background:#151b2f;border:1px solid #2a3558;border-radius:12px;"
       << "padding:1rem;margin:1rem 0;} .muted{color:#9aa7c7} code,pre{background:#0f1528;padding:.2rem .4rem;"
       << "border-radius:6px;} pre{padding:1rem;overflow:auto;} .ok{color:#7dffa6} .bad{color:#ff8f8f}"
       << "</style></head><body>"
       << body
       << "</body></html>";
    return ss.str();
}

}  // namespace

std::string render_trace_html(const RunTrace& trace) {
    std::ostringstream body;
    body << "<h1>RunTrace: " << escape_html(trace.name) << "</h1>"
         << "<div class='card'><div class='muted'>run_id</div><code>"
         << escape_html(trace.run_id) << "</code>"
         << "<p class='" << (trace.success ? "ok" : "bad") << "'>success="
         << (trace.success ? "true" : "false") << "</p>"
         << "<p>steps=" << trace.steps.size() << " handoffs=" << trace.handoffs.size() << "</p></div>";

    body << "<h2>Timeline</h2>";
    for (std::size_t i = 0; i < trace.steps.size(); ++i) {
        const auto& step = trace.steps[i];
        body << "<div class='card'><h3>" << (i + 1) << ". "
             << escape_html(step.agent.empty() ? "Unknown" : step.agent)
             << "</h3><p>" << escape_html(step.task) << "</p>"
             << "<pre>" << escape_html(step.output) << "</pre></div>";
    }

    if (!trace.final_output.empty()) {
        body << "<h2>Final output</h2><div class='card'><pre>"
             << escape_html(trace.final_output) << "</pre></div>";
    }
    return shell_page("HandoffKit Trace " + trace.run_id, body.str());
}

std::string render_team_html(const TeamRunResult& result) {
    std::ostringstream body;
    body << "<h1>Team run</h1>"
         << "<div class='card'><div class='muted'>task</div><p>"
         << escape_html(result.task) << "</p>"
         << "<p class='" << (result.success ? "ok" : "bad") << "'>success="
         << (result.success ? "true" : "false") << "</p></div>";
    body << "<h2>Agent outputs</h2>";
    for (const auto& out : result.agent_outputs) {
        body << "<div class='card'><h3>" << escape_html(out.agent) << "</h3><pre>"
             << escape_html(out.output) << "</pre></div>";
    }
    body << "<h2>Handoffs</h2>";
    for (const auto& h : result.handoffs) {
        body << "<div class='card'><h3>" << escape_html(h.from_agent) << " → "
             << escape_html(h.to_agent) << "</h3><pre>"
             << escape_html(h.to_markdown()) << "</pre></div>";
    }
    body << "<h2>Final</h2><div class='card'><pre>"
         << escape_html(result.final_output) << "</pre></div>";
    return shell_page("HandoffKit Team Report", body.str());
}

std::string render_quality_html(const HandoffQualityReport& report) {
    std::ostringstream body;
    body << "<h1>Handoff quality</h1>"
         << "<div class='card'><p>score=" << report.score
         << " grade=" << escape_html(report.grade)
         << " success=" << (report.success ? "true" : "false") << "</p></div>";
    body << "<h2>Metrics</h2>";
    for (const auto& m : report.metrics) {
        body << "<div class='card'><strong>" << escape_html(m.name)
             << "</strong> score=" << m.score << " weight=" << m.weight << "<ul>";
        for (const auto& n : m.notes) {
            body << "<li>" << escape_html(n) << "</li>";
        }
        body << "</ul></div>";
    }
    if (!report.recommendations.empty()) {
        body << "<h2>Recommendations</h2><div class='card'><ul>";
        for (const auto& r : report.recommendations) {
            body << "<li>" << escape_html(r) << "</li>";
        }
        body << "</ul></div>";
    }
    return shell_page("HandoffKit Quality", body.str());
}

Result<std::string> write_html_report(
    const std::filesystem::path& path,
    const std::string& html
) {
    std::error_code ec;
    if (path.has_parent_path()) {
        std::filesystem::create_directories(path.parent_path(), ec);
        if (ec) {
            return Error::provider_failed("Failed to create HTML report directory: " + ec.message());
        }
    }
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return Error::provider_failed("Failed to open HTML report: " + path.string());
    }
    out << html;
    if (!out) {
        return Error::provider_failed("Failed while writing HTML report");
    }
    return Result<std::string>::success(path.string());
}

}  // namespace handoffkit
