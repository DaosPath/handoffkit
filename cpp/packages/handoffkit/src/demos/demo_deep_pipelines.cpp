#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/demos/cases.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/runtime/builtin_tools.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/orchestrator.hpp>
#include <handoffkit/runtime/replay.hpp>
#include <handoffkit/runtime/structured.hpp>
#include <handoffkit/util/text.hpp>
#include <handoffkit/workflows/recipe.hpp>
#include <handoffkit/workflows/templates.hpp>

#include <sstream>

namespace handoffkit {
namespace demos {
namespace {

Agent A(const char* name, const char* role) {
    return make_echo_agent(name, role);
}

std::vector<Agent> support_roster() {
    return {
        A("L1_Support", "Triages tickets"),
        A("L2_Support", "Deep technical analysis"),
        A("Incident_Commander", "Owns escalation"),
    };
}

std::vector<Agent> coding_roster() {
    return {
        A("Author", "Explains patches"),
        A("Reviewer", "Finds defects"),
        A("Maintainer", "Merge decisions"),
    };
}

std::vector<Agent> research_roster() {
    return {
        A("Librarian", "Collects notes"),
        A("Analyst", "Clusters findings"),
        A("Editor", "Writes summaries"),
    };
}

std::vector<Agent> incident_roster() {
    return {
        A("Oncall", "Mitigates incidents"),
        A("Comms", "Drafts updates"),
        A("Scribe", "Records decisions"),
    };
}

std::vector<Agent> product_roster() {
    return {
        A("PM", "Product requirements"),
        A("Designer", "UX edges"),
        A("TechLead", "Engineering plan"),
    };
}

std::vector<Agent> release_roster() {
    return {
        A("Planner", "Plans release"),
        A("Releaser", "Executes release steps"),
        A("Verifier", "Verifies quality gates"),
        A("Architect", "Architecture"),
        A("Coder", "Implementation"),
        A("Reviewer", "Review"),
        A("Analyst", "Analysis"),
        A("Maintainer", "Ownership"),
    };
}

DemoResult base(const char* name, const char* title, std::string task) {
    DemoResult r;
    r.name = name;
    r.title = title;
    r.task = std::move(task);
    return r;
}

}  // namespace

// Additional deep demos registered from demo_catalog via these free functions
// declared in demo_types if needed — also callable from CLI template runner.

Result<DemoResult> run_orchestrator_support_demo(const DemoOptions& options) {
    auto result = base("orchestrator_support", "Orchestrator support escalation",
                       find_case("support-01-v1") ? find_case("support-01-v1")->task
                                                  : "Escalate billing duplicate charge offline");
    Orchestrator orch(support_roster());
    auto run = orch.run(Orchestrator::support_escalation_plan(), result.task);
    if (!run) return run.error();
    result.final_output = run.value().final_output;
    result.handoffs = run.value().all_handoffs;
    result.trace = run.value().trace;
    result.report = run.value().to_json();
    WorkflowEvaluator eval;
    // synthesize team view
    TeamRunResult team;
    team.task = result.task;
    team.final_output = result.final_output;
    team.handoffs = result.handoffs;
    team.success = run.value().success;
    for (const auto& st : run.value().stages) {
        for (const auto& ao : st.team_result.agent_outputs) team.agent_outputs.push_back(ao);
    }
    result.report["workflow_eval"] = eval.evaluate_combined(team, result.trace).to_json();
    result.success = run.value().success && !result.final_output.empty();
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_orchestrator_coding_demo(const DemoOptions& options) {
    auto result = base("orchestrator_coding", "Orchestrator coding ship",
                       "Review and ship calculator divide-by-zero fix offline");
    Orchestrator orch(coding_roster());
    auto run = orch.run(Orchestrator::coding_ship_plan(), result.task);
    if (!run) return run.error();
    result.final_output = run.value().final_output;
    result.handoffs = run.value().all_handoffs;
    result.trace = run.value().trace;
    result.report = run.value().to_json();

    ToolRegistry tools;
    register_coding_tools(tools);
    ToolCall lint;
    lint.tool_name = "code_lint_stub";
    lint.arguments = {{"source", "int div(int a,int b){ /* TODO */ return a/b; }"}};
    auto lint_res = tools.execute(lint);
    result.report["lint"] = lint_res ? lint_res.value().to_json() : nlohmann::json{};

    // structured verdict parse attempt on maintainer output
    auto parsed = parse_agent_structured(
        "{ \"verdict\": \"request_changes\", \"blocking_issues\": [\"divide by zero\"], \"nits\": [] }",
        review_verdict_schema(),
        true
    );
    result.report["structured_verdict"] = parsed.to_json();
    result.success = run.value().success && parsed.success;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_template_gallery_demo(const DemoOptions& options) {
    auto result = base("template_gallery", "Workflow template gallery",
                       "Execute every workflow template once offline and evaluate");
    nlohmann::json runs = nlohmann::json::array();
    int ok = 0;
    for (const auto& tpl : templates::all_templates()) {
        nlohmann::json entry{{"id", tpl.id}, {"title", tpl.title}};
        if (tpl.use_orchestrator) {
            std::vector<Agent> agents = release_roster();
            // ensure required names exist; orchestrator plans use specific names
            if (tpl.id == "support_escalation") agents = support_roster();
            else if (tpl.id == "coding_review") agents = coding_roster();
            else if (tpl.id == "research_digest") agents = research_roster();
            else if (tpl.id == "incident_response") agents = incident_roster();
            else if (tpl.id == "product_spec") agents = product_roster();
            Orchestrator orch(std::move(agents));
            auto run = orch.run(tpl.orchestrator, result.task + " [" + tpl.id + "]");
            entry["success"] = run && run.value().success;
            entry["final_output_chars"] = run ? run.value().final_output.size() : 0;
            entry["handoffs"] = run ? run.value().all_handoffs.size() : 0;
            if (run && run.value().success) ++ok;
        } else {
            // Create agents for every recipe step name (deterministic Echo).
            std::vector<Agent> agents;
            for (const auto& st : tpl.recipe.steps) {
                bool exists = false;
                for (const auto& a : agents) {
                    if (a.name() == st.agent_name) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    agents.push_back(make_echo_agent(st.agent_name, st.agent_name + " role"));
                }
            }
            RecipeRunner runner(std::move(agents));
            auto run = runner.run(tpl.recipe, result.task + " [" + tpl.id + "]");
            entry["success"] = run && run.value().success;
            if (run && !run.value().success) entry["error"] = "recipe_failed";
            if (!run) entry["error"] = run.error().message;
            entry["final_output_chars"] = run ? run.value().final_output.size() : 0;
            entry["handoffs"] = run ? run.value().handoffs.size() : 0;
            if (run && run.value().success) ++ok;
        }
        runs.push_back(std::move(entry));
    }
    result.final_output = "templates_ok=" + std::to_string(ok) + "/" + std::to_string(runs.size());
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"runs", runs},
        {"template_count", templates::all_templates().size()},
    };
    result.success = ok >= static_cast<int>(templates::all_templates().size()) / 2;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_eval_harness_demo(const DemoOptions& options) {
    auto result = base("eval_harness", "Workflow evaluation harness",
                       "Run team demos and score with WorkflowEvaluator");
    std::vector<Agent> agents;
    agents.push_back(A("Architect", "Designs"));
    agents.push_back(A("Coder", "Implements"));
    agents.push_back(A("Reviewer", "Reviews"));
    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto run = team.run(result.task);
    if (!run) return run.error();
    auto trace = build_run_trace("eval-harness", "eval_harness", run.value(), "hybrid_state");
    WorkflowEvaluator eval(0.55);
    auto report = eval.evaluate_combined(run.value(), trace);
    result.final_output = report.to_markdown();
    result.handoffs = run.value().handoffs;
    result.trace = trace;
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"handoffs", run.value().to_json().at("handoffs")},
        {"workflow_eval", report.to_json()},
        {"team", run.value().to_json()},
    };
    result.success = report.success;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_structured_outputs_demo(const DemoOptions& options) {
    auto result = base("structured_outputs", "Structured output parse/repair",
                       "Parse rankings and action plans from agent-like text");
    const std::string dirty =
        "Here is the plan:\n"
        "```json\n"
        "{ 'goal': 'Ship CLI', 'steps': ['write demos', 'run ctest'], 'owners': ['Coder'], }\n"
        "```\n";
    auto plan = parse_agent_structured(dirty, action_plan_schema(), true);
    const std::string rankings_text =
        "{\"rankings\": [{\"name\": \"ACS\", \"score\": 0.8}, {\"name\": \"GERD\", \"score\": 0.4}], "
        "\"notes\": \"offline panel\"}";
    auto rankings = parse_agent_structured(rankings_text, rankings_schema(), false);
    const std::string incident =
        "{\"severity\": \"SEV-1\", \"status\": \"mitigating\", \"summary\": \"Auth partial outage\", "
        "\"next_update_minutes\": 15}";
    auto inc = parse_agent_structured(incident, incident_update_schema(), false);

    Agent agent = A("Structurer", "Emits structured JSON");
    auto out = agent.run(result.task + structured_prompt_suffix(action_plan_schema()));
    if (!out) return out.error();
    result.final_output = out.value();
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"action_plan", plan.to_json()},
        {"rankings", rankings.to_json()},
        {"incident_update", inc.to_json()},
    };
    result.success = plan.success && rankings.success && inc.success;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_replay_quality_demo(const DemoOptions& options) {
    auto seed = run_team_handoff_demo([&] {
        DemoOptions o = options;
        o.write_files = true;
        return o;
    }());
    if (!seed) return seed;
    DemoResult result = std::move(seed.value());
    result.name = "replay_quality";
    result.title = "Replay + quality rescoring";

    std::vector<Agent> agents;
    agents.push_back(A("Architect", "Designs"));
    agents.push_back(A("Coder", "Implements"));
    agents.push_back(A("Reviewer", "Reviews"));
    ReplayRunner runner(std::move(agents));
    ReplayOptions ropts;
    ropts.reexecute_agents = true;
    ropts.revalidate_handoffs = true;
    ropts.rescore_quality = true;
    auto replay = runner.replay(result.trace, ropts);
    if (!replay) return replay.error();
    result.final_output = replay.value().to_markdown();
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"replay", replay.value().to_json()},
        {"handoffs", nlohmann::json::array()},
    };
    for (const auto& h : result.handoffs) result.report["handoffs"].push_back(h.to_json());
    result.success = replay.value().success;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_corpus_domain_sweep_demo(const DemoOptions& options) {
    auto result = base("corpus_domain_sweep", "Corpus domain sweep",
                       "Run one case from each domain through a short team");
    nlohmann::json domains = nlohmann::json::array();
    const char* domain_list[] = {"support", "coding", "research", "clinical", "product", "ops"};
    for (const char* domain : domain_list) {
        auto cases = cases_for_domain(domain);
        if (cases.empty()) continue;
        const DemoCase* c = cases.front();
        std::vector<Agent> agents;
        agents.push_back(A("Analyst", "Analyzes case"));
        agents.push_back(A("Operator", "Produces actions"));
        Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
        auto run = team.run(c->task);
        if (!run) return run.error();
        WorkflowEvaluator eval;
        auto er = eval.evaluate_team(run.value());
        domains.push_back({
            {"domain", domain},
            {"case_id", c->id},
            {"title", c->title},
            {"task", c->task},
            {"final_output", run.value().final_output},
            {"handoffs", run.value().to_json().at("handoffs")},
            {"eval", er.to_json()},
            {"success", run.value().success && er.success},
        });
    }
    result.final_output = "domains_processed=" + std::to_string(domains.size());
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"domains", domains},
        {"corpus_size", case_corpus_size()},
    };
    result.success = domains.size() >= 6;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_text_metrics_demo(const DemoOptions& options) {
    auto result = base("text_metrics", "Text metrics utilities demo",
                       "Compute term frequencies, jaccard, and actionability on handoff text");
    auto team = run_team_handoff_demo(DemoOptions{options.output_dir, {}, false});
    if (!team) return team;
    nlohmann::json metrics = nlohmann::json::array();
    for (const auto& h : team.value().handoffs) {
        const auto md = h.to_markdown();
        auto top = text::top_terms(md, 8);
        nlohmann::json terms = nlohmann::json::array();
        for (const auto& t : top) terms.push_back({{"term", t.first}, {"count", t.second}});
        int actionable = 0;
        for (const auto& s : h.next_steps) if (text::looks_like_action(s)) ++actionable;
        metrics.push_back({
            {"from_agent", h.from_agent},
            {"to_agent", h.to_agent},
            {"word_count", text::word_count(md)},
            {"top_terms", terms},
            {"actionable_next_steps", actionable},
            {"jaccard_vs_task", text::jaccard_words(h.summary, team.value().task)},
        });
    }
    result.final_output = metrics.dump(2);
    result.handoffs = team.value().handoffs;
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"metrics", metrics},
        {"handoffs", team.value().to_json().at("handoffs")},
    };
    result.success = !metrics.empty();
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

