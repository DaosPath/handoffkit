#include <handoffkit/runtime/builtin_tools.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <sstream>
#include <unordered_map>
#include <utility>

namespace handoffkit {
namespace {

bool is_number_token(const std::string& s) {
    if (s.empty()) return false;
    std::size_t i = 0;
    if (s[0] == '+' || s[0] == '-') i = 1;
    bool seen_digit = false;
    bool seen_dot = false;
    for (; i < s.size(); ++i) {
        if (std::isdigit(static_cast<unsigned char>(s[i]))) {
            seen_digit = true;
        } else if (s[i] == '.' && !seen_dot) {
            seen_dot = true;
        } else {
            return false;
        }
    }
    return seen_digit;
}

}  // namespace

Tool make_calculator_tool() {
    return Tool(
        "calculator",
        "Evaluate a simple binary arithmetic expression: a op b with op in + - * /",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("expression") || !args["expression"].is_string()) {
                return Error::invalid_argument("expression string required", "expression");
            }
            std::string expr = args["expression"].get<std::string>();
            std::istringstream iss(expr);
            double a = 0, b = 0;
            char op = 0;
            if (!(iss >> a >> op >> b)) {
                return Error::invalid_argument("could not parse expression", "expression");
            }
            double value = 0;
            switch (op) {
                case '+': value = a + b; break;
                case '-': value = a - b; break;
                case '*': value = a * b; break;
                case '/':
                    if (b == 0.0) {
                        return Error::invalid_argument("division by zero", "expression");
                    }
                    value = a / b;
                    break;
                default:
                    return Error::invalid_argument("unsupported operator", "expression");
            }
            return nlohmann::json{{"result", value}, {"expression", expr}};
        },
        nlohmann::json{
            {"type", "object"},
            {"properties", {{"expression", {{"type", "string"}}}}},
            {"required", nlohmann::json::array({"expression"})},
        }
    );
}

Tool make_string_stats_tool() {
    return Tool(
        "string_stats",
        "Compute basic statistics for a text string",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("text") || !args["text"].is_string()) {
                return Error::invalid_argument("text string required", "text");
            }
            const std::string text = args["text"].get<std::string>();
            std::size_t words = 0;
            bool in_word = false;
            std::size_t lines = 1;
            for (unsigned char ch : text) {
                if (ch == '\n') ++lines;
                if (std::isspace(ch)) {
                    in_word = false;
                } else if (!in_word) {
                    in_word = true;
                    ++words;
                }
            }
            return nlohmann::json{
                {"chars", text.size()},
                {"words", words},
                {"lines", text.empty() ? 0 : lines},
            };
        }
    );
}

Tool make_json_lookup_tool(nlohmann::json store) {
    return Tool(
        "json_lookup",
        "Lookup a key in a fixed offline JSON store",
        [store = std::move(store)](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("key") || !args["key"].is_string()) {
                return Error::invalid_argument("key string required", "key");
            }
            const std::string key = args["key"].get<std::string>();
            if (!store.contains(key)) {
                return Error::invalid_argument("key not found: " + key, "key");
            }
            return nlohmann::json{{"key", key}, {"value", store.at(key)}};
        }
    );
}

Tool make_ticket_lookup_tool() {
    nlohmann::json tickets = {
        {"T-1001", {{"priority", "P1"}, {"customer", "Acme"}, {"summary", "Checkout 500 errors"}}},
        {"T-1002", {{"priority", "P3"}, {"customer", "Globex"}, {"summary", "Slow dashboard"}}},
        {"T-2044", {{"priority", "P0"}, {"customer", "Initech"}, {"summary", "Auth outage"}}},
        {"T-3000", {{"priority", "P2"}, {"customer", "Umbrella"}, {"summary", "CSV export truncated"}}},
    };
    return Tool(
        "ticket_lookup",
        "Lookup a support ticket by id from offline catalog",
        [tickets](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("ticket_id") || !args["ticket_id"].is_string()) {
                return Error::invalid_argument("ticket_id required", "ticket_id");
            }
            const std::string id = args["ticket_id"].get<std::string>();
            if (!tickets.contains(id)) {
                return nlohmann::json{{"found", false}, {"ticket_id", id}};
            }
            auto value = tickets.at(id);
            value["found"] = true;
            value["ticket_id"] = id;
            return value;
        }
    );
}

