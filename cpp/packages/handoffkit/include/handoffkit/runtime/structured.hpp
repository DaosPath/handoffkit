#pragma once

#include <handoffkit/error.hpp>

#include <nlohmann/json.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

struct StructuredSchema {
    std::string name;
    std::vector<std::string> required_fields;
    nlohmann::json field_types = nlohmann::json::object();  // field -> "string"|"number"|"boolean"|"array"|"object"
};

struct StructuredParseResult {
    bool success = false;
    nlohmann::json value = nlohmann::json::object();
    std::vector<std::string> repairs;
    std::vector<std::string> errors;
    nlohmann::json to_json() const;
};

/// Extract JSON object from free-form agent text (fenced or raw).
[[nodiscard]] Result<nlohmann::json> extract_json_object(std::string_view text);

/// Validate JSON against a light schema.
[[nodiscard]] StructuredParseResult validate_structured(
    const nlohmann::json& value,
    const StructuredSchema& schema
);

/// Attempt common repairs: trailing commas, single quotes, bare keys.
[[nodiscard]] Result<nlohmann::json> repair_json_text(std::string_view text);

/// Parse agent output into structured JSON with optional repair + schema validation.
[[nodiscard]] StructuredParseResult parse_agent_structured(
    std::string_view text,
    const StructuredSchema& schema,
    bool allow_repair = true
);

/// Schemas used by demos/CLI.
[[nodiscard]] StructuredSchema rankings_schema();
[[nodiscard]] StructuredSchema action_plan_schema();
[[nodiscard]] StructuredSchema incident_update_schema();
[[nodiscard]] StructuredSchema review_verdict_schema();

/// Build a prompt suffix asking for schema-shaped JSON (offline Echo will echo it).
[[nodiscard]] std::string structured_prompt_suffix(const StructuredSchema& schema);

}  // namespace handoffkit
