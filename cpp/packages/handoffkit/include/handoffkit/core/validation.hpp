#pragma once

#include <handoffkit/handoff.hpp>

#include <string>

namespace handoffkit {

class HandoffStateValidator {
public:
    [[nodiscard]] ValidationReport validate(const HandoffState& state) const;
};

class ToolSchemaValidator {
public:
    /// Validate a provider/tool schema object (wire shape).
    [[nodiscard]] ValidationReport validate(const nlohmann::json& schema) const;
};

struct ProviderToolSchema {
    std::string name;
    std::string description;
    nlohmann::json parameters = nlohmann::json::object();

    nlohmann::json to_json() const;
    static ProviderToolSchema from_json(const nlohmann::json& j);
};

}  // namespace handoffkit
