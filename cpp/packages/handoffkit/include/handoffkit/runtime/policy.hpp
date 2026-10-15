#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/runtime/tool.hpp>

#include <filesystem>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace handoffkit {

enum class PathAccess { Read, Write, Execute };

struct PathPolicyDecision {
    bool allowed = false;
    std::string reason;
    std::filesystem::path resolved;
};

/// Workspace-scoped path policy (offline analogue of Python ToolSandbox FS rules).
class PathPolicy {
public:
    explicit PathPolicy(std::filesystem::path workspace);

    [[nodiscard]] const std::filesystem::path& workspace() const noexcept { return workspace_; }

    [[nodiscard]] PathPolicyDecision check(const std::filesystem::path& path, PathAccess access) const;

    /// Resolve user path under workspace; rejects escapes with .. outside root.
    [[nodiscard]] Result<std::filesystem::path> resolve_under_workspace(const std::filesystem::path& path) const;

private:
    std::filesystem::path workspace_;
};

struct ApprovalRequest {
    std::string tool_name;
    std::string action;  // e.g. write_file, run_command
    nlohmann::json details = nlohmann::json::object();
};

struct ApprovalDecision {
    bool allowed = false;
    std::string reason;
    bool requires_human = false;
};

/// Deterministic approval policy for mutating tools (offline).
class ApprovalPolicy {
public:
    explicit ApprovalPolicy(bool require_approval_default = true)
        : require_approval_default_(require_approval_default) {}

    void allow_tool(std::string name) { allowlist_.insert(std::move(name)); }
    void deny_tool(std::string name) { denylist_.insert(std::move(name)); }
    void set_auto_approve_reads(bool v) { auto_approve_reads_ = v; }

    [[nodiscard]] ApprovalDecision decide(const ApprovalRequest& request) const;

    /// Classify tool mutability by name heuristics used in demos.
    [[nodiscard]] static bool is_read_only_tool(std::string_view name);
    [[nodiscard]] static bool is_mutating_tool(std::string_view name);

private:
    bool require_approval_default_ = true;
    bool auto_approve_reads_ = true;
    std::unordered_set<std::string> allowlist_;
    std::unordered_set<std::string> denylist_;
};

/// Wrap ToolRegistry execute with approval + optional path checks in arguments.
class PolicyGuardedRegistry {
public:
    PolicyGuardedRegistry(ToolRegistry registry, ApprovalPolicy approvals, PathPolicy paths)
        : registry_(std::move(registry)),
          approvals_(std::move(approvals)),
          paths_(std::move(paths)) {}

    Result<ToolResult> execute(const ToolCall& call) const;

    [[nodiscard]] ToolRegistry& registry() noexcept { return registry_; }
    [[nodiscard]] const ToolRegistry& registry() const noexcept { return registry_; }

private:
    ToolRegistry registry_;
    ApprovalPolicy approvals_;
    PathPolicy paths_;
};

}  // namespace handoffkit
