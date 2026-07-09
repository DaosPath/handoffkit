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

} // namespace handoffkit
