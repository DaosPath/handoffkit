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

/// Register a standard demo toolbox on a registry.
void register_demo_toolbox(ToolRegistry& registry);

/// Register support-escalation tools only.
void register_support_tools(ToolRegistry& registry);

/// Register coding-review tools only.
void register_coding_tools(ToolRegistry& registry);

[[nodiscard]] std::vector<std::string> builtin_tool_names();

}  // namespace handoffkit