Tool make_sla_check_tool() {
    return Tool(
        "sla_check",
        "Check SLA breach risk from priority and age_hours",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            const std::string priority = args.value("priority", "P3");
            const double age = args.value("age_hours", 0.0);
            double limit = 72.0;
            if (priority == "P0") limit = 1.0;
            else if (priority == "P1") limit = 4.0;
            else if (priority == "P2") limit = 24.0;
            const bool breached = age > limit;
            const bool at_risk = age > (limit * 0.75);
            return nlohmann::json{
                {"priority", priority},
                {"age_hours", age},
                {"limit_hours", limit},
                {"breached", breached},
                {"at_risk", at_risk},
                {"action", breached ? "escalate" : (at_risk ? "watch" : "standard")},
            };
        }
    );
}

Tool make_code_lint_stub_tool() {
    return Tool(
        "code_lint_stub",
        "Offline lint stub: flags TODO/FIXME and long lines",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("source") || !args["source"].is_string()) {
                return Error::invalid_argument("source required", "source");
            }
            const std::string source = args["source"].get<std::string>();
            nlohmann::json issues = nlohmann::json::array();
            std::istringstream iss(source);
            std::string line;
            int lineno = 0;
            while (std::getline(iss, line)) {
                ++lineno;
                if (line.find("TODO") != std::string::npos || line.find("FIXME") != std::string::npos) {
                    issues.push_back({{"line", lineno}, {"code", "todo_marker"}, {"message", "Unresolved marker"}});
                }
                if (line.size() > 100) {
                    issues.push_back({{"line", lineno}, {"code", "line_length"}, {"message", "Line exceeds 100 chars"}});
                }
            }
            return nlohmann::json{{"issue_count", issues.size()}, {"issues", issues}};
        }
    );
}

Tool make_diff_summary_tool() {
    return Tool(
        "diff_summary",
        "Summarize added/removed line markers in a unified diff-like text",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("diff") || !args["diff"].is_string()) {
                return Error::invalid_argument("diff required", "diff");
            }
            const std::string diff = args["diff"].get<std::string>();
            int added = 0, removed = 0, files = 0;
            std::istringstream iss(diff);
            std::string line;
            while (std::getline(iss, line)) {
                if (line.rfind("+++ ", 0) == 0 || line.rfind("--- ", 0) == 0) {
                    ++files;
                } else if (!line.empty() && line[0] == '+' && line.rfind("+++", 0) != 0) {
                    ++added;
                } else if (!line.empty() && line[0] == '-' && line.rfind("---", 0) != 0) {
                    ++removed;
                }
            }
            return nlohmann::json{{"added", added}, {"removed", removed}, {"file_markers", files}};
        }
    );
}

Tool make_keyword_extract_tool() {
    return Tool(
        "keyword_extract",
        "Extract repeated lowercase tokens of length >= 4",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("text") || !args["text"].is_string()) {
                return Error::invalid_argument("text required", "text");
            }
            std::string text = args["text"].get<std::string>();
            for (char& ch : text) {
                ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
                if (!std::isalnum(static_cast<unsigned char>(ch))) ch = ' ';
            }
            std::istringstream iss(text);
            std::string token;
            std::unordered_map<std::string, int> counts;
            while (iss >> token) {
                if (token.size() >= 4) counts[token]++;
            }
            std::vector<std::pair<std::string, int>> ranked(counts.begin(), counts.end());
            std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) {
                if (a.second != b.second) return a.second > b.second;
                return a.first < b.first;
            });
            nlohmann::json top = nlohmann::json::array();
            for (std::size_t i = 0; i < ranked.size() && i < 12; ++i) {
                top.push_back({{"token", ranked[i].first}, {"count", ranked[i].second}});
            }
            return nlohmann::json{{"keywords", top}};
        }
    );
}

