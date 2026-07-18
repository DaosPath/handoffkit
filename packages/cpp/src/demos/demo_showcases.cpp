#include <handoffkit/core/quality.hpp>
#include <handoffkit/core/validation.hpp>
#include <handoffkit/demos/cases.hpp>
#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/runtime/builtin_tools.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/protocol.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/workflows/recipe.hpp>

#include <sstream>

namespace handoffkit {
namespace demos {
namespace {

DemoResult finished(DemoResult r, bool ok) {
    r.success = ok;
    return r;
}

std::string join_lines(const std::vector<std::string>& items) {
    std::ostringstream ss;
    for (const auto& item : items) {
        ss << "- " << item << "\n";
    }
    return ss.str();
}

}  // namespace

Result<DemoResult> run_team_handoff_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "team_handoff";
    result.title = "Sequential team handoff";
    result.task = options.case_id.empty()
        ? "Design and implement a packageable C++ multi-agent handoff runtime"
        : (find_case(options.case_id) ? find_case(options.case_id)->task : options.case_id);

    std::vector<Agent> agents;
    agents.push_back(make_echo_agent("Architect", "Designs system architecture and contracts"));
    agents.push_back(make_echo_agent("Coder", "Implements the design in C++20"));
    agents.push_back(make_echo_agent("Reviewer", "Reviews correctness, tests, and packaging"));

    Team team(std::move(agents), HandoffProtocol(options.protocol));
    auto run = team.run(result.task);
    if (!run) {
        return run.error();
    }
    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = build_run_trace("demo-team", "team_handoff", run.value(), protocol_mode_name(options.protocol));
    result.report = run.value().to_json();
    result.summary_markdown = "Three-agent pipeline with structured handoffs.";
    result.success = run.value().success && !result.final_output.empty();
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) {
        return artifacts.error();
    }
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_tools_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "tools";
    result.title = "Built-in tool registry demo";
    result.task = "Exercise calculator, keywords, checklist, and ticket tools offline";

    ToolRegistry registry;
    register_demo_toolbox(registry);

    nlohmann::json tool_results = nlohmann::json::array();
    auto run_one = [&](const std::string& name, nlohmann::json args) {
        ToolCall call;
        call.tool_name = name;
        call.call_id = "demo-" + name;
        call.arguments = std::move(args);
        auto out = registry.execute(call);
        if (!out) {
            tool_results.push_back({{"tool_name", name}, {"success", false}, {"error", out.error().message}});
            return false;
        }
        tool_results.push_back(out.value().to_json());
        return out.value().success;
    };

    bool ok = true;
    ok = run_one("calculator", {{"expression", "15 + 27"}}) && ok;
    ok = run_one("keyword_extract", {{"text", "handoff state transfer quality handoff quality metrics"}}) && ok;
    ok = run_one("checklist", {{"items", {{"tests", true}, {"docs", true}, {"packaging", false}}}}) && ok;
    ok = run_one("ticket_lookup", {{"ticket_id", "T-2044"}}) && ok;
    ok = run_one("sla_check", {{"priority", "P1"}, {"age_hours", 5}}) && ok;

