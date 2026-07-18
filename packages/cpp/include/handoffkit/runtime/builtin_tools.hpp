#pragma once

#include <handoffkit/runtime/tool.hpp>

#include <string>
#include <vector>

namespace handoffkit {

/// Built-in offline tools used by demos and CLI (deterministic, no network).
[[nodiscard]] Tool make_calculator_tool();
[[nodiscard]] Tool make_string_stats_tool();
[[nodiscard]] Tool make_json_lookup_tool(nlohmann::json store);
[[nodiscard]] Tool make_ticket_lookup_tool();
[[nodiscard]] Tool make_sla_check_tool();
[[nodiscard]] Tool make_code_lint_stub_tool();
[[nodiscard]] Tool make_diff_summary_tool();
[[nodiscard]] Tool make_keyword_extract_tool();
[[nodiscard]] Tool make_priority_score_tool();
[[nodiscard]] Tool make_checklist_tool();

/// Opt-in only: named "shell". Does not execute a real shell; always denies.
/// Not part of the default safe registry.
[[nodiscard]] Tool make_shell_tool_denied();

/// Default safe toolbox (no shell, no unrestricted filesystem).
void register_default_safe_tools(ToolRegistry& registry);

/// Alias of register_default_safe_tools (demo/CLI offline suite).
void register_demo_toolbox(ToolRegistry& registry);

/// Explicit opt-in: registers the denied shell tool (still cannot run OS commands).
void register_shell_tool(ToolRegistry& registry);

/// Register support-escalation tools only.
void register_support_tools(ToolRegistry& registry);

/// Register coding-review tools only.
void register_coding_tools(ToolRegistry& registry);

/// Names of default safe tools (never includes "shell").
[[nodiscard]] std::vector<std::string> builtin_tool_names();
[[nodiscard]] std::vector<std::string> default_safe_tool_names();

}  // namespace handoffkit
