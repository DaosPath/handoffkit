#include <handoffkit/io/reports.hpp>
#include <handoffkit/runtime/team.hpp>

#include <fstream>
#include <sstream>

namespace handoffkit {

Result<std::string> write_report_json(
    const std::filesystem::path& path,
    const nlohmann::json& report
) {
    std::error_code ec;
    if (path.has_parent_path()) {
        std::filesystem::create_directories(path.parent_path(), ec);
        if (ec) {
            return Error::provider_failed("Failed to create report directory: " + ec.message());
        }
    }
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return Error::provider_failed("Failed to open report for write: " + path.string());
    }
    out << report.dump(2);
    if (!out) {
        return Error::provider_failed("Failed while writing report: " + path.string());
    }
    return Result<std::string>::success(path.string());
}

Result<std::string> write_report_json(
    const std::filesystem::path& path,
    const RunTrace& trace
) {
    return write_report_json(path, trace.to_json());
}

Result<std::string> write_report_json(
    const std::filesystem::path& path,
    const TeamRunResult& result
) {
    return write_report_json(path, result.to_json());
}

Result<nlohmann::json> load_report_json(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return Error::parse_error("Failed to open report: " + path.string());
    }
    try {
        nlohmann::json data;
        in >> data;
        return Result<nlohmann::json>::success(std::move(data));
    } catch (const std::exception& ex) {
        return Error::parse_error(std::string("Invalid report JSON: ") + ex.what());
    }
}

Result<std::string> write_report_files(
    const std::filesystem::path& directory,
    std::string_view basename,
    const RunTrace& trace
) {
    std::error_code ec;
    std::filesystem::create_directories(directory, ec);
    if (ec) {
        return Error::provider_failed("Failed to create report directory: " + ec.message());
    }
    const auto json_path = directory / (std::string(basename) + ".json");
    const auto md_path = directory / (std::string(basename) + ".md");

    auto written = write_report_json(json_path, trace);
    if (!written) {
        return written;
    }

    std::ofstream md(md_path, std::ios::binary);
    if (!md) {
        return Error::provider_failed("Failed to open markdown report: " + md_path.string());
    }
    md << trace.to_timeline();
    if (!md) {
        return Error::provider_failed("Failed while writing markdown report");
    }
    return Result<std::string>::success(json_path.string());
}

}  // namespace handoffkit