    Agent agent = make_echo_agent("ToolSmith", "Summarizes tool outcomes for the team");
    auto summary = agent.run(result.task + "\nResults JSON: " + tool_results.dump());
    if (!summary) {
        return summary.error();
    }
    result.final_output = summary.value();
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"tool_results", tool_results},
        {"success", ok},
    };
    result.summary_markdown = "Offline tools executed through ToolRegistry.";
    result.success = ok && !result.final_output.empty();
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_protocol_matrix_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "protocol_matrix";
    result.title = "All protocol modes matrix";
    result.task = "Compare natural, compressed, hybrid_min, and hybrid_state handoffs";

    const ProtocolMode modes[] = {
        ProtocolMode::Natural,
        ProtocolMode::Compressed,
        ProtocolMode::HybridMin,
        ProtocolMode::HybridState,
    };
    nlohmann::json matrix = nlohmann::json::array();
    for (auto mode : modes) {
        TransferOptions t;
        t.task = result.task;
        t.from_agent = "Alpha";
        t.to_agent = "Beta";
        t.summary = "Alpha finished analysis with several constraints and open questions about packaging and CLI UX for operators.";
        auto state = HandoffProtocol(mode).transfer(t);
        if (!state) {
            return state.error();
        }
        result.handoffs.push_back(state.value());
        matrix.push_back({
            {"mode", protocol_mode_name(mode)},
            {"summary_chars", state.value().summary.size()},
            {"decisions", state.value().decisions.size()},
            {"next_steps", state.value().next_steps.size()},
            {"handoff", state.value().to_json()},
        });
    }
    result.final_output = matrix.dump(2);
    result.report = {{"task", result.task}, {"final_output", result.final_output}, {"matrix", matrix}};
    result.success = result.handoffs.size() == 4;
    result.summary_markdown = "Four protocol modes produced structured handoff states.";
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_validation_quality_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "validation_quality";
    result.title = "Validation pass/fail + quality scoring";
    result.task = "Validate weak and strong handoffs and score quality offline";

    HandoffState weak;
    weak.task = "";
    weak.from_agent = "A";
    weak.to_agent = "";
    weak.summary = "x";

    HandoffState strong;
    strong.task = "Ship C++ CLI and demos with offline quality gates";
    strong.from_agent = "Architect";
    strong.to_agent = "Coder";
    strong.summary = "Design complete for CLI dispatch, demo catalog, and report writers with snake_case wire format.";
    strong.decisions = {"Use Echo providers in demos", "Keep HTTP optional and off by default"};
    strong.important_files = {"packages/cpp/src/cli/cli_app.cpp", "packages/cpp/src/demos"};
    strong.errors = {"Watch Windows path separators in artifact writers"};
    strong.next_steps = {"Implement CLI commands", "Run ctest offline", "Write report JSON"};
    strong.context_refs = {"packages/cpp/README.md", "packages/contracts/fixtures"};

    HandoffStateValidator validator;
    HandoffQualityEvaluator evaluator;
    auto weak_v = validator.validate(weak);
    auto strong_v = validator.validate(strong);
    auto weak_q = evaluator.evaluate(weak);
    auto strong_q = evaluator.evaluate(strong);

    result.report = {
        {"task", result.task},
        {"weak_validation", weak_v.to_json()},
        {"strong_validation", strong_v.to_json()},
        {"weak_quality", weak_q.to_json()},
        {"strong_quality", strong_q.to_json()},
        {"final_output", strong_q.to_markdown()},
    };
    result.final_output = strong_q.to_markdown();
    result.handoffs = {strong};
    result.success = !weak_v.success && strong_v.success && strong_q.score > weak_q.score;
    result.summary_markdown = "Weak handoff fails validation; strong handoff scores higher.";
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_trace_report_demo(const DemoOptions& options) {
    auto team = run_team_handoff_demo(options);
    if (!team) return team;
    DemoResult result = std::move(team.value());
    result.name = "trace_report";
    result.title = "Trace + multi-format reports";
    result.report["html_enabled"] = true;
    result.summary_markdown += "\nAlso writes JSON/MD/HTML artifacts.";
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_support_escalation_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "support_escalation";
    result.title = "Customer support escalation";
    const DemoCase* c = find_case(options.case_id.empty() ? "support-01-v1" : options.case_id);
    result.task = c ? c->task : "Escalate P1 checkout outage with SLA risk and clear next owner";

    ToolRegistry tools;
    register_support_tools(tools);
    ToolCall ticket;
    ticket.tool_name = "ticket_lookup";
    ticket.arguments = {{"ticket_id", "T-2044"}};
    auto ticket_res = tools.execute(ticket);
    ToolCall sla;
    sla.tool_name = "sla_check";
    sla.arguments = {{"priority", "P0"}, {"age_hours", 2.5}};
    auto sla_res = tools.execute(sla);

    std::vector<Agent> agents;
    agents.push_back(make_echo_agent("L1_Support", "Triages tickets and gathers facts"));
    agents.push_back(make_echo_agent("L2_Support", "Deep-dives technical failure modes"));
    agents.push_back(make_echo_agent("Incident_Commander", "Owns escalation path and comms"));

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto run = team.run(result.task);
    if (!run) return run.error();

    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = build_run_trace("demo-support", "support_escalation", run.value(), "hybrid_state");
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"handoffs", nlohmann::json::array()},
        {"ticket", ticket_res ? ticket_res.value().to_json() : nlohmann::json{{"success", false}}},
        {"sla", sla_res ? sla_res.value().to_json() : nlohmann::json{{"success", false}}},
        {"agent_outputs", run.value().to_json().at("agent_outputs")},
    };
    for (const auto& h : result.handoffs) {
        result.report["handoffs"].push_back(h.to_json());
    }
    HandoffQualityEvaluator evaluator;
    if (!result.handoffs.empty()) {
        result.report["quality"] = evaluator.evaluate(result.handoffs.back()).to_json();
    }
    result.success = run.value().success && !result.final_output.empty();
    result.summary_markdown = "L1→L2→IC escalation with ticket/SLA tools.";
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_coding_review_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "coding_review";
    result.title = "Coding review multi-agent demo";
    result.task = "Review a calculator patch for correctness, tests, and handoff quality";

    const std::string source =
        "int div(int a, int b) {\n"
        "  // TODO: handle zero\n"
        "  return a / b;\n"
        "}\n";
    const std::string diff =
        "--- a/calc.cpp\n+++ b/calc.cpp\n"
        "@@\n-int div(int a, int b) { return a / b; }\n"
        "+int div(int a, int b) {\n+  // TODO: handle zero\n+  return a / b;\n+}\n";

    ToolRegistry tools;
    register_coding_tools(tools);
    ToolCall lint;
    lint.tool_name = "code_lint_stub";
    lint.arguments = {{"source", source}};
    auto lint_res = tools.execute(lint);
    ToolCall dsum;
    dsum.tool_name = "diff_summary";
    dsum.arguments = {{"diff", diff}};
    auto diff_res = tools.execute(dsum);

    std::vector<Agent> agents;
    agents.push_back(make_echo_agent("Author", "Explains the patch intent"));
    agents.push_back(make_echo_agent("Reviewer", "Finds defects and missing tests"));
    agents.push_back(make_echo_agent("Maintainer", "Decides merge conditions"));

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto run = team.run(result.task + "\nSOURCE:\n" + source + "\nDIFF:\n" + diff);
    if (!run) return run.error();

    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = build_run_trace("demo-coding", "coding_review", run.value(), "hybrid_state");
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"handoffs", run.value().to_json().at("handoffs")},
        {"lint", lint_res ? lint_res.value().to_json() : nlohmann::json{}},
        {"diff_summary", diff_res ? diff_res.value().to_json() : nlohmann::json{}},
    };
    result.success = !result.final_output.empty();
    result.summary_markdown = "Author→Reviewer→Maintainer with lint/diff tools.";
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_research_workflow_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "research_workflow";
    result.title = "Research synthesis workflow";
    const DemoCase* c = find_case(options.case_id.empty() ? "research-01-v1" : options.case_id);
    result.task = c ? c->task : "Synthesize offline notes on handoff protocol tradeoffs";

    ToolRegistry tools;
    tools.add(make_keyword_extract_tool());
    tools.add(make_string_stats_tool());
    const std::string notes =
        "hybrid_state preserves decisions files errors next_steps. "
        "compressed reduces tokens. natural is human readable. "
        "quality metrics measure completeness clarity actionability.";
    ToolCall kw;
    kw.tool_name = "keyword_extract";
    kw.arguments = {{"text", notes}};
    auto kw_res = tools.execute(kw);

    std::vector<Agent> agents;
    agents.push_back(make_echo_agent("Librarian", "Collects sources and notes"));
    agents.push_back(make_echo_agent("Analyst", "Clusters findings and tradeoffs"));
    agents.push_back(make_echo_agent("Editor", "Writes executive summary"));

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::Compressed));
    auto run = team.run(result.task + "\nNOTES:\n" + notes);
    if (!run) return run.error();
    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = build_run_trace("demo-research", "research_workflow", run.value(), "compressed");
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"handoffs", run.value().to_json().at("handoffs")},
        {"keywords", kw_res ? kw_res.value().to_json() : nlohmann::json{}},
    };
    result.success = !result.final_output.empty();
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_doctor_panel_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "doctor_panel";
    result.title = "Offline multi-specialist panel";
    const DemoCase* c = find_case(options.case_id.empty() ? "clinical-01-v1" : options.case_id);
    result.task = c ? c->task : "Structure differentials and next steps for a chest pain vignette offline";

    std::vector<Agent> agents;
    agents.push_back(make_echo_agent("Emergency_MD", "Prioritizes life threats"));
    agents.push_back(make_echo_agent("Cardiologist", "Weighs ACS vs alternatives"));
    agents.push_back(make_echo_agent("Moderator", "Builds consensus ranking JSON"));

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto run = team.run(result.task);
    if (!run) return run.error();
    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = build_run_trace("demo-doctor", "doctor_panel", run.value(), "hybrid_state");
    HandoffQualityEvaluator evaluator;
    nlohmann::json qualities = nlohmann::json::array();
    for (const auto& h : result.handoffs) {
        qualities.push_back(evaluator.evaluate(h).to_json());
    }
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"handoffs", run.value().to_json().at("handoffs")},
        {"qualities", qualities},
    };
    result.success = result.handoffs.size() >= 2;
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

