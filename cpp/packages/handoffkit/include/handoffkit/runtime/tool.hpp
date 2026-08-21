#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>

#include <functional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace handoffkit {

using ToolHandler = std::function<Result<nlohmann::json>(const nlohmann::json& args)>;

class Tool {
public:
    Tool(std::string name, std::string description, ToolHandler handler,
         nlohmann::json parameters_schema = nlohmann::json::object())
        : name_(std::move(name)),
          description_(std::move(description)),
          handler_(std::move(handler)),
          parameters_schema_(std::move(parameters_schema)) {}

    [[nodiscard]] const std::string& name() const noexcept { return name_; }
    [[nodiscard]] const std::string& description() const noexcept { return description_; }
    [[nodiscard]] const nlohmann::json& parameters_schema() const noexcept { return parameters_schema_; }

    Result<ToolResult> execute(const ToolCall& call) const {
        if (!handler_) {
            return Error::invalid_argument("Tool has no handler: " + name_);
        }
        if (!call.tool_name.empty() && call.tool_name != name_) {
            return Error::invalid_argument(
                "ToolCall name mismatch: expected " + name_ + ", got " + call.tool_name
            );
        }
        auto handled = handler_(call.arguments.is_null() ? nlohmann::json::object() : call.arguments);
        ToolResult result;
        result.tool_name = name_;
        result.call_id = call.call_id;
        result.metadata = call.metadata.is_null() ? nlohmann::json::object() : call.metadata;
        if (!handled) {
            result.success = false;
            result.error = handled.error().message;
            return Result<ToolResult>::success(std::move(result));
        }
        result.success = true;
        result.result = std::move(handled.value());
        return Result<ToolResult>::success(std::move(result));
    }

private:
    std::string name_;
    std::string description_;
    ToolHandler handler_;
    nlohmann::json parameters_schema_;
};

class ToolRegistry {
public:
    ToolRegistry() = default;

    explicit ToolRegistry(std::vector<Tool> tools) {
        for (auto& tool : tools) {
            add(std::move(tool));
        }
    }

    void add(Tool tool) {
        const std::string key = tool.name();
        tools_.insert_or_assign(key, std::move(tool));
    }

    [[nodiscard]] bool contains(const std::string& name) const {
        return tools_.find(name) != tools_.end();
    }

    Result<ToolResult> execute(const ToolCall& call) const {
        const std::string name = call.tool_name.empty()
            ? call.metadata.value("name", std::string{})
            : call.tool_name;
        auto it = tools_.find(name);
        if (it == tools_.end()) {
            return Error::tool_not_found("Tool not found: " + name);
        }
        return it->second.execute(call);
    }

    [[nodiscard]] std::vector<std::string> names() const {
        std::vector<std::string> out;
        out.reserve(tools_.size());
        for (const auto& [name, _] : tools_) {
            out.push_back(name);
        }
        return out;
    }

private:
    std::unordered_map<std::string, Tool> tools_;
};

}  // namespace handoffkit
