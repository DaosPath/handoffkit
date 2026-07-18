#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

/// Build GitHub-flavored markdown tables from rows of string cells.
[[nodiscard]] std::string markdown_table(
    const std::vector<std::string>& headers,
    const std::vector<std::vector<std::string>>& rows
);

/// Render a JSON array of objects as a markdown table using selected keys.
[[nodiscard]] std::string markdown_table_from_json_array(
    const nlohmann::json& array,
    const std::vector<std::string>& keys
);

/// Escape pipe characters for markdown table cells.
[[nodiscard]] std::string markdown_cell(std::string_view value);

/// Multi-section report builder used by CLI evaluate/templates output.
class MarkdownReportBuilder {
public:
    MarkdownReportBuilder& title(std::string t);
    MarkdownReportBuilder& heading(std::string h, int level = 2);
    MarkdownReportBuilder& paragraph(std::string p);
    MarkdownReportBuilder& bullets(const std::vector<std::string>& items);
    MarkdownReportBuilder& code_block(std::string code, std::string lang = "");
    MarkdownReportBuilder& table(
        const std::vector<std::string>& headers,
        const std::vector<std::vector<std::string>>& rows
    );
    MarkdownReportBuilder& kv(std::string key, std::string value);
    MarkdownReportBuilder& raw(std::string chunk);
    [[nodiscard]] std::string str() const;

private:
    std::string body_;
};

}  // namespace handoffkit
