#include <handoffkit/io/markdown_table.hpp>
#include <handoffkit/util/text.hpp>

#include <sstream>

namespace handoffkit {

std::string markdown_cell(std::string_view value) {
    std::string s(value);
    s = text::replace_all(s, "|", "\\|");
    s = text::replace_all(s, "\n", " ");
    return s;
}

std::string markdown_table(
    const std::vector<std::string>& headers,
    const std::vector<std::vector<std::string>>& rows
) {
    if (headers.empty()) return "";
    std::ostringstream ss;
    ss << "|";
    for (const auto& h : headers) ss << " " << markdown_cell(h) << " |";
    ss << "\n|";
    for (std::size_t i = 0; i < headers.size(); ++i) ss << " --- |";
    ss << "\n";
    for (const auto& row : rows) {
        ss << "|";
        for (std::size_t i = 0; i < headers.size(); ++i) {
            const std::string cell = i < row.size() ? row[i] : "";
            ss << " " << markdown_cell(cell) << " |";
        }
        ss << "\n";
    }
    return ss.str();
}

std::string markdown_table_from_json_array(
    const nlohmann::json& array,
    const std::vector<std::string>& keys
) {
    if (!array.is_array() || keys.empty()) return "";
    std::vector<std::vector<std::string>> rows;
    for (const auto& item : array) {
        if (!item.is_object()) continue;
        std::vector<std::string> row;
        for (const auto& k : keys) {
            if (!item.contains(k)) {
                row.emplace_back("");
                continue;
            }
            const auto& v = item.at(k);
            if (v.is_string()) row.push_back(v.get<std::string>());
            else if (v.is_boolean()) row.push_back(v.get<bool>() ? "true" : "false");
            else if (v.is_number_integer()) row.push_back(std::to_string(v.get<long long>()));
            else if (v.is_number_float()) row.push_back(std::to_string(v.get<double>()));
            else row.push_back(v.dump());
        }
        rows.push_back(std::move(row));
    }
    return markdown_table(keys, rows);
}

MarkdownReportBuilder& MarkdownReportBuilder::title(std::string t) {
    body_ += "# " + t + "\n\n";
    return *this;
}

MarkdownReportBuilder& MarkdownReportBuilder::heading(std::string h, int level) {
    if (level < 1) level = 1;
    if (level > 6) level = 6;
    body_ += std::string(static_cast<std::size_t>(level), '#') + " " + h + "\n\n";
    return *this;
}

MarkdownReportBuilder& MarkdownReportBuilder::paragraph(std::string p) {
    body_ += p + "\n\n";
    return *this;
}

MarkdownReportBuilder& MarkdownReportBuilder::bullets(const std::vector<std::string>& items) {
    body_ += text::bulletize(items) + "\n";
    return *this;
}

MarkdownReportBuilder& MarkdownReportBuilder::code_block(std::string code, std::string lang) {
    body_ += "```" + lang + "\n" + code;
    if (!code.empty() && code.back() != '\n') body_.push_back('\n');
    body_ += "```\n\n";
    return *this;
}

MarkdownReportBuilder& MarkdownReportBuilder::table(
    const std::vector<std::string>& headers,
    const std::vector<std::vector<std::string>>& rows
) {
    body_ += markdown_table(headers, rows) + "\n";
    return *this;
}

MarkdownReportBuilder& MarkdownReportBuilder::kv(std::string key, std::string value) {
    body_ += "- **" + key + "**: " + value + "\n";
    return *this;
}

MarkdownReportBuilder& MarkdownReportBuilder::raw(std::string chunk) {
    body_ += chunk;
    if (!chunk.empty() && chunk.back() != '\n') body_.push_back('\n');
    return *this;
}

std::string MarkdownReportBuilder::str() const {
    return body_;
}

}  // namespace handoffkit
