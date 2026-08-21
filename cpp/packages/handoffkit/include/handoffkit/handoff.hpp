#pragma once

#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace handoffkit {

struct HandoffState {
    std::string task;
    std::string from_agent;
    std::string to_agent;
    std::string summary;
    std::vector<std::string> decisions;
    std::vector<std::string> important_files;
    std::vector<std::string> errors;
    std::vector<std::string> next_steps;
    std::vector<std::string> context_refs;
    nlohmann::json metadata;

    std::string to_markdown() const;
    static HandoffState from_markdown(const std::string& text);

    nlohmann::json to_json() const;
    static HandoffState from_json(const nlohmann::json& j);
};

struct TraceStep {
    std::string name;
    std::string agent;
    std::string task;
    std::string mode;
    bool success = true;
    std::string output;
    std::vector<nlohmann::json> tool_results;
    std::vector<nlohmann::json> events;
    nlohmann::json handoff;
    nlohmann::json metadata;

    nlohmann::json to_json() const;
    static TraceStep from_json(const nlohmann::json& j);
};

struct RunTrace {
    std::string run_id;
    std::string name;
    bool success = true;
    std::string final_output;
    std::vector<TraceStep> steps;
    std::vector<HandoffState> handoffs;
    nlohmann::json metadata;

    std::string to_timeline() const;

    nlohmann::json to_json() const;
    static RunTrace from_json(const nlohmann::json& j);
};

struct ContextDocument {
    std::string path;
    std::string content;
    std::string summary;
    nlohmann::json metadata;

    nlohmann::json to_json() const;
    static ContextDocument from_json(const nlohmann::json& j);
};

struct ContextPack {
    std::string query;
    std::vector<ContextDocument> documents;
    std::vector<nlohmann::json> memories;
    std::string summary;
    nlohmann::json metadata;

    nlohmann::json to_json() const;
    static ContextPack from_json(const nlohmann::json& j);
};

struct ContextRunResult {
    std::string final_output;
    nlohmann::json context_used;
    std::vector<nlohmann::json> memories_used;
    bool success = true;

    nlohmann::json to_json() const;
    static ContextRunResult from_json(const nlohmann::json& j);
};

struct ValidationIssue {
    std::string code;
    std::string message;
    std::string field;
    std::string severity = "error";

    nlohmann::json to_json() const;
    static ValidationIssue from_json(const nlohmann::json& j);
};

struct ValidationReport {
    bool success = true;
    std::vector<ValidationIssue> issues;
    nlohmann::json metadata;

    std::string to_markdown() const;
    nlohmann::json to_json() const;
    static ValidationReport from_json(const nlohmann::json& j);
};

struct HandoffQualityMetric {
    std::string name;
    double score = 0.0;
    double weight = 1.0;
    std::vector<std::string> notes;

    nlohmann::json to_json() const;
    static HandoffQualityMetric from_json(const nlohmann::json& j);
};

struct HandoffQualityReport {
    bool success = true;
    double score = 0.0;
    std::string grade;
    std::vector<HandoffQualityMetric> metrics;
    std::vector<std::string> recommendations;
    ValidationReport validation;
    nlohmann::json metadata;

    std::string to_markdown() const;
    nlohmann::json to_json() const;
    static HandoffQualityReport from_json(const nlohmann::json& j);
};

struct ToolCall {
    std::string tool_name;
    nlohmann::json arguments;
    std::string call_id;
    nlohmann::json metadata;

    nlohmann::json to_json() const;
    static ToolCall from_json(const nlohmann::json& j);
};

struct ToolResult {
    std::string tool_name;
    bool success = true;
    nlohmann::json result;
    nlohmann::json error;
    std::string call_id;
    nlohmann::json metadata;

    nlohmann::json to_json() const;
    static ToolResult from_json(const nlohmann::json& j);
};

struct ContractParityReport {
    std::string runtime;
    std::string version;
    bool success = true;
    std::size_t fixture_count = 0;
    std::size_t schema_count = 0;
    std::vector<std::string> supported_contracts;

    std::string to_markdown() const;
    nlohmann::json to_json() const;
    static ContractParityReport from_inventory(
        const std::string& runtime,
        const std::string& version,
        const std::vector<std::string>& fixtures,
        const std::vector<std::string>& schemas
    );
};

} // namespace handoffkit
