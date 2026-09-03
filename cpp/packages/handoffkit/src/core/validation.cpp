#include <handoffkit/core/validation.hpp>

namespace handoffkit {

ValidationReport HandoffStateValidator::validate(const HandoffState& state) const {
    ValidationReport report;
    report.success = true;
    report.metadata = nlohmann::json{{"validator", "HandoffStateValidator"}};

    auto require_text = [&](const std::string& field, const std::string& value) {
        if (value.find_first_not_of(" \t\r\n") == std::string::npos) {
            ValidationIssue issue;
            issue.code = "required_text";
            issue.message = field + " must be a non-empty string";
            issue.field = field;
            issue.severity = "error";
            report.issues.push_back(std::move(issue));
        }
    };

    require_text("task", state.task);
    require_text("from_agent", state.from_agent);
    require_text("to_agent", state.to_agent);

    if (state.summary.find_first_not_of(" \t\r\n") == std::string::npos) {
        ValidationIssue issue;
        issue.code = "empty_summary";
        issue.message = "summary is empty";
        issue.field = "summary";
        issue.severity = "warning";
        report.issues.push_back(std::move(issue));
    }

    report.success = true;
    for (const auto& issue : report.issues) {
        if (issue.severity == "error") {
            report.success = false;
            break;
        }
    }
    return report;
}

ValidationReport ToolSchemaValidator::validate(const nlohmann::json& schema) const {
    ValidationReport report;
    report.metadata = nlohmann::json{{"validator", "ToolSchemaValidator"}};

    if (!schema.is_object()) {
        ValidationIssue issue;
        issue.code = "not_object";
        issue.message = "tool schema must be a dictionary";
        issue.severity = "error";
        report.issues.push_back(std::move(issue));
        report.success = false;
        return report;
    }

    const std::string name = schema.value("name", "");
    if (name.find_first_not_of(" \t\r\n") == std::string::npos) {
        ValidationIssue issue;
        issue.code = "missing_name";
        issue.message = "tool schema name must be a non-empty string";
        issue.field = "name";
        issue.severity = "error";
        report.issues.push_back(std::move(issue));
    }

    if (!schema.contains("parameters") || !schema["parameters"].is_object()) {
        ValidationIssue issue;
        issue.code = "invalid_parameters";
        issue.message = "tool schema parameters must be an object";
        issue.field = "parameters";
        issue.severity = "error";
        report.issues.push_back(std::move(issue));
    } else if (schema["parameters"].value("type", "") != "object") {
        ValidationIssue issue;
        issue.code = "invalid_parameters_type";
        issue.message = "tool schema parameters.type must be object";
        issue.field = "parameters.type";
        issue.severity = "error";
        report.issues.push_back(std::move(issue));
    }

    report.success = true;
    for (const auto& issue : report.issues) {
        if (issue.severity == "error") {
            report.success = false;
            break;
        }
    }
    return report;
}

nlohmann::json ProviderToolSchema::to_json() const {
    return nlohmann::json{
        {"name", name},
        {"description", description},
        {"parameters", parameters.is_null() ? nlohmann::json::object() : parameters},
    };
}

ProviderToolSchema ProviderToolSchema::from_json(const nlohmann::json& j) {
    ProviderToolSchema schema;
    schema.name = j.value("name", "");
    schema.description = j.value("description", "");
    schema.parameters = j.value("parameters", nlohmann::json::object());
    return schema;
}

}  // namespace handoffkit