// run_fusion_style_demo lives in demos/fusion/fusion_style_offline.cpp

Result<DemoResult> run_recipe_pipeline_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "recipe_pipeline";
    result.title = "Recipe runner multi-step pipeline";
    result.task = "Run a named recipe across planner, implementer, verifier";

    std::vector<Agent> agents;
    agents.push_back(make_echo_agent("Planner", "Plans work breakdown"));
    agents.push_back(make_echo_agent("Implementer", "Implements changes"));
    agents.push_back(make_echo_agent("Verifier", "Verifies tests and packaging"));

    Recipe recipe;
    recipe.name = "ship_cpp_cli";
    recipe.description = "Plan, implement, verify C++ CLI";
    recipe.protocol = ProtocolMode::HybridState;
    recipe.steps = {
        {"plan", "Planner", "Produce milestones and risks", true},
        {"implement", "Implementer", "Implement CLI and demos", true},
        {"verify", "Verifier", "List verification commands and expected artifacts", true},
    };

    RecipeRunner runner(std::move(agents));
    auto run = runner.run(recipe, result.task);
    if (!run) return run.error();
    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = run.value().trace;
    result.report = run.value().to_json();
    result.success = run.value().success;
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_memory_continuity_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "memory_continuity";
    result.title = "Agent memory continuity across turns";
    result.task = "Ensure agent memory records user/assistant turns across multi-step work";

    Agent agent = make_echo_agent("Chronicler", "Keeps continuity notes");
    auto t1 = agent.run("First turn: outline CLI commands");
    if (!t1) return t1.error();
    auto t2 = agent.run("Second turn: refine demo catalog using prior context");
    if (!t2) return t2.error();
    auto t3 = agent.run("Third turn: summarize memory as handoff");
    if (!t3) return t3.error();

    result.final_output = t3.value();
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"memory", agent.memory().to_json()},
        {"memory_size", agent.memory().size()},
        {"memory_text", agent.memory().to_text(10)},
    };
    result.success = agent.memory().size() >= 6 && !result.final_output.empty();
    result.summary_markdown = "Memory captured 3 user/assistant pairs.";
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_tool_registry_stress_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "tool_registry_stress";
    result.title = "Tool registry multi-call stress (offline)";
    result.task = "Execute many deterministic tool calls and summarize";

    ToolRegistry registry;
    register_demo_toolbox(registry);
    nlohmann::json results = nlohmann::json::array();
    int ok_count = 0;
    const char* exprs[] = {"1 + 1", "2 * 8", "100 - 45", "9 / 3", "7 + 8"};
    for (const char* expr : exprs) {
        ToolCall call;
        call.tool_name = "calculator";
        call.arguments = {{"expression", expr}};
        auto out = registry.execute(call);
        if (out && out.value().success) ++ok_count;
        results.push_back(out ? out.value().to_json() : nlohmann::json{{"success", false}});
    }
    for (int impact = 1; impact <= 5; ++impact) {
        for (int urgency = 1; urgency <= 5; ++urgency) {
            ToolCall call;
            call.tool_name = "priority_score";
            call.arguments = {{"impact", impact}, {"urgency", urgency}};
            auto out = registry.execute(call);
            if (out && out.value().success) ++ok_count;
            results.push_back(out ? out.value().to_json() : nlohmann::json{{"success", false}});
        }
    }
    Agent agent = make_echo_agent("Aggregator", "Aggregates tool stress results");
    auto summary = agent.run(result.task + "\ncount=" + std::to_string(results.size()));
    if (!summary) return summary.error();
    result.final_output = summary.value();
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"ok_count", ok_count},
        {"result_count", results.size()},
        {"results", results},
    };
    result.success = ok_count >= 30 && !result.final_output.empty();
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_multi_case_batch_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "multi_case_batch";
    result.title = "Batch run across offline case corpus sample";
    result.task = "Run a sample of corpus cases through short team handoffs";

    nlohmann::json batch = nlohmann::json::array();
    std::size_t limit = 12;
    if (options.extra.contains("limit") && options.extra["limit"].is_number_unsigned()) {
        limit = options.extra["limit"].get<std::size_t>();
    }
    std::size_t i = 0;
    for (const auto& c : case_corpus()) {
        if (i >= limit) break;
        std::vector<Agent> agents;
        agents.push_back(make_echo_agent("Analyst", "Analyzes the case"));
        agents.push_back(make_echo_agent("Operator", "Produces next actions"));
        Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
        auto run = team.run(c.task);
        if (!run) return run.error();
        batch.push_back({
            {"case_id", c.id},
            {"domain", c.domain},
            {"title", c.title},
            {"task", c.task},
            {"final_output", run.value().final_output},
            {"handoffs", run.value().to_json().at("handoffs")},
            {"success", run.value().success},
        });
        ++i;
    }
    result.final_output = "Processed " + std::to_string(batch.size()) + " cases";
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"batch", batch},
        {"corpus_size", case_corpus_size()},
    };
    result.success = batch.size() >= 3;
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_replay_from_trace_demo(const DemoOptions& options) {
    auto base = run_team_handoff_demo([&] {
        DemoOptions o = options;
        o.write_files = true;
        return o;
    }());
    if (!base) return base;
    DemoResult result = std::move(base.value());
    result.name = "replay_from_trace";
    result.title = "Replay summary from an existing RunTrace";

    // "Replay" offline: re-derive timeline and validate handoffs from trace JSON wire.
    auto wire = result.trace.to_json();
    RunTrace loaded = RunTrace::from_json(wire);
    result.summary_markdown = loaded.to_timeline();
    result.final_output = loaded.final_output;
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"trace", loaded.to_json()},
        {"timeline", loaded.to_timeline()},
        {"step_count", loaded.steps.size()},
        {"handoff_count", loaded.handoffs.size()},
    };
    result.success = !loaded.final_output.empty() && loaded.steps.size() >= 2;
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_quality_gate_pipeline_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "quality_gate_pipeline";
    result.title = "Team run followed by quality gate";
    result.task = "Produce handoffs that pass offline quality thresholds";

    auto team = run_team_handoff_demo(options);
    if (!team) return team;
    result = std::move(team.value());
    result.name = "quality_gate_pipeline";
    result.title = "Team run followed by quality gate";

    HandoffQualityEvaluator evaluator(0.55);
    nlohmann::json gates = nlohmann::json::array();
    bool all_ok = true;
    for (const auto& h : result.handoffs) {
        auto q = evaluator.evaluate(h);
        gates.push_back(q.to_json());
        all_ok = all_ok && q.validation.success;
    }
    result.report["quality_gates"] = gates;
    result.report["final_output"] = result.final_output;
    result.report["task"] = result.task;
    result.success = all_ok && !result.final_output.empty();
    result.summary_markdown = "Quality gates evaluated for each handoff.";
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_incident_response_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "incident_response";
    result.title = "Incident response runbook handoff";
    const DemoCase* c = find_case(options.case_id.empty() ? "ops-01-v1" : options.case_id);
    result.task = c ? c->task : "Coordinate SEV-1 auth outage mitigation and handoff";

    ToolRegistry tools;
    tools.add(make_priority_score_tool());
    tools.add(make_checklist_tool());
    ToolCall prio;
    prio.tool_name = "priority_score";
    prio.arguments = {{"impact", 5}, {"urgency", 5}};
    auto prio_res = tools.execute(prio);
    ToolCall check;
    check.tool_name = "checklist";
    check.arguments = {{"items", {
        {"comms_sent", true},
        {"mitigation_started", true},
        {"customer_update", false},
        {"postmortem_scheduled", false},
    }}};
    auto check_res = tools.execute(check);

    std::vector<Agent> agents;
    agents.push_back(make_echo_agent("Oncall", "Mitigates the incident"));
    agents.push_back(make_echo_agent("Comms", "Drafts customer and internal updates"));
    agents.push_back(make_echo_agent("Scribe", "Records decisions and follow-ups"));
    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto run = team.run(result.task);
    if (!run) return run.error();
    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = build_run_trace("demo-incident", "incident_response", run.value(), "hybrid_state");
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"handoffs", run.value().to_json().at("handoffs")},
        {"priority", prio_res ? prio_res.value().to_json() : nlohmann::json{}},
        {"checklist", check_res ? check_res.value().to_json() : nlohmann::json{}},
    };
    result.success = !result.final_output.empty();
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_product_spec_handoff_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "product_spec_handoff";
    result.title = "Product spec to engineering handoff";
    const DemoCase* c = find_case(options.case_id.empty() ? "product-01-v1" : options.case_id);
    result.task = c ? c->task : "Hand off export API PRD to engineering with acceptance tests";

    std::vector<Agent> agents;
    agents.push_back(make_echo_agent("PM", "Writes goals non-goals and acceptance"));
    agents.push_back(make_echo_agent("Designer", "Clarifies UX edges for async export"));
    agents.push_back(make_echo_agent("TechLead", "Breaks work into implementable milestones"));
    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto run = team.run(result.task);
    if (!run) return run.error();
    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = build_run_trace("demo-product", "product_spec_handoff", run.value(), "hybrid_state");
    result.report = run.value().to_json();
    result.success = result.handoffs.size() >= 2;
    auto artifacts = write_demo_artifacts(options, result);
    if (!artifacts) return artifacts.error();
    return Result<DemoResult>::success(std::move(result));
}

}  // namespace demos
}  // namespace handoffkit