Tool make_priority_score_tool() {
    return Tool(
        "priority_score",
        "Score priority from impact (1-5) and urgency (1-5)",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            const int impact = args.value("impact", 1);
            const int urgency = args.value("urgency", 1);
            if (impact < 1 || impact > 5 || urgency < 1 || urgency > 5) {
                return Error::invalid_argument("impact and urgency must be 1..5");
            }
            const int score = impact * urgency;
            std::string band = "low";
            if (score >= 16) band = "critical";
            else if (score >= 9) band = "high";
            else if (score >= 4) band = "medium";
            return nlohmann::json{{"score", score}, {"band", band}, {"impact", impact}, {"urgency", urgency}};
        }
    );
}

Tool make_checklist_tool() {
    return Tool(
        "checklist",
        "Evaluate a checklist of boolean flags and return coverage",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("items") || !args["items"].is_object()) {
                return Error::invalid_argument("items object required", "items");
            }
            int total = 0, ok = 0;
            nlohmann::json missing = nlohmann::json::array();
            for (auto it = args["items"].begin(); it != args["items"].end(); ++it) {
                ++total;
                const bool passed = it.value().is_boolean() ? it.value().get<bool>() : false;
                if (passed) ++ok;
                else missing.push_back(it.key());
            }
            const double coverage = total == 0 ? 0.0 : static_cast<double>(ok) / static_cast<double>(total);
            return nlohmann::json{
                {"total", total},
                {"passed", ok},
                {"coverage", coverage},
                {"missing", missing},
                {"complete", missing.empty()},
            };
        }
    );
}

// Note: web explorer tools are registered via explore::register_web_explorer_tools
// so offline demos stay free of network defaults. Call that explicitly for crawl tools.

Tool make_shell_tool_denied() {
    return Tool(
        "shell",
        "Opt-in shell tool slot (always denied offline; never in default safe registry)",
        [](const nlohmann::json& /*args*/) -> Result<nlohmann::json> {
            return Error::invalid_argument(
                "shell execution denied: not enabled in default safe mode",
                "shell"
            );
        },
        nlohmann::json{
            {"type", "object"},
            {"properties", {{"command", {{"type", "string"}}}}},
            {"required", nlohmann::json::array({"command"})},
        }
    );
}

void register_default_safe_tools(ToolRegistry& registry) {
    registry.add(make_calculator_tool());
    registry.add(make_string_stats_tool());
    registry.add(make_ticket_lookup_tool());
    registry.add(make_sla_check_tool());
    registry.add(make_code_lint_stub_tool());
    registry.add(make_diff_summary_tool());
    registry.add(make_keyword_extract_tool());
    registry.add(make_priority_score_tool());
    registry.add(make_checklist_tool());
}

void register_demo_toolbox(ToolRegistry& registry) {
    register_default_safe_tools(registry);
}

void register_shell_tool(ToolRegistry& registry) {
    registry.add(make_shell_tool_denied());
}

void register_support_tools(ToolRegistry& registry) {
    registry.add(make_ticket_lookup_tool());
    registry.add(make_sla_check_tool());
    registry.add(make_priority_score_tool());
    registry.add(make_keyword_extract_tool());
}

void register_coding_tools(ToolRegistry& registry) {
    registry.add(make_code_lint_stub_tool());
    registry.add(make_diff_summary_tool());
    registry.add(make_checklist_tool());
    registry.add(make_string_stats_tool());
}

std::vector<std::string> default_safe_tool_names() {
    return {
        "calculator", "string_stats", "ticket_lookup", "sla_check", "code_lint_stub",
        "diff_summary", "keyword_extract", "priority_score", "checklist",
    };
}

std::vector<std::string> builtin_tool_names() {
    return default_safe_tool_names();
}

}  // namespace handoffkit
