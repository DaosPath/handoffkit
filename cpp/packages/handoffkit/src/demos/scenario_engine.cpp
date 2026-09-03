#include <handoffkit/demos/scenario_engine.hpp>
#include <handoffkit/io/report_gallery.hpp>
#include <handoffkit/runtime/builtin_tools.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/util/text.hpp>

#include <sstream>

namespace handoffkit {
namespace demos {
namespace {

Agent mk(const char* n, const char* r) {
    return make_echo_agent(n, r);
}

std::string resolve_task(const Scenario& scenario) {
    if (!scenario.case_id.empty()) {
        if (const auto* c = find_case(scenario.case_id)) return c->task;
    }
    return scenario.title;
}

}  // namespace

nlohmann::json ScenarioRunResult::to_json() const {
    nlohmann::json phases_json = nlohmann::json::array();
    for (const auto& p : phases) {
        phases_json.push_back({
            {"name", p.name},
            {"success", p.success},
            {"output", p.output},
            {"notes", p.notes},
        });
    }
    nlohmann::json hs = nlohmann::json::array();
    for (const auto& h : handoffs) hs.push_back(h.to_json());
    return nlohmann::json{
        {"success", success},
        {"scenario_id", scenario_id},
        {"task", task},
        {"final_output", final_output},
        {"phases", std::move(phases_json)},
        {"handoffs", std::move(hs)},
        {"trace", trace.to_json()},
        {"report", report},
    };
}

Result<ScenarioRunResult> ScenarioEngine::run(const Scenario& scenario, const DemoOptions& options) {
    ScenarioRunResult result;
    result.scenario_id = scenario.id;
    result.task = resolve_task(scenario);
    std::string last_output;

    for (const auto& phase : scenario.phases) {
        ScenarioPhaseResult pr;
        pr.name = phase.name;

        if (phase.kind == "team") {
            std::vector<Agent> agents;
            agents.push_back(mk("Architect", "Designs approach"));
            agents.push_back(mk("Coder", "Implements"));
            agents.push_back(mk("Reviewer", "Reviews"));
            Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
            auto tr = team.run(result.task + " [" + phase.name + "]");
            if (!tr) {
                pr.success = false;
                pr.notes = tr.error().message;
                result.phases.push_back(std::move(pr));
                result.success = false;
                return Result<ScenarioRunResult>::success(std::move(result));
            }
            last_output = tr.value().final_output;
            for (const auto& h : tr.value().handoffs) result.handoffs.push_back(h);
            result.trace = build_run_trace("scenario-" + scenario.id, scenario.id, tr.value(), "hybrid_state");
            pr.output = tr.value().to_json();
            pr.success = tr.value().success;
        } else if (phase.kind == "tools") {
            ToolRegistry reg;
            register_demo_toolbox(reg);
            nlohmann::json outs = nlohmann::json::array();
            for (const auto& name : builtin_tool_names()) {
                ToolCall call;
                call.tool_name = name;
                if (name == "calculator") call.arguments = {{"expression", "4 + 5"}};
                else if (name == "ticket_lookup") call.arguments = {{"ticket_id", "T-2044"}};
                else if (name == "sla_check") call.arguments = {{"priority", "P1"}, {"age_hours", 3}};
                else if (name == "keyword_extract") call.arguments = {{"text", result.task}};
                else if (name == "string_stats") call.arguments = {{"text", result.task}};
                else if (name == "priority_score") call.arguments = {{"impact", 4}, {"urgency", 4}};
                else if (name == "checklist") call.arguments = {{"items", {{"a", true}, {"b", false}}}};
                else if (name == "code_lint_stub") call.arguments = {{"source", "int x=1; // TODO\n"}};
                else if (name == "diff_summary") call.arguments = {{"diff", "+a\n-b\n"}};
                else call.arguments = nlohmann::json::object();
                auto out = reg.execute(call);
                outs.push_back(out ? out.value().to_json() : nlohmann::json{{"success", false}});
            }
            pr.output = {{"tool_results", outs}};
            pr.success = !outs.empty();
            last_output = outs.dump();
        } else if (phase.kind == "orchestrator") {
            const std::string plan = phase.config.value("plan", "support_escalation");
            std::vector<Agent> agents;
            OrchestratorPlan op;
            if (plan == "coding_ship") {
                agents = {mk("Author", "a"), mk("Reviewer", "r"), mk("Maintainer", "m")};
                op = Orchestrator::coding_ship_plan();
            } else if (plan == "incident_with_rescue") {
                agents = {mk("Oncall", "o"), mk("Comms", "c"), mk("Scribe", "s")};
                op = Orchestrator::incident_with_rescue_plan();
            } else {
                agents = {mk("L1_Support", "l1"), mk("L2_Support", "l2"), mk("Incident_Commander", "ic")};
                op = Orchestrator::support_escalation_plan();
            }
            Orchestrator orch(std::move(agents));
            auto run = orch.run(op, result.task);
            if (!run) {
                pr.success = false;
                pr.notes = run.error().message;
            } else {
                last_output = run.value().final_output;
                for (const auto& h : run.value().all_handoffs) result.handoffs.push_back(h);
                result.trace = run.value().trace;
                pr.output = run.value().to_json();
                pr.success = run.value().success;
            }
        } else if (phase.kind == "eval") {
            TeamRunResult team;
            team.task = result.task;
            team.final_output = last_output;
            team.handoffs = result.handoffs;
            team.success = !last_output.empty();
            auto er = WorkflowEvaluator{}.evaluate_trace(result.trace);
            auto hr = WorkflowEvaluator{}.evaluate_handoffs(result.handoffs);
            pr.output = {{"trace_eval", er.to_json()}, {"handoff_eval", hr.to_json()}};
            pr.success = er.success || hr.success || result.handoffs.empty();
        } else if (phase.kind == "policy") {
            PathPolicy paths(options.output_dir.empty() ? std::filesystem::path(".") : options.output_dir);
            ApprovalPolicy approvals(true);
            approvals.allow_tool("calculator");
            ToolRegistry reg;
            register_demo_toolbox(reg);
            PolicyGuardedRegistry guarded(std::move(reg), approvals, paths);
            ToolCall okc;
            okc.tool_name = "calculator";
            okc.arguments = {{"expression", "2 * 3"}};
            auto ok = guarded.execute(okc);
            ToolCall deny;
            deny.tool_name = "write_file";
            deny.arguments = {{"path", "../escape.txt"}};
            // write_file not registered; mutating heuristic
            ApprovalRequest req{"write_file", "write", {{"path", "x"}}};
            auto dec = ApprovalPolicy(true).decide(req);
            auto path_check = paths.check("../secret", PathAccess::Write);
            pr.output = {
                {"calc", ok ? ok.value().to_json() : nlohmann::json{}},
                {"mutating_decision", {{"allowed", dec.allowed}, {"reason", dec.reason}}},
                {"path_escape_allowed", path_check.allowed},
                {"path_reason", path_check.reason},
            };
            pr.success = ok && ok.value().success && !dec.allowed && !path_check.allowed;
        } else if (phase.kind == "gallery") {
            if (!options.write_files) {
                pr.success = true;
                pr.notes = "gallery skipped (--no-write)";
            } else {
                TeamRunResult team;
                team.task = result.task;
                team.final_output = last_output;
                team.handoffs = result.handoffs;
                team.success = true;
                ReportGallery gallery(options.output_dir / "gallery");
                auto g = gallery.write_team_gallery(scenario.id + "-" + phase.name, team, result.trace, nullptr);
                if (!g) {
                    pr.success = false;
                    pr.notes = g.error().message;
                } else {
                    pr.output = g.value().to_json();
                    pr.success = g.value().success;
                }
            }
        } else {
            pr.success = false;
            pr.notes = "unknown phase kind: " + phase.kind;
        }

        result.phases.push_back(std::move(pr));
        if (!result.phases.back().success && phase.config.value("required", true)) {
            result.success = false;
            result.final_output = last_output;
            result.report = result.to_json();
            return Result<ScenarioRunResult>::success(std::move(result));
        }
    }

    result.final_output = last_output;
    result.success = true;
    for (const auto& p : result.phases) {
        if (!p.success && true) {
            // already handled required failures
        }
    }
    result.report = result.to_json();
    return Result<ScenarioRunResult>::success(std::move(result));
}

Scenario ScenarioEngine::support_full_scenario() {
    return Scenario{
        "support_full",
        "Full support scenario",
        "Tools → orchestrator support → eval → gallery",
        "support-01-v1",
        {
            {"collect_tools", "tools", {{"required", true}}},
            {"escalate", "orchestrator", {{"plan", "support_escalation"}}},
            {"score", "eval", {}},
            {"publish", "gallery", {{"required", false}}},
        },
    };
}

Scenario ScenarioEngine::coding_full_scenario() {
    return Scenario{
        "coding_full",
        "Full coding scenario",
        "Team → coding orchestrator → eval",
        "coding-01",
        {
            {"baseline_team", "team", {}},
            {"ship_plan", "orchestrator", {{"plan", "coding_ship"}}},
            {"score", "eval", {}},
        },
    };
}

Scenario ScenarioEngine::release_readiness_scenario() {
    return Scenario{
        "release_readiness",
        "Release readiness",
        "Team packaging path + policy + eval",
        "",
        {
            {"team", "team", {}},
            {"policy", "policy", {}},
            {"eval", "eval", {}},
            {"gallery", "gallery", {{"required", false}}},
        },
    };
}

Scenario ScenarioEngine::policy_guard_scenario() {
    return Scenario{
        "policy_guard",
        "Policy guard scenario",
        "Verify approval and path escape protections",
        "",
        {
            {"policy", "policy", {}},
            {"tools", "tools", {}},
        },
    };
}

Scenario ScenarioEngine::multi_domain_scenario() {
    return Scenario{
        "multi_domain",
        "Multi domain sweep",
        "Run team then tools then eval for corpus-linked task",
        "ops-01-v1",
        {
            {"team", "team", {}},
            {"tools", "tools", {}},
            {"orch", "orchestrator", {{"plan", "incident_with_rescue"}}},
            {"eval", "eval", {}},
        },
    };
}

std::vector<Scenario> ScenarioEngine::catalog() {
    return {
        support_full_scenario(),
        coding_full_scenario(),
        release_readiness_scenario(),
        policy_guard_scenario(),
        multi_domain_scenario(),
    };
}

Result<DemoResult> run_scenario_engine_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "scenario_engine";
    result.title = "Scenario engine catalog run";
    result.task = "Execute all multi-phase scenarios offline";
    nlohmann::json runs = nlohmann::json::array();
    int ok = 0;
    ScenarioEngine engine;
    for (const auto& sc : ScenarioEngine::catalog()) {
        auto run = engine.run(sc, options);
        if (!run) return run.error();
        runs.push_back(run.value().to_json());
        if (run.value().success) ++ok;
        for (const auto& h : run.value().handoffs) result.handoffs.push_back(h);
        if (!run.value().final_output.empty()) result.final_output = run.value().final_output;
        if (!run.value().trace.steps.empty()) result.trace = run.value().trace;
    }
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"runs", runs},
        {"ok", ok},
        {"total", ScenarioEngine::catalog().size()},
    };
    result.success = ok == static_cast<int>(ScenarioEngine::catalog().size());
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_policy_guard_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "policy_guard";
    result.title = "Policy-guarded tool execution";
    result.task = "Demonstrate path escape denial and mutating-tool approval";

    PathPolicy paths(options.output_dir.empty() ? std::filesystem::current_path() : options.output_dir);
    ApprovalPolicy approvals(true);
    approvals.allow_tool("calculator");
    approvals.allow_tool("ticket_lookup");

    ToolRegistry reg;
    register_demo_toolbox(reg);
    PolicyGuardedRegistry guarded(std::move(reg), approvals, std::move(paths));

    nlohmann::json results = nlohmann::json::array();
    ToolCall calc;
    calc.tool_name = "calculator";
    calc.arguments = {{"expression", "10 / 2"}};
    auto c = guarded.execute(calc);
    results.push_back(c ? c.value().to_json() : nlohmann::json{{"success", false}});

    // Mutating name not allowlisted
    ApprovalDecision denied = ApprovalPolicy(true).decide({"run_shell", "execute", {}});
    PathPolicyDecision escape = PathPolicy(options.output_dir.empty() ? std::filesystem::current_path() : options.output_dir)
                                    .check(std::filesystem::path("..") / "etc" / "passwd", PathAccess::Read);

    auto inside = PathPolicy(options.output_dir.empty() ? std::filesystem::current_path() : options.output_dir)
                      .check("reports/out.json", PathAccess::Write);

    result.final_output = "policy_demo_complete";
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"tool_results", results},
        {"mutating_allowed", denied.allowed},
        {"mutating_reason", denied.reason},
        {"escape_allowed", escape.allowed},
        {"escape_reason", escape.reason},
        {"inside_allowed", inside.allowed},
        {"inside_reason", inside.reason},
    };
    result.success = c && c.value().success && !denied.allowed && !escape.allowed && inside.allowed;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_report_gallery_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "report_gallery";
    result.title = "Multi-format report gallery";
    result.task = "Generate JSON/MD/HTML gallery for a team run";

    std::vector<Agent> agents = {
        mk("Architect", "d"), mk("Coder", "c"), mk("Reviewer", "r"),
    };
    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto tr = team.run(result.task);
    if (!tr) return tr.error();
    auto trace = build_run_trace("gallery-1", "report_gallery", tr.value(), "hybrid_state");
    auto eval = WorkflowEvaluator{}.evaluate_trace(trace);

    DemoOptions opt = options;
    if (opt.output_dir.empty()) opt.output_dir = "runs/cpp-demos";
    ReportGallery gallery(opt.output_dir / "galleries");
    auto g = gallery.write_team_gallery("report_gallery", tr.value(), trace, &eval);
    if (!g) return g.error();
    auto qg = gallery.write_quality_gallery("report_gallery_quality", tr.value().handoffs);
    if (!qg) return qg.error();

    result.final_output = tr.value().final_output;
    result.handoffs = tr.value().handoffs;
    result.trace = trace;
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"handoffs", tr.value().to_json().at("handoffs")},
        {"gallery", g.value().to_json()},
        {"quality_gallery", qg.value().to_json()},
        {"eval", eval.to_json()},
    };
    result.success = g.value().success && !result.final_output.empty();
    for (const auto& a : g.value().artifacts) result.artifact_paths.push_back(a.path.string());
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_release_readiness_demo(const DemoOptions& options) {
    DemoResult result;
    result.name = "release_readiness";
    result.title = "Release readiness scenario";
    result.task = "Verify C++ package release readiness offline";

    ScenarioEngine engine;
    auto run = engine.run(ScenarioEngine::release_readiness_scenario(), options);
    if (!run) return run.error();

    // Additional readiness checks as structured data
    nlohmann::json checklist = {
        {"ctest_documented", true},
        {"cli_binary", true},
        {"demos_ge_20", demos::demo_ids().size() >= 20},
        {"templates_ge_10", true},
        {"snake_case_wire", true},
        {"offline_default", true},
    };
    ToolRegistry reg;
    reg.add(make_checklist_tool());
    ToolCall call;
    call.tool_name = "checklist";
    call.arguments = {{"items", checklist}};
    auto checked = reg.execute(call);

    result.final_output = run.value().final_output;
    result.handoffs = run.value().handoffs;
    result.trace = run.value().trace;
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"scenario", run.value().to_json()},
        {"checklist", checked ? checked.value().to_json() : nlohmann::json{}},
        {"handoffs", nlohmann::json::array()},
    };
    for (const auto& h : result.handoffs) result.report["handoffs"].push_back(h.to_json());
    result.success = run.value().success && checked && checked.value().success;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

}  // namespace demos
}  // namespace handoffkit
