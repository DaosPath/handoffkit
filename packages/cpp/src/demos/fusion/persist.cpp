#include <handoffkit/demos/fusion/persist.hpp>

#include <fstream>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {

PersistPaths make_persist_paths(const std::filesystem::path& output_dir, const std::string& run_id) {
    PersistPaths p;
    p.root = output_dir / run_id;
    p.manifest = p.root / "manifest.json";
    p.config = p.root / "config.json";
    p.metrics = p.root / "metrics.json";
    p.report_md = p.root / "report.md";
    p.report_json = p.root / "report.json";
    p.report_html = p.root / "report.html";
    p.handoffs = p.root / "handoffs.json";
    p.branches_dir = p.root / "branches";
    return p;
}

std::string fusion_run_html(const FusionRunResult& run) {
    std::ostringstream ss;
    ss << "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Fusion "
       << run.run_id << "</title>"
       << "<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}"
       << "pre{background:#f6f8fa;padding:1rem;overflow:auto;white-space:pre-wrap}"
       << "table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.4rem}</style>"
       << "</head><body>"
       << "<h1>Fusion run</h1>"
       << "<p><b>id</b> " << run.run_id
       << " | <b>success</b> " << (run.success ? "true" : "false")
       << " | <b>profile</b> " << fusion_profile_to_string(run.config.profile)
       << " | <b>mode</b> " << fusion_mode_to_string(run.config.mode)
       << " | <b>llm_calls</b> " << run.metrics.llm_calls
       << " | <b>cache_hit_rate</b> " << run.metrics.cache.hit_rate()
       << "</p>"
       << "<h2>Task</h2><pre>" << run.config.task << "</pre>"
       << "<h2>Final output</h2><pre>" << run.final_output << "</pre>";
    for (const auto& b : run.branches) {
        ss << "<h2>Branch " << b.branch_id << " (" << b.label << ")</h2><pre>"
           << b.combined << "</pre>";
    }
    ss << "<h2>Metrics</h2><pre>" << run.metrics.to_json().dump(2) << "</pre>"
       << "</body></html>";
    return ss.str();
}

Result<std::vector<std::string>> write_fusion_run(const FusionRunResult& run) {
    const auto paths = make_persist_paths(run.config.output_dir, run.run_id);
    std::error_code ec;
    std::filesystem::create_directories(paths.branches_dir, ec);
    if (ec) {
        return Result<std::vector<std::string>>::failure(
            Error::provider_failed("cannot create run dir: " + ec.message())
        );
    }

    auto write_text = [&](const std::filesystem::path& path, const std::string& body) -> Result<void> {
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        if (!out) return Result<void>::failure(Error::provider_failed("cannot write " + path.string()));
        out << body;
        return Result<void>::success();
    };

    nlohmann::json manifest{
        {"run_id", run.run_id},
        {"success", run.success},
        {"created_unix_ms", fusion_now_unix_ms()},
        {"profile", fusion_profile_to_string(run.config.profile)},
        {"mode", fusion_mode_to_string(run.config.mode)},
        {"provider", run.config.provider},
        {"llm_calls", run.metrics.llm_calls},
        {"cache_hit_rate", run.metrics.cache.hit_rate()},
    };

    if (auto r = write_text(paths.manifest, manifest.dump(2)); !r) {
        return Result<std::vector<std::string>>::failure(r.error());
    }
    if (auto r = write_text(paths.config, run.config.to_json().dump(2)); !r) {
        return Result<std::vector<std::string>>::failure(r.error());
    }
    if (auto r = write_text(paths.metrics, run.metrics.to_json().dump(2)); !r) {
        return Result<std::vector<std::string>>::failure(r.error());
    }
    if (auto r = write_text(paths.report_md, run.to_markdown()); !r) {
        return Result<std::vector<std::string>>::failure(r.error());
    }
    if (auto r = write_text(paths.report_json, run.to_json().dump(2)); !r) {
        return Result<std::vector<std::string>>::failure(r.error());
    }
    if (auto r = write_text(paths.report_html, fusion_run_html(run)); !r) {
        return Result<std::vector<std::string>>::failure(r.error());
    }

    nlohmann::json hs = nlohmann::json::array();
    for (const auto& h : run.handoffs) hs.push_back(h.to_json());
    if (auto r = write_text(paths.handoffs, hs.dump(2)); !r) {
        return Result<std::vector<std::string>>::failure(r.error());
    }

    for (const auto& b : run.branches) {
        const auto bp = paths.branches_dir / (b.branch_id + ".json");
        if (auto r = write_text(bp, b.to_json().dump(2)); !r) {
            return Result<std::vector<std::string>>::failure(r.error());
        }
    }

    std::vector<std::string> arts = {
        paths.manifest.string(),
        paths.config.string(),
        paths.metrics.string(),
        paths.report_md.string(),
        paths.report_json.string(),
        paths.report_html.string(),
        paths.handoffs.string(),
    };
    return arts;
}

Result<FusionRunResult> load_fusion_run(const std::filesystem::path& run_root) {
    const auto report_path = run_root / "report.json";
    if (!std::filesystem::exists(report_path)) {
        return Result<FusionRunResult>::failure(Error::parse_error("missing report.json in " + run_root.string()));
    }
    std::ifstream in(report_path, std::ios::binary);
    if (!in) return Result<FusionRunResult>::failure(Error::parse_error("cannot open " + report_path.string()));
    std::string body((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    try {
        const auto j = nlohmann::json::parse(body);
        FusionRunResult run;
        run.success = j.value("success", false);
        run.run_id = j.value("run_id", "");
        run.final_output = j.value("final_output", "");
        run.error = j.value("error", "");
        run.merge_output = j.value("merge_output", "");
        if (j.contains("config")) {
            auto c = FusionConfig::from_json(j.at("config"));
            if (c) run.config = c.value();
        }
        if (j.contains("metrics") && j.at("metrics").is_object()) {
            const auto& m = j.at("metrics");
            run.metrics.llm_calls = m.value("llm_calls", 0);
            run.metrics.handoff_count = m.value("handoff_count", 0);
            run.metrics.wall_ms = m.value("wall_ms", 0);
        }
        return run;
    } catch (const std::exception& ex) {
        return Result<FusionRunResult>::failure(Error::parse_error(std::string("load_fusion_run: ") + ex.what()));
    }
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