Result<DemoResult> run_multi_orchestrator_compare_demo(const DemoOptions& options) {
    auto result = base("multi_orchestrator_compare", "Compare orchestrator plans",
                       "Run multiple orchestrator plans and compare eval scores");
    struct Item {
        const char* label;
        std::vector<Agent> agents;
        OrchestratorPlan plan;
    };
    // Can't easily store agents in array with moves - run sequentially
    nlohmann::json comparisons = nlohmann::json::array();
    WorkflowEvaluator eval;

    {
        Orchestrator orch(support_roster());
        auto run = orch.run(Orchestrator::support_escalation_plan(), result.task + " [support]");
        if (!run) return run.error();
        TeamRunResult team;
        team.task = result.task;
        team.final_output = run.value().final_output;
        team.handoffs = run.value().all_handoffs;
        team.success = run.value().success;
        auto er = eval.evaluate_team(team);
        comparisons.push_back({{"plan", "support_escalation"}, {"eval", er.to_json()}, {"success", run.value().success}});
    }
    {
        Orchestrator orch(coding_roster());
        auto run = orch.run(Orchestrator::coding_ship_plan(), result.task + " [coding]");
        if (!run) return run.error();
        TeamRunResult team;
        team.task = result.task;
        team.final_output = run.value().final_output;
        team.handoffs = run.value().all_handoffs;
        team.success = run.value().success;
        auto er = eval.evaluate_team(team);
        comparisons.push_back({{"plan", "coding_ship"}, {"eval", er.to_json()}, {"success", run.value().success}});
    }
    {
        Orchestrator orch(incident_roster());
        auto run = orch.run(Orchestrator::incident_with_rescue_plan(), result.task + " [incident]");
        if (!run) return run.error();
        TeamRunResult team;
        team.task = result.task;
        team.final_output = run.value().final_output;
        team.handoffs = run.value().all_handoffs;
        team.success = run.value().success;
        auto er = eval.evaluate_team(team);
        comparisons.push_back({{"plan", "incident_with_rescue"}, {"eval", er.to_json()}, {"success", run.value().success}});
    }

    result.final_output = comparisons.dump(2);
    result.report = {
        {"task", result.task},
        {"final_output", result.final_output},
        {"comparisons", comparisons},
    };
    result.success = comparisons.size() == 3;
    auto art = write_demo_artifacts(options, result);
    if (!art) return art.error();
    return Result<DemoResult>::success(std::move(result));
}

}  // namespace demos
}  // namespace handoffkit
