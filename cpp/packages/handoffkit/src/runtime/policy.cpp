#include <handoffkit/runtime/policy.hpp>
#include <handoffkit/util/text.hpp>

#include <system_error>

namespace handoffkit {
namespace {

bool is_relative_escape(const std::filesystem::path& p) {
    int depth = 0;
    for (const auto& part : p) {
        if (part == "..") {
            --depth;
            if (depth < 0) return true;
        } else if (part != "." && part != "") {
            ++depth;
        }
    }
    return false;
}

}  // namespace

PathPolicy::PathPolicy(std::filesystem::path workspace)
    : workspace_(std::filesystem::absolute(std::move(workspace))) {}

Result<std::filesystem::path> PathPolicy::resolve_under_workspace(const std::filesystem::path& path) const {
    if (path.empty()) {
        return Error::invalid_argument("path is empty", "path");
    }
    std::filesystem::path candidate = path;
    if (candidate.is_relative()) {
        if (is_relative_escape(candidate)) {
            return Error::invalid_argument("path escapes workspace via ..", "path");
        }
        candidate = workspace_ / candidate;
    }
    std::error_code ec;
    auto abs = std::filesystem::weakly_canonical(candidate, ec);
    if (ec) {
        abs = std::filesystem::absolute(candidate);
    }
    auto ws = std::filesystem::weakly_canonical(workspace_, ec);
    if (ec) ws = workspace_;
    const std::string abs_s = abs.string();
    const std::string ws_s = ws.string();
    if (abs_s.size() < ws_s.size() || abs_s.compare(0, ws_s.size(), ws_s) != 0) {
        // allow exact workspace or nested with separator
        if (abs_s != ws_s) {
            const char sep = static_cast<char>(std::filesystem::path::preferred_separator);
            if (!(abs_s.size() > ws_s.size() && abs_s[ws_s.size()] == sep &&
                  abs_s.compare(0, ws_s.size(), ws_s) == 0)) {
                return Error::invalid_argument("path outside workspace: " + abs_s, "path");
            }
        }
    }
    return Result<std::filesystem::path>::success(abs);
}

PathPolicyDecision PathPolicy::check(const std::filesystem::path& path, PathAccess access) const {
    PathPolicyDecision d;
    auto resolved = resolve_under_workspace(path);
    if (!resolved) {
        d.allowed = false;
        d.reason = resolved.error().message;
        return d;
    }
    d.resolved = resolved.value();
    d.allowed = true;
    d.reason = access == PathAccess::Write ? "write allowed under workspace"
             : access == PathAccess::Execute ? "execute path under workspace"
                                             : "read allowed under workspace";
    return d;
}

bool ApprovalPolicy::is_read_only_tool(std::string_view name) {
    static const char* read_only[] = {
        "ticket_lookup", "sla_check", "string_stats", "keyword_extract",
        "json_lookup", "diff_summary", "calculator", "priority_score", "checklist",
        "code_lint_stub",
    };
    for (const char* n : read_only) {
        if (name == n) return true;
    }
    return text::starts_with(name, "get_") || text::starts_with(name, "list_") ||
           text::starts_with(name, "read_") || text::starts_with(name, "lookup_");
}

bool ApprovalPolicy::is_mutating_tool(std::string_view name) {
    if (is_read_only_tool(name)) return false;
    return text::starts_with(name, "write_") || text::starts_with(name, "delete_") ||
           text::starts_with(name, "run_") || text::starts_with(name, "apply_") ||
           text::contains_ci(name, "mutate") || text::contains_ci(name, "exec");
}

ApprovalDecision ApprovalPolicy::decide(const ApprovalRequest& request) const {
    ApprovalDecision d;
    if (denylist_.count(request.tool_name)) {
        d.allowed = false;
        d.reason = "tool denied by denylist";
        return d;
    }
    if (allowlist_.count(request.tool_name)) {
        d.allowed = true;
        d.reason = "tool allowlisted";
        return d;
    }
    if (auto_approve_reads_ && is_read_only_tool(request.tool_name)) {
        d.allowed = true;
        d.reason = "read-only tool auto-approved";
        return d;
    }
    if (is_mutating_tool(request.tool_name) && require_approval_default_) {
        d.allowed = false;
        d.requires_human = true;
        d.reason = "mutating tool requires approval";
        return d;
    }
    if (require_approval_default_ && !is_read_only_tool(request.tool_name)) {
        d.allowed = false;
        d.requires_human = true;
        d.reason = "approval required by default policy";
        return d;
    }
    d.allowed = true;
    d.reason = "allowed by default policy";
    return d;
}

Result<ToolResult> PolicyGuardedRegistry::execute(const ToolCall& call) const {
    ApprovalRequest req;
    req.tool_name = call.tool_name;
    req.action = "execute";
    req.details = call.arguments.is_null() ? nlohmann::json::object() : call.arguments;
    auto decision = approvals_.decide(req);
    if (!decision.allowed) {
        ToolResult denied;
        denied.tool_name = call.tool_name;
        denied.call_id = call.call_id;
        denied.success = false;
        denied.error = decision.reason;
        denied.metadata = {
            {"policy", "approval"},
            {"requires_human", decision.requires_human},
        };
        return Result<ToolResult>::success(std::move(denied));
    }

    // If args include path/file fields, enforce workspace policy.
    if (call.arguments.is_object()) {
        for (const char* key : {"path", "file", "filename", "output_path", "input_path"}) {
            if (call.arguments.contains(key) && call.arguments[key].is_string()) {
                auto check = paths_.check(call.arguments[key].get<std::string>(), PathAccess::Read);
                if (!check.allowed) {
                    ToolResult denied;
                    denied.tool_name = call.tool_name;
                    denied.success = false;
                    denied.error = check.reason;
                    denied.metadata = {{"policy", "path"}, {"field", key}};
                    return Result<ToolResult>::success(std::move(denied));
                }
            }
        }
    }
    return registry_.execute(call);
}

}  // namespace handoffkit
