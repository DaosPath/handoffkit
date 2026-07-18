#include <handoffkit/core/quality.hpp>
#include <handoffkit/core/validation.hpp>
#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/io/html_report.hpp>
#include <handoffkit/io/reports.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <fstream>
#include <sstream>

namespace handoffkit {
namespace demos {

nlohmann::json DemoResult::to_json() const {
    nlohmann::json handoff_json = nlohmann::json::array();
    for (const auto& h : handoffs) {
        handoff_json.push_back(h.to_json());
    }
    return nlohmann::json{
        {"success", success},
        {"name", name},
        {"title", title},
        {"task", task},
        {"final_output", final_output},
        {"summary_markdown", summary_markdown},
        {"handoffs", std::move(handoff_json)},
        {"trace", trace.to_json()},
        {"report", report.is_null() ? nlohmann::json::object() : report},
        {"artifact_paths", artifact_paths},
    };
}

std::string DemoResult::to_markdown() const {
    std::ostringstream ss;
    ss << "# " << title << "\n\n"
       << "- demo: `" << name << "`\n"
       << "- success: " << (success ? "true" : "false") << "\n"
       << "- task: " << task << "\n\n"
       << "## Final output\n\n"
       << (final_output.empty() ? "_" : final_output) << "\n\n"
       << "## Handoffs\n\n";
    if (handoffs.empty()) {
        ss << "_none_\n";
    } else {
        for (const auto& h : handoffs) {
            ss << h.to_markdown() << "\n\n";
        }
    }
    if (!summary_markdown.empty()) {
        ss << "## Notes\n\n" << summary_markdown << "\n";
    }
    return ss.str();
}

Agent make_echo_agent(std::string name, std::string role) {
    return Agent(std::move(name), std::move(role), EchoProvider().as_any());
}

Result<std::string> write_demo_artifacts(const DemoOptions& options, DemoResult& result) {
    if (!options.write_files) {
        return Result<std::string>::success("");
    }
    std::error_code ec;
    std::filesystem::create_directories(options.output_dir, ec);
    if (ec) {
        return Error::provider_failed("Failed to create demo output dir: " + ec.message());
    }
    const auto base = options.output_dir / result.name;
    auto json_path = write_report_json(std::filesystem::path(base.string() + ".json"), result.to_json());
    if (!json_path) {
        return json_path;
    }
    result.artifact_paths.push_back(json_path.value());

    std::ofstream md(base.string() + ".md", std::ios::binary);
    if (md) {
        md << result.to_markdown();
        result.artifact_paths.push_back(base.string() + ".md");
    }

    if (!result.trace.run_id.empty()) {
        auto trace_files = write_report_files(options.output_dir, result.name + "_trace", result.trace);
        if (trace_files) {
            result.artifact_paths.push_back(trace_files.value());
        }
        auto html = write_html_report(
            options.output_dir / (result.name + ".html"),
            render_trace_html(result.trace)
        );
        if (html) {
            result.artifact_paths.push_back(html.value());
        }
    }
    return Result<std::string>::success(json_path.value());
}

namespace {

DemoResult base_result(std::string name, std::string title, std::string task) {
    DemoResult r;
    r.name = std::move(name);
    r.title = std::move(title);
    r.task = std::move(task);
    return r;
}

}  // namespace

// Forward-declared implementations live in demo_showcases.cpp / demo_matrix.cpp
// Catalog registration is in demo_catalog.cpp

}  // namespace demos
}  // namespace handoffkit
