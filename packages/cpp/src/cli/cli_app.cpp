#include <handoffkit/cli/cli_app.hpp>
#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/demos/fusion/scenarios.hpp>
#include <handoffkit/demos/fusion/audit_loc.hpp>
#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/bench.hpp>
#include <handoffkit/demos/fusion/draco.hpp>
#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/roles.hpp>
#include <handoffkit/demos/fusion/scenarios_deep.hpp>
#include <handoffkit/demos/fusion/war_room.hpp>
#include <handoffkit/core/quality.hpp>
#include <handoffkit/core/validation.hpp>
#include <handoffkit/demos/cases.hpp>
#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/io/reports.hpp>
#include <handoffkit/runtime/builtin_tools.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/providers.hpp>
#include <handoffkit/runtime/orchestrator.hpp>
#include <handoffkit/runtime/replay.hpp>
#include <handoffkit/runtime/structured.hpp>
#include <handoffkit/runtime/diff_score.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/explore/explorer.hpp>
#include <handoffkit/explore/tools.hpp>
#include <handoffkit/version.hpp>
#include <handoffkit/workflows/templates.hpp>
#include <handoffkit/train/dataset.hpp>
#include <handoffkit/train/distill.hpp>
#include <handoffkit/train/runner.hpp>
#include <handoffkit/runtime/protocol.hpp>

#include <algorithm>
#include <filesystem>
#include <iomanip>
#include <limits>
#include <stdexcept>
#include <fstream>
#include <iterator>
#include <sstream>

namespace handoffkit {
namespace cli {
namespace {

std::string require_arg(const std::vector<std::string>& args, std::size_t idx, const char* name) {
    if (idx >= args.size()) {
        return {};
    }
    return args[idx];
}

CliResult ok(std::string out) {
    return CliResult{0, std::move(out), {}};
}

CliResult fail(int code, std::string err) {
    return CliResult{code, {}, std::move(err)};
}

std::filesystem::path default_out_dir(const std::vector<std::string>& args) {
    for (std::size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == "--out") {
            return args[i + 1];
        }
    }
    return "runs/cpp-cli";
}

std::string optional_flag_value(const std::vector<std::string>& args, const std::string& flag) {
    for (std::size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == flag) {
            return args[i + 1];
        }
    }
    return {};
}

/// Prefer --prompt; else load UTF-8 body from --prompt-file (avoids Windows argv mangling).
std::string optional_prompt(const std::vector<std::string>& args) {
    std::string prompt = optional_flag_value(args, "--prompt");
    if (!prompt.empty()) return prompt;
    const std::string path = optional_flag_value(args, "--prompt-file");
    if (path.empty()) return {};
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

bool has_flag(const std::vector<std::string>& args, const std::string& flag) {
    for (const auto& a : args) {
        if (a == flag) return true;
    }
    return false;
}

/// Process-backend argv from CLI:
/// 1) tokens after a bare `--` terminator (preferred when args look like flags)
/// 2) else each `--extra TOKEN` (repeatable; TOKEN may start with `-`)
std::vector<std::string> collect_train_extra_args(const std::vector<std::string>& args) {
    for (std::size_t i = 0; i < args.size(); ++i) {
        if (args[i] == "--") {
            std::vector<std::string> rest;
            for (std::size_t j = i + 1; j < args.size(); ++j) rest.push_back(args[j]);
            return rest;
        }
    }
    std::vector<std::string> out;
    for (std::size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == "--extra") {
            out.push_back(args[i + 1]);
            ++i;
        }
    }
    return out;
}

/// CLI flags for `train run`, skipping `--extra TOKEN` pairs and everything after bare `--`
/// so process argv like `--extra --epochs --extra 1` does not shadow `--epochs N`.
std::string train_run_flag(const std::vector<std::string>& args, const std::string& flag) {
    for (std::size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == "--") break;
        if (args[i] == "--extra") {
            ++i;
            continue;
        }
        if (args[i] == flag) return args[i + 1];
    }
    return {};
}

CliResult cmd_help() {
    return ok(help_text());
}

CliResult cmd_version() {
    return ok(version_text());
}

CliResult cmd_list_demos() {
    return ok(demos::list_demos_text());
}

CliResult cmd_list_cases(const std::vector<std::string>& args) {
    const std::string domain = optional_flag_value(args, "--domain");
    std::ostringstream ss;
    ss << "case_corpus_size=" << demos::case_corpus_size() << "\n";
    std::size_t shown = 0;
    for (const auto& c : demos::case_corpus()) {
        if (!domain.empty() && c.domain != domain) continue;
        ss << c.id << "\t" << c.domain << "\t" << c.title << "\n";
        if (++shown >= 40) {
            ss << "... (" << demos::case_corpus_size() << " total; showing first matches)\n";
            break;
        }
    }
    return ok(ss.str());
}

CliResult cmd_demo(const std::vector<std::string>& args) {
    if (args.size() < 2) {
        return fail(2, "usage: demo <id> [--out DIR] [--case ID] [--no-write]\n" + demos::list_demos_text());
    }
    demos::DemoOptions opt;
    opt.output_dir = default_out_dir(args);
    opt.case_id = optional_flag_value(args, "--case");
    opt.write_files = !has_flag(args, "--no-write");
    auto result = demos::run_demo_by_id(args[1], opt);
    if (!result) {
        return fail(1, result.error().message + "\n");
    }
    std::ostringstream ss;
    ss << result.value().to_markdown() << "\n";
    ss << "JSON keys: task / final_output / handoffs present in report wire\n";
    const auto wire = result.value().to_json();
    ss << "wire.task=" << wire.value("task", "") << "\n";
    ss << "wire.final_output_chars=" << wire.value("final_output", std::string{}).size() << "\n";
    ss << "wire.handoffs=" << wire.at("handoffs").size() << "\n";
    if (!result.value().artifact_paths.empty()) {
        ss << "artifacts:\n";
        for (const auto& p : result.value().artifact_paths) {
            ss << "  - " << p << "\n";
        }
    }
    if (!result.value().success) {
        return CliResult{1, ss.str(), "demo reported success=false\n"};
    }
    return ok(ss.str());
}

CliResult cmd_team(const std::vector<std::string>& args) {
    demos::DemoOptions opt;
    opt.output_dir = default_out_dir(args);
    opt.write_files = !has_flag(args, "--no-write");
    if (args.size() >= 2 && args[1].rfind("-", 0) != 0) {
        opt.case_id = args[1];
    }
    auto result = demos::run_team_handoff_demo(opt);
    if (!result) return fail(1, result.error().message + "\n");
    std::ostringstream ss;
    ss << "final_output:\n" << result.value().final_output << "\n\n";
    ss << "handoffs=" << result.value().handoffs.size() << "\n";
    for (const auto& h : result.value().handoffs) {
        ss << h.from_agent << " -> " << h.to_agent << "\n";
    }
    auto wire = result.value().to_json();
    ss << "task=" << wire.value("task", "") << "\n";
    return result.value().success ? ok(ss.str()) : fail(1, ss.str());
}

CliResult cmd_validate(const std::vector<std::string>& args) {
    // Validate either a JSON file or a built-in good/bad sample.
    HandoffStateValidator validator;
    if (args.size() >= 2 && args[1] != "--sample-bad" && args[1] != "--sample-good") {
        auto loaded = load_report_json(args[1]);
        if (!loaded) return fail(1, loaded.error().message + "\n");
        // Accept either handoff state or report containing handoffs[0]
        nlohmann::json j = loaded.value();
        HandoffState state;
        if (j.contains("task") && j.contains("from_agent")) {
            state = HandoffState::from_json(j);
        } else if (j.contains("handoffs") && j["handoffs"].is_array() && !j["handoffs"].empty()) {
            state = HandoffState::from_json(j["handoffs"][0]);
        } else {
            return fail(1, "JSON is not a handoff state or report with handoffs\n");
        }
        auto report = validator.validate(state);
        return report.success ? ok(report.to_markdown() + "\n")
                              : CliResult{1, report.to_markdown() + "\n", "validation failed\n"};
    }
    HandoffState state;
    if (has_flag(args, "--sample-bad") || (args.size() >= 2 && args[1] == "--sample-bad")) {
        state.task = "";
        state.from_agent = "";
        state.to_agent = "X";
    } else {
        state.task = "Validate sample handoff";
        state.from_agent = "A";
        state.to_agent = "B";
        state.summary = "Sample strong enough summary with multiple words for clarity.";
        state.decisions = {"Use offline validation"};
        state.next_steps = {"Implement checks", "Run tests"};
    }
    auto report = validator.validate(state);
    return report.success ? ok(report.to_markdown() + "\n")
                          : CliResult{1, report.to_markdown() + "\n", "validation failed\n"};
}

CliResult cmd_quality(const std::vector<std::string>& args) {
    HandoffState state;
    state.task = "Score handoff quality offline";
    state.from_agent = "Architect";
    state.to_agent = "Coder";
    state.summary = "Complete design for CLI commands, demos, and packaging with clear acceptance checks.";
    state.decisions = {"Keep demos offline", "Prefer snake_case wire reports"};
    state.important_files = {"packages/cpp/src/cli/cli_app.cpp"};
    state.errors = {"None observed in Echo path"};
    state.next_steps = {"Run ctest", "Write reports", "Review CLI help"};
    state.context_refs = {"packages/cpp/README.md"};
    if (args.size() >= 2 && args[1].rfind("--", 0) != 0) {
        auto loaded = load_report_json(args[1]);
        if (!loaded) return fail(1, loaded.error().message + "\n");
        if (loaded.value().contains("task")) {
            state = HandoffState::from_json(loaded.value());
        }
    }
    auto report = HandoffQualityEvaluator{}.evaluate(state);
    return ok(report.to_markdown() + "\n" + report.to_json().dump(2) + "\n");
}

CliResult cmd_tools(const std::vector<std::string>& args) {
    ToolRegistry registry;
    register_demo_toolbox(registry);
    if (args.size() >= 2 && args[1] == "list") {
        std::ostringstream ss;
        for (const auto& name : builtin_tool_names()) {
            ss << name << "\n";
        }
        return ok(ss.str());
    }
    auto demo = demos::run_tools_demo(demos::DemoOptions{
        default_out_dir(args),
        {},
        !has_flag(args, "--no-write"),
        ProtocolMode::HybridState,
        {},
    });
    if (!demo) return fail(1, demo.error().message + "\n");
    return ok(demo.value().to_markdown() + "\n" + demo.value().report.dump(2) + "\n");
}

CliResult cmd_report(const std::vector<std::string>& args) {
    if (args.size() < 2) {
        return fail(2, "usage: report <path.json>\n");
    }
    auto loaded = load_report_json(args[1]);
    if (!loaded) return fail(1, loaded.error().message + "\n");
    std::ostringstream ss;
    ss << loaded.value().dump(2) << "\n";
    for (const char* key : {"task", "final_output", "handoffs", "run_id", "steps"}) {
        if (loaded.value().contains(key)) {
            ss << "has_" << key << "=true\n";
        }
    }
    return ok(ss.str());
}

CliResult cmd_doctor() {
    std::ostringstream ss;
    ss << "handoffkit C++ doctor\n";
    ss << "version=" << version() << "\n";
    ss << "demos=" << demos::demo_ids().size() << "\n";
    ss << "cases=" << demos::case_corpus_size() << "\n";
    ss << "tools=" << builtin_tool_names().size() << "\n";
    ss << "templates=" << templates::template_ids().size() << "\n";
    ss << "orchestrator_plans=" << Orchestrator::catalog().size() << "\n";
    ss << "providers=" << list_provider_names().size() << "\n";
#if defined(HANDOFFKIT_WITH_HTTP)
    ss << "http_client=on\n";
#else
    ss << "http_client=off (rebuild -DHANDOFFKIT_WITH_HTTP=ON for live LLMs)\n";
#endif
    // quick self-check
    auto demo = demos::run_team_handoff_demo(demos::DemoOptions{"", {}, false});
    ss << "self_check_team=" << (demo && demo.value().success ? "ok" : "fail") << "\n";
    auto echo = make_provider("echo");
    ss << "self_check_echo=" << (echo ? "ok" : "fail") << "\n";
    if (!demo) {
        return fail(1, ss.str() + demo.error().message + "\n");
    }
    return ok(ss.str());
}

CliResult cmd_providers(const std::vector<std::string>& args) {
    if (args.size() < 2 || args[1] == "list") {
        return ok(list_providers_text());
    }
    if (args[1] == "show") {
        if (args.size() < 3) return fail(2, "usage: providers show <name>\n");
        auto cfg = get_provider_config(args[2]);
        if (!cfg) return fail(1, cfg.error().message + "\n");
        ProviderResolveOptions show_opt;
        show_opt.allow_missing_key = true;
        auto resolved = resolve_provider_settings(args[2], show_opt);
        nlohmann::json out = cfg.value().to_json();
        if (resolved) out["resolved"] = resolved.value().to_json();
        return ok(out.dump(2) + "\n");
    }
    if (args[1] == "resolve") {
        if (args.size() < 3) return fail(2, "usage: providers resolve <name> [--model M]\n");
        ProviderResolveOptions opt;
        opt.allow_missing_key = has_flag(args, "--allow-missing-key");
        const auto model_flag = optional_flag_value(args, "--model");
        if (!model_flag.empty()) opt.model = model_flag;
        auto resolved = resolve_provider_settings(args[2], opt);
        if (!resolved) return fail(1, resolved.error().message + "\n");
        return ok(resolved.value().to_json().dump(2) + "\n");
    }
    if (args[1] == "models") {
        if (args.size() < 3) return fail(2, "usage: providers models <name> [--model M]\n");
        ProviderResolveOptions opt;
        const auto model_flag = optional_flag_value(args, "--model");
        if (!model_flag.empty()) opt.model = model_flag;
        auto models = list_provider_models(args[2], opt);
        if (!models) return fail(1, models.error().message + "\n");
        std::ostringstream ss;
        ss << "provider=" << args[2] << "\n"
           << "models=" << models.value().size() << "\n";
        for (const auto& id : models.value()) ss << id << "\n";
        return ok(ss.str());
    }
    // providers <name> as shortcut for show
    auto cfg = get_provider_config(args[1]);
    if (cfg) {
        return cmd_providers({"providers", "show", args[1]});
    }
    return fail(2, "usage: providers [list|show <name>|resolve <name>]\n" + list_providers_text());
}

CliResult cmd_templates(const std::vector<std::string>& args) {
    if (args.size() < 2 || args[1] == "list") {
        return ok(templates::list_templates_text());
    }
    const std::string id = args[1];
    const auto* tpl = templates::find_template(id);
    if (!tpl) return fail(1, "unknown template: " + id + "\n" + templates::list_templates_text());

    demos::DemoOptions opt;
    opt.output_dir = default_out_dir(args);
    opt.write_files = !has_flag(args, "--no-write");
    // Reuse template gallery single-id via orchestrator/recipe path
    if (tpl->use_orchestrator) {
        std::vector<Agent> agents;
        if (id == "support_escalation") {
            agents = {
                Agent("L1_Support", "Triages", EchoProvider().as_any()),
                Agent("L2_Support", "Deep dive", EchoProvider().as_any()),
                Agent("Incident_Commander", "IC", EchoProvider().as_any()),
            };
        } else if (id == "coding_review") {
            agents = {
                Agent("Author", "Author", EchoProvider().as_any()),
                Agent("Reviewer", "Reviewer", EchoProvider().as_any()),
                Agent("Maintainer", "Maintainer", EchoProvider().as_any()),
            };
        } else if (id == "research_digest") {
            agents = {
                Agent("Librarian", "Librarian", EchoProvider().as_any()),
                Agent("Analyst", "Analyst", EchoProvider().as_any()),
                Agent("Editor", "Editor", EchoProvider().as_any()),
            };
        } else if (id == "incident_response") {
            agents = {
                Agent("Oncall", "Oncall", EchoProvider().as_any()),
                Agent("Comms", "Comms", EchoProvider().as_any()),
                Agent("Scribe", "Scribe", EchoProvider().as_any()),
            };
        } else if (id == "product_spec") {
            agents = {
                Agent("PM", "PM", EchoProvider().as_any()),
                Agent("Designer", "Designer", EchoProvider().as_any()),
                Agent("TechLead", "TechLead", EchoProvider().as_any()),
            };
        } else {
            return fail(1, "no agent roster mapping for template " + id + "\n");
        }
        Orchestrator orch(std::move(agents));
        auto run = orch.run(tpl->orchestrator, "Run template " + id);
        if (!run) return fail(1, run.error().message + "\n");
        std::ostringstream ss;
        ss << run.value().to_json().dump(2) << "\n";
        ss << "task=" << run.value().task << "\n";
        ss << "final_output_chars=" << run.value().final_output.size() << "\n";
        ss << "handoffs=" << run.value().all_handoffs.size() << "\n";
        if (opt.write_files) {
            auto path = write_report_json(opt.output_dir / (id + ".json"), run.value().to_json());
            if (path) ss << "artifact=" << path.value() << "\n";
        }
        return run.value().success ? ok(ss.str()) : fail(1, ss.str());
    }

    // recipe path
    std::vector<Agent> agents;
    for (const auto& step : tpl->recipe.steps) {
        agents.emplace_back(step.agent_name, step.agent_name, EchoProvider().as_any());
    }
    // dedupe by name roughly via map
    std::vector<Agent> unique;
    for (auto& a : agents) {
        bool found = false;
        for (const auto& u : unique) if (u.name() == a.name()) found = true;
        if (!found) unique.push_back(std::move(a));
    }
    RecipeRunner runner(std::move(unique));
    auto run = runner.run(tpl->recipe, "Run template " + id);
    if (!run) return fail(1, run.error().message + "\n");
    std::ostringstream ss;
    ss << run.value().to_json().dump(2) << "\n";
    return run.value().success ? ok(ss.str()) : fail(1, ss.str());
}

CliResult cmd_evaluate(const std::vector<std::string>& args) {
    demos::DemoOptions opt;
    opt.write_files = false;
    auto team = demos::run_team_handoff_demo(opt);
    if (!team) return fail(1, team.error().message + "\n");
    // Prefer trace evaluation (always has steps); also score handoffs.
    auto eval = WorkflowEvaluator{}.evaluate_trace(team.value().trace);
    auto handoff_eval = WorkflowEvaluator{}.evaluate_handoffs(team.value().handoffs);
    TeamRunResult tr;
    tr.task = team.value().task;
    tr.final_output = team.value().final_output;
    tr.handoffs = team.value().handoffs;
    tr.success = team.value().success;
    auto scorecard = build_scorecard(tr, team.value().trace, eval.score);
    std::ostringstream ss;
    ss << eval.to_markdown() << "\n## Handoff-only eval\n\n" << handoff_eval.to_markdown() << "\n";
    ss << "## Scorecard\n\n" << scorecard.dump(2) << "\n";
    nlohmann::json combined = {
        {"trace_eval", eval.to_json()},
        {"handoff_eval", handoff_eval.to_json()},
        {"scorecard", scorecard},
        {"task", team.value().task},
        {"final_output", team.value().final_output},
        {"handoffs", team.value().to_json().at("handoffs")},
    };
    if (args.size() >= 2 && args[1].rfind("-", 0) != 0) {
        auto path = write_report_json(args[1], combined);
        if (!path) return fail(1, path.error().message + "\n");
        ss << "artifact=" << path.value() << "\n";
    }
    const bool ok_flag = eval.success || handoff_eval.success;
    return ok_flag ? ok(ss.str()) : CliResult{1, ss.str(), "eval failed\n"};
}

CliResult cmd_replay(const std::vector<std::string>& args) {
    if (args.size() < 2) {
        return fail(2, "usage: replay <trace-or-demo.json> [--reexecute]\n");
    }
    ReplayOptions opt;
    opt.reexecute_agents = has_flag(args, "--reexecute");
    opt.revalidate_handoffs = true;
    opt.rescore_quality = true;
    std::vector<Agent> agents = {
        Agent("Architect", "Designs", EchoProvider().as_any()),
        Agent("Coder", "Implements", EchoProvider().as_any()),
        Agent("Reviewer", "Reviews", EchoProvider().as_any()),
    };
    ReplayRunner runner(std::move(agents));
    auto report = runner.replay_file(args[1], opt);
    if (!report) return fail(1, report.error().message + "\n");
    return report.value().success ? ok(report.value().to_markdown() + "\n" + report.value().to_json().dump(2) + "\n")
                                  : CliResult{1, report.value().to_markdown() + "\n", "replay failed\n"};
}

CliResult cmd_fusion(const std::vector<std::string>& args) {
    // fusion [--provider P] [--profile neutral|shipping|...] [--mode lean|ultra|dag]
    //        [--config FILE] [--prompt-config FILE] [--role-file FILE]
    //        [--branch-tokens N] [--skeptic-tokens N] [--merge-tokens N] [--meta-tokens N]
    //        [--thinking enabled|disabled] [--reasoning-effort high|max]
    //        [--parallel-branches|--no-parallel-branches] [--max-parallel N]
    //        [--tier lite|medium|pro|ultra|genius] [--model M] [--prompt "..."]
    //        [--out DIR] [--ultra] [--no-cache] [--cache-dir D]
    // fusion profiles | modes | tiers | roles | explain | cache ...
    if (args.size() >= 2 && args[1] == "profiles") {
        std::ostringstream ss;
        for (const auto& n : demos::fusion::fusion_profile_names()) ss << n << "\n";
        ss << "(also packs: incident, product via --pack)\n";
        return ok(ss.str());
    }
    if (args.size() >= 2 && args[1] == "roles") {
        // fusion roles [--profile neutral] [--file pack.json] [--pack incident|product]
        std::string file = optional_flag_value(args, "--file");
        std::string pack_name = optional_flag_value(args, "--pack");
        std::string profile = optional_flag_value(args, "--profile");
        if (profile.empty()) profile = "neutral";
        demos::fusion::RolePack pack;
        if (!file.empty()) {
            auto loaded = demos::fusion::load_role_pack_file(file);
            if (!loaded) return fail(1, loaded.error().message + "\n");
            pack = std::move(loaded.value());
        } else if (pack_name == "incident") {
            pack = demos::fusion::make_incident_pack();
        } else if (pack_name == "product") {
            pack = demos::fusion::make_product_pack();
        } else {
            auto pr = demos::fusion::fusion_profile_from_string(profile);
            if (!pr) return fail(2, "unknown --profile " + profile + "\n");
            pack = demos::fusion::make_role_pack(pr.value());
        }
        auto v = demos::fusion::validate_role_pack(pack);
        if (!v) return fail(1, v.error().message + "\n");
        return ok(demos::fusion::format_role_pack_text(pack));
    }
    if (args.size() >= 2 && args[1] == "explain") {
        // fusion explain [--tier medium] [--mode lean|ultra|dag|panel] [--profile neutral]
        demos::fusion::FusionConfig cfg;
        cfg.provider = "echo";
        cfg.write_files = false;
        std::string tier = optional_flag_value(args, "--tier");
        if (tier.empty()) tier = "medium";
        if (auto t = demos::fusion::fusion_tier_from_string(tier)) {
            demos::fusion::apply_fusion_tier(cfg, t.value());
        } else {
            return fail(2, "unknown --tier " + tier + "\n");
        }
        std::string mode = optional_flag_value(args, "--mode");
        if (!mode.empty()) {
            if (auto m = demos::fusion::fusion_mode_from_string(mode)) cfg.mode = m.value();
            else return fail(2, "unknown --mode " + mode + "\n");
        }
        std::string profile = optional_flag_value(args, "--profile");
        if (!profile.empty()) {
            if (auto p = demos::fusion::fusion_profile_from_string(profile)) cfg.profile = p.value();
            else return fail(2, "unknown --profile " + profile + "\n");
        }
        return ok(demos::fusion::explain_fusion_plan(cfg));
    }
    if (args.size() >= 2 && args[1] == "modes") {
        std::ostringstream ss;
        for (const auto& n : demos::fusion::fusion_mode_names()) ss << n << "\n";
        return ok(ss.str());
    }
    if (args.size() >= 2 && args[1] == "tiers") {
        std::ostringstream ss;
        for (const auto& n : demos::fusion::fusion_tier_names()) {
            auto t = demos::fusion::fusion_tier_from_string(n);
            if (!t) continue;
            const auto spec = demos::fusion::fusion_tier_spec(t.value());
            ss << spec.id << "\t" << spec.display_name << "\t"
               << "mode=" << demos::fusion::fusion_mode_to_string(spec.mode)
               << " branches=" << spec.branch_count
               << " planned_calls=" << spec.planned_llm_calls
               << " pack=" << spec.capability.pack_id
               << " depth=" << demos::fusion::fusion_prompt_depth_to_string(spec.capability.depth)
               << " skills=" << spec.capability.skills.size()
               << " tools=" << spec.capability.tool_slots.size()
               << "\t" << spec.description << "\n";
        }
        return ok(ss.str());
    }
    if (args.size() >= 2 && args[1] == "cache") {
        // fusion cache stats|clear --cache-dir D
        std::string cdir = optional_flag_value(args, "--cache-dir");
        if (cdir.empty()) cdir = (default_out_dir(args) / "fusion-cache").string();
        demos::fusion::FusionCacheConfig cc;
        cc.cache_dir = cdir;
        demos::fusion::FusionCache cache(cc);
        if (args.size() >= 3 && args[2] == "clear") {
            auto r = cache.clear_all();
            if (!r) return fail(1, r.error().message + "\n");
            return ok("cleared cache_dir=" + cdir + "\n");
        }
        // stats: read by probing empty get then dump config path
        (void)cache.get("__stats_probe__");
        return ok(demos::fusion::format_cache_stats_markdown(cache.stats()) +
                  "cache_dir=" + cdir + "\n");
    }
    if (args.size() >= 2 && args[1] == "bench") {
        demos::fusion::FusionConfig cfg;
        cfg.provider = optional_flag_value(args, "--provider");
        if (cfg.provider.empty()) cfg.provider = "echo";
        cfg.write_files = false;
        cfg.cache.enabled = !has_flag(args, "--no-cache");
        cfg.mode = demos::fusion::FusionMode::Lean;
        cfg.profile = demos::fusion::FusionProfileId::Diagnostic;
        std::string case_id = optional_flag_value(args, "--case");
        std::vector<std::string> ids;
        if (!case_id.empty()) ids.push_back(case_id);
        auto batch = demos::fusion::run_bench_batch(ids, cfg);
        if (!batch) return fail(1, batch.error().message + "\n");
        return ok(batch.value().to_markdown() + "\n" + batch.value().to_json().dump(2) + "\n");
    }
    if (args.size() >= 2 && args[1] == "scenarios") {
        auto base = demos::fusion::all_fusion_scenarios();
        auto deep = demos::fusion::all_fusion_scenarios_deep();
        std::ostringstream ss;
        for (const auto& s : base) ss << s.id << "\t" << s.title << "\n";
        for (const auto& s : deep) ss << s.id << "\t" << s.title << "\n";
        if (args.size() >= 3 && args[2] == "run-all") {
            auto all = demos::fusion::run_all_fusion_scenarios();
            if (!all) return fail(1, all.error().message + "\n");
            auto deep_all = demos::fusion::run_all_fusion_scenarios_deep();
            if (!deep_all) return fail(1, deep_all.error().message + "\n");
            int pass = 0;
            int total = 0;
            for (const auto& r : all.value()) {
                ss << (r.passed ? "PASS" : "FAIL") << "\t" << r.id << "\t" << r.message << "\n";
                if (r.passed) ++pass;
                ++total;
            }
            for (const auto& r : deep_all.value()) {
                ss << (r.passed ? "PASS" : "FAIL") << "\t" << r.id << "\t" << r.message << "\n";
                if (r.passed) ++pass;
                ++total;
            }
            ss << "pass=" << pass << " total=" << total << "\n";
            return pass == total ? ok(ss.str()) : fail(1, ss.str());
        }
        return ok(ss.str());
    }
    if (args.size() >= 2 && args[1] == "audit-loc") {
        std::string root = "packages/cpp";
        const std::string root_flag = optional_flag_value(args, "--root");
        if (!root_flag.empty()) root = root_flag;
        auto audit = demos::fusion::audit_fusion_suite_loc(root);
        return ok(demos::fusion::format_loc_audit(audit));
    }
    // fusion war-room | compare — multi-tier native compare (fast with --provider echo)
    if (args.size() >= 2 && (args[1] == "war-room" || args[1] == "warroom" || args[1] == "compare")) {
        demos::fusion::WarRoomOptions w;
        w.provider = optional_flag_value(args, "--provider");
        if (w.provider.empty()) w.provider = "echo";
        w.model = optional_flag_value(args, "--model");
        w.task = optional_flag_value(args, "--prompt");
        if (w.task.empty()) {
            w.task =
                "A 48-year-old man has resistant hypertension, K 2.6, high aldosterone, suppressed renin. "
                "Give primary diagnosis, 3 differentials, key findings, next 3 tests, confidence 0-100.";
        }
        const std::string tiers_csv = optional_flag_value(args, "--tiers");
        if (!tiers_csv.empty()) {
            w.tiers.clear();
            std::string cur;
            for (char c : tiers_csv) {
                if (c == ',' || c == ' ') {
                    if (!cur.empty()) {
                        w.tiers.push_back(cur);
                        cur.clear();
                    }
                } else {
                    cur.push_back(c);
                }
            }
            if (!cur.empty()) w.tiers.push_back(cur);
        }
        // default: skip genius for speed unless asked
        if (tiers_csv.empty()) {
            w.tiers = {"lite", "medium", "pro", "ultra"};
        }
        const std::string profile = optional_flag_value(args, "--profile");
        if (!profile.empty()) {
            if (auto p = demos::fusion::fusion_profile_from_string(profile)) {
                w.profile = p.value();
            }
        }
        w.cache_enabled = !has_flag(args, "--no-cache") && has_flag(args, "--cache");
        w.write_files = has_flag(args, "--write");
        const std::string prev = optional_flag_value(args, "--preview");
        if (!prev.empty()) {
            try {
                w.preview_chars = static_cast<std::size_t>(std::stoul(prev));
            } catch (...) {
            }
        }
        auto report = demos::fusion::run_fusion_war_room(w);
        if (!report) return fail(1, report.error().message + "\n");
        std::ostringstream ss;
        ss << report.value().to_markdown();
        if (has_flag(args, "--json")) {
            ss << "\n## wire\n\n" << report.value().to_json().dump(2) << "\n";
        }
        return ok(ss.str());
    }

    demos::DemoOptions opt;
    opt.output_dir = default_out_dir(args);
    opt.write_files = !has_flag(args, "--no-write");
    if (has_flag(args, "--out")) opt.extra["output_dir_explicit"] = true;
    if (has_flag(args, "--no-write")) opt.extra["no_write_explicit"] = true;
    const bool ultra_flag = has_flag(args, "--ultra");
    const std::string config_file = optional_flag_value(args, "--config");
    const std::string prompt_config_file = optional_flag_value(args, "--prompt-config");
    const std::string role_pack_file = optional_flag_value(args, "--role-file");
    std::string tier = optional_flag_value(args, "--tier");
    std::string mode = optional_flag_value(args, "--mode");
    // Product tier selects call graph; --ultra remains a shortcut to Pro-like ultra mode.
    if (tier.empty() && ultra_flag) tier = "pro";
    if (mode.empty() && tier.empty() && config_file.empty()) mode = "lean";
    if (mode.empty() && !tier.empty()) {
        // mode filled by tier application in router; keep placeholder for logging
        mode = "(from-tier)";
    }
    const bool ultra = (mode == "ultra" || ultra_flag || tier == "pro");

    std::string provider = optional_flag_value(args, "--provider");
    if (provider.empty() && config_file.empty()) {
        // echo is safe offline default when no external config supplies a provider.
        provider = "echo";
    }
    std::string model = optional_flag_value(args, "--model");
    std::string prompt = optional_prompt(args);
    std::string profile = optional_flag_value(args, "--profile");
    if (profile.empty() && config_file.empty()) {
        // CLI compat: pro/ultra tiers without profile keep shipping; otherwise neutral.
        profile = (ultra || tier == "pro" || tier == "ultra" || tier == "genius") ? "shipping" : "neutral";
    }
    if (prompt.empty() && config_file.empty()) {
        prompt =
            "Ship HandoffKit C++ for real multi-agent use: packaging, providers, CLI demos, "
            "and handoff quality. Propose a practical plan.";
    }
    // Preserve explicit markers already stored above (--out / --no-write).
    opt.extra["ultra"] = ultra;
    if (!provider.empty()) opt.extra["provider"] = provider;
    if (!prompt.empty()) opt.extra["prompt"] = prompt;
    if (!profile.empty()) opt.extra["profile"] = profile;
    if (!tier.empty()) {
        opt.extra["tier"] = tier;
    }
    if (!config_file.empty()) opt.extra["config_file"] = config_file;
    if (!prompt_config_file.empty()) opt.extra["prompt_config_file"] = prompt_config_file;
    if (!role_pack_file.empty()) opt.extra["role_pack_file"] = role_pack_file;
    if (mode != "(from-tier)" && !mode.empty()) {
        opt.extra["mode"] = mode;
        if (mode == "dag") opt.extra["ultra"] = false;
    } else if (tier.empty() && config_file.empty()) {
        opt.extra["mode"] = mode.empty() ? "lean" : mode;
    }
    if (!model.empty()) {
        opt.extra["model"] = model;
    }
    const std::string models_csv = optional_flag_value(args, "--models");
    if (!models_csv.empty()) {
        opt.extra["models"] = models_csv;
        if (mode.empty() || mode == "(from-tier)" || mode == "lean") {
            // Multi-model list implies panel mode unless user forced a tier graph.
            if (tier.empty()) {
                opt.extra["mode"] = "panel";
                mode = "panel";
            }
        }
    }
    const std::string model_a = optional_flag_value(args, "--model-a");
    const std::string model_b = optional_flag_value(args, "--model-b");
    const std::string model_merge = optional_flag_value(args, "--model-merge");
    if (!model_a.empty()) opt.extra["model_a"] = model_a;
    if (!model_b.empty()) opt.extra["model_b"] = model_b;
    if (!model_merge.empty()) opt.extra["model_merge"] = model_merge;
    if (has_flag(args, "--no-panel-judge")) opt.extra["no_panel_judge"] = true;
    if (has_flag(args, "--meta-judge")) opt.extra["meta_judge"] = true;
    if (has_flag(args, "--no-meta-judge")) opt.extra["no_meta_judge"] = true;
    if (has_flag(args, "--no-parallel-branches")) opt.extra["parallel_branches"] = false;
    if (has_flag(args, "--parallel-branches")) opt.extra["parallel_branches"] = true;
    const std::string max_parallel = optional_flag_value(args, "--max-parallel");
    if (!max_parallel.empty()) { try { opt.extra["max_parallel_branches"] = std::stoi(max_parallel); } catch (...) {} }
    if (has_flag(args, "--no-early-stop")) opt.extra["no_early_stop"] = true;
    if (has_flag(args, "--no-anti-dilution")) opt.extra["no_anti_dilution"] = true;
    const std::string branches = optional_flag_value(args, "--branches");
    if (!branches.empty()) { try { opt.extra["branch_count"] = std::stoi(branches); } catch (...) {} }
    const std::string max_calls = optional_flag_value(args, "--max-calls");
    if (!max_calls.empty()) { try { opt.extra["max_llm_calls"] = std::stoi(max_calls); } catch (...) {} }
    const std::string overlap = optional_flag_value(args, "--overlap-threshold");
    if (!overlap.empty()) { try { opt.extra["overlap_threshold"] = std::stod(overlap); } catch (...) {} }
    auto generation_int_flag = [&](const char* flag, const char* key) {
        const auto value = optional_flag_value(args, flag);
        if (!value.empty()) { try { opt.extra[key] = std::stoi(value); } catch (...) {} }
    };
    auto generation_double_flag = [&](const char* flag, const char* key) {
        const auto value = optional_flag_value(args, flag);
        if (!value.empty()) { try { opt.extra[key] = std::stod(value); } catch (...) {} }
    };
    generation_int_flag("--branch-tokens", "branch_max_tokens");
    generation_int_flag("--skeptic-tokens", "skeptic_max_tokens");
    generation_int_flag("--merge-tokens", "merge_max_tokens");
    generation_int_flag("--meta-tokens", "meta_judge_max_tokens");
    generation_double_flag("--temperature", "generation_temperature");
    generation_double_flag("--top-p", "generation_top_p");
    const auto thinking = optional_flag_value(args, "--thinking");
    if (!thinking.empty()) opt.extra["thinking"] = thinking;
    const auto reasoning_effort = optional_flag_value(args, "--reasoning-effort");
    if (!reasoning_effort.empty()) opt.extra["reasoning_effort"] = reasoning_effort;
    if (mode == "panel") {
        opt.extra["mode"] = "panel";
        // Panel is not tier-driven; avoid shipping profile default for research panel
        if (optional_flag_value(args, "--profile").empty()) {
            opt.extra["profile"] = "research";
            profile = "research";
        }
    }
    if (has_flag(args, "--no-cache")) opt.extra["no_cache"] = true;
    const std::string cache_dir = optional_flag_value(args, "--cache-dir");
    if (!cache_dir.empty()) opt.extra["cache_dir"] = cache_dir;

    // Optional native web explorer + HTML→Markdown (fusion --web).
    if (has_flag(args, "--web") || has_flag(args, "--enable-web") || has_flag(args, "--web-tools")) {
        opt.extra["enable_web_tools"] = true;
    }
    const std::string web_transport = optional_flag_value(args, "--web-transport");
    if (!web_transport.empty()) {
        opt.extra["web_transport"] = web_transport;
        opt.extra["enable_web_tools"] = true;
    }
    const std::string seed_url = optional_flag_value(args, "--seed-url");
    if (!seed_url.empty()) {
        opt.extra["seed_url"] = seed_url;
        opt.extra["enable_web_tools"] = true;
    }
    const std::string web_query = optional_flag_value(args, "--web-query");
    if (!web_query.empty()) {
        opt.extra["web_search_query"] = web_query;
        opt.extra["enable_web_tools"] = true;
    }
    if (has_flag(args, "--no-web-search")) {
        opt.extra["web_auto_search"] = false;
    }
    const std::string web_pages = optional_flag_value(args, "--web-max-pages");
    if (!web_pages.empty()) {
        try {
            opt.extra["web_max_pages"] = std::stoi(web_pages);
        } catch (...) {
        }
    }

    auto result = demos::run_fusion_style_router_demo(opt);
    if (!result) {
        return fail(1, result.error().message + "\n");
    }
    const int calls = result.value().report.value("llm_calls", ultra ? 5 : 3);
    const std::string tier_disp = result.value().report.value("tier_display", std::string("Fusion"));
    const std::string mode_out = result.value().report.value("mode", mode);
    const std::string tier_out = result.value().report.value("tier", tier.empty() ? std::string("medium") : tier);
    const std::string provider_out = result.value().report.value("provider", provider);
    const std::string profile_out = result.value().report.value("profile", profile);
    const std::string model_out = result.value().report.value("model", model);
    std::ostringstream ss;
    ss << "# " << tier_disp << " router run\n\n"
       << "provider=" << provider_out << "\n"
       << "profile=" << profile_out << "\n"
       << "model=" << (model_out.empty() ? "(provider default/env)" : model_out) << "\n"
       << "tier=" << tier_out << "\n"
       << "mode=" << mode_out << "\n"
       << "llm_calls=" << calls << "\n"
       << "success=" << (result.value().success ? "true" : "false") << "\n";
    if (result.value().report.contains("error") && result.value().report["error"].is_string() &&
        !result.value().report["error"].get<std::string>().empty()) {
        ss << "error=" << result.value().report["error"].get<std::string>() << "\n";
    }
    if (result.value().report.contains("capability") && result.value().report["capability"].is_object()) {
        const auto& cap = result.value().report["capability"];
        ss << "capability_pack=" << cap.value("pack_id", std::string("")) << "\n"
           << "capability_depth=" << cap.value("depth", std::string("")) << "\n"
           << "capability_skills=" << cap.value("skills", nlohmann::json::array()).dump() << "\n"
           << "capability_tool_slots=" << cap.value("tool_slots", nlohmann::json::array()).dump() << "\n";
    }
    if (result.value().report.contains("handoff_count")) {
        ss << "handoff_count=" << result.value().report["handoff_count"] << "\n";
    }
    if (result.value().report.contains("web_research") && result.value().report["web_research"].is_object()) {
        const auto& wr = result.value().report["web_research"];
        ss << "web_enabled=" << (wr.value("enabled", false) ? "true" : "false") << "\n"
           << "web_used=" << (wr.value("used", false) ? "true" : "false") << "\n"
           << "web_pages_ok=" << wr.value("pages_ok", 0) << "\n"
           << "web_tool_calls=" << wr.value("tool_calls", 0) << "\n"
           << "web_transport=" << wr.value("transport", std::string("")) << "\n"
           << "web_markdown_chars=" << wr.value("markdown_chars", 0) << "\n";
    }
    if (result.value().report.contains("web_tools_live")) {
        ss << "web_tools_live=" << (result.value().report["web_tools_live"].get<bool>() ? "true" : "false")
           << "\n";
    }
    if (result.value().report.contains("panel_size")) {
        ss << "panel_size=" << result.value().report["panel_size"] << "\n";
    }
    if (result.value().report.contains("panel_judge") && result.value().report["panel_judge"].is_object()) {
        const auto& pj = result.value().report["panel_judge"];
        ss << "panel_judge_success=" << (pj.value("success", false) ? "true" : "false") << "\n";
        if (pj.contains("analysis") && pj["analysis"].is_object()) {
            const auto& a = pj["analysis"];
            ss << "panel_consensus=" << a.value("consensus", nlohmann::json::array()).size() << "\n"
               << "panel_contradictions=" << a.value("contradictions", nlohmann::json::array()).size() << "\n";
        }
    }
    if (result.value().report.contains("cache")) {
        ss << "cache=" << result.value().report["cache"].dump() << "\n";
    }
    ss << "\n";
    if (result.value().report.contains("branch_a") && result.value().report["branch_a"].contains("output")) {
        ss << "## Branch A\n\n" << result.value().report["branch_a"]["output"].get<std::string>() << "\n\n";
        if (ultra && result.value().report["branch_a"].contains("skeptic")) {
            const auto sk = result.value().report["branch_a"]["skeptic"];
            if (sk.is_string() && !sk.get<std::string>().empty()) {
                ss << "### Skeptic A\n\n" << sk.get<std::string>() << "\n\n";
            }
        }
    }
    if (result.value().report.contains("branch_b") && result.value().report["branch_b"].contains("output")) {
        ss << "## Branch B\n\n" << result.value().report["branch_b"]["output"].get<std::string>() << "\n\n";
        if (ultra && result.value().report["branch_b"].contains("skeptic")) {
            const auto sk = result.value().report["branch_b"]["skeptic"];
            if (sk.is_string() && !sk.get<std::string>().empty()) {
                ss << "### Skeptic B\n\n" << sk.get<std::string>() << "\n\n";
            }
        }
    }
    ss << "## Merged answer\n\n"
       << result.value().final_output << "\n\n"
       << "wire.task=" << result.value().task << "\n"
       << "wire.final_output_chars=" << result.value().final_output.size() << "\n"
       << "wire.handoffs=" << result.value().handoffs.size() << "\n";
    if (!result.value().artifact_paths.empty()) {
        ss << "artifacts:\n";
        for (const auto& p : result.value().artifact_paths) ss << "  - " << p << "\n";
    }
    return result.value().success ? ok(ss.str()) : fail(1, ss.str());
}

CliResult cmd_generate(const std::vector<std::string>& args) {
    // handoffkit-cli generate --provider nvidia --prompt "..." [--model M]
    // One live request; keep usage minimal for rate limits.
    // Prefer --prompt-file for long/UTF-8 prompts on Windows.
    const std::string provider = optional_flag_value(args, "--provider");
    std::string prompt = optional_prompt(args);
    const std::string model = optional_flag_value(args, "--model");
    if (provider.empty()) {
        return fail(2, "usage: generate --provider <name> --prompt \"...\"|--prompt-file PATH [--model M]\n");
    }
    if (prompt.empty()) {
        // allow: generate nvidia "prompt text"
        if (args.size() >= 3 && args[1].rfind("-", 0) != 0) {
            // generate <provider> <prompt...>
        }
        // positional fallback: generate --provider x hello world...
        for (std::size_t i = 1; i < args.size(); ++i) {
            if (args[i] == "--prompt" && i + 1 < args.size()) {
                prompt = args[i + 1];
                break;
            }
        }
    }
    if (prompt.empty()) {
        // join remaining non-flag tokens after provider as prompt
        std::ostringstream ps;
        bool take = false;
        for (std::size_t i = 1; i < args.size(); ++i) {
            if (args[i] == "--provider" || args[i] == "--model" || args[i] == "--prompt") {
                ++i;
                continue;
            }
            if (args[i].rfind("--", 0) == 0) continue;
            if (!take) {
                // skip bare provider name if first positional equals provider
                if (args[i] == provider) {
                    take = true;
                    continue;
                }
                take = true;
            }
            if (!ps.str().empty()) ps << ' ';
            ps << args[i];
        }
        prompt = ps.str();
    }
    if (prompt.empty()) {
        return fail(2, "usage: generate --provider <name> --prompt \"...\" [--model M]\n");
    }

    ProviderResolveOptions opt;
    if (!model.empty()) opt.model = model;
    auto provider_any = make_provider(provider, opt);
    if (!provider_any) {
        return fail(1, provider_any.error().message + "\n");
    }
    GenerateOptions gopt;
    gopt.task = prompt;
    auto out = provider_any.value().generate(prompt, gopt);
    if (!out) {
        return fail(1, out.error().message + "\n");
    }
    ProviderResolveOptions show_opt;
    show_opt.allow_missing_key = true;
    if (!model.empty()) show_opt.model = model;
    auto settings = resolve_provider_settings(provider, show_opt);
    std::ostringstream ss;
    ss << "provider=" << provider << "\n";
    if (settings) {
        ss << "model=" << settings.value().model << "\n";
        ss << "base_url=" << settings.value().base_url << "\n";
    }
    ss << "output:\n" << out.value() << "\n";
    return ok(ss.str());
}

CliResult cmd_parse_structured(const std::vector<std::string>& args) {
    if (args.size() < 2) {
        return fail(2, "usage: parse-structured <json-or-text-file>\n");
    }
    auto loaded = load_report_json(args[1]);
    std::string text;
    if (loaded) {
        text = loaded.value().dump();
    } else {
        std::ifstream in(args[1]);
        if (!in) return fail(1, "cannot read file\n");
        text.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }
    auto parsed = parse_agent_structured(text, action_plan_schema(), true);
    return parsed.success ? ok(parsed.to_json().dump(2) + "\n")
                          : CliResult{1, parsed.to_json().dump(2) + "\n", "parse failed\n"};
}

explore::ExplorePolicy policy_from_cli_args(const std::vector<std::string>& args) {
    explore::ExplorePolicy p;
    const std::string md = optional_flag_value(args, "--max-depth");
    if (!md.empty()) p.max_depth = std::stoi(md);
    const std::string mp = optional_flag_value(args, "--max-pages");
    if (!mp.empty()) p.max_pages = std::stoi(mp);
    const std::string to = optional_flag_value(args, "--timeout-ms");
    if (!to.empty()) p.timeout_ms = std::stoi(to);
    if (has_flag(args, "--any-host")) p.same_host_only = false;
    const std::string deny = optional_flag_value(args, "--deny-host");
    if (!deny.empty()) p.deny_hosts.push_back(deny);
    const std::string allow = optional_flag_value(args, "--allow-host");
    if (!allow.empty()) p.allow_hosts.push_back(allow);
    const std::string ua = optional_flag_value(args, "--user-agent");
    if (!ua.empty()) p.user_agent = ua;
    return p;
}

CliResult cmd_explore(const std::vector<std::string>& args) {
    // explore fixture | fetch | crawl | tools
    //   --url U --transport map|http|fixture --max-depth N --max-pages N
    //   --deny-host H --allow-host H --any-host --user-agent UA --json
    if (args.size() < 2 || args[1] == "help" || args[1] == "-h") {
        return ok(
            "explore fixture              Offline multi-page fixture explore (no network)\n"
            "explore fetch --url URL      Single-page fetch\n"
            "explore crawl --url URL      Multi-step explore (bounded)\n"
            "explore md --url URL         Fetch and print Markdown only\n"
            "explore html2md              Convert --html-file or fixture HTML to Markdown\n"
            "explore tools                List web explorer tool names\n"
            "  --transport map|http|fixture   (default fixture for fixture; map/http for others)\n"
            "  --max-depth N --max-pages N --timeout-ms N\n"
            "  --deny-host H --allow-host H --any-host --user-agent UA\n"
            "  --json                     Emit full snake_case JSON result\n"
            "  --markdown                 Prefer markdown excerpt in text output\n"
            "Inject explore::WebTransport / ExplorePolicy; prefer result markdown for prompts.\n"
        );
    }
    const std::string sub = args[1];
    if (sub == "tools") {
        ToolRegistry reg;
        explore::register_web_explorer_tools(reg, explore::make_fixture_map_transport());
        std::ostringstream ss;
        for (const auto& n : reg.names()) ss << n << "\n";
        return ok(ss.str());
    }
    if (sub == "html2md") {
        std::string html;
        const std::string file = optional_flag_value(args, "--html-file");
        std::string url = optional_flag_value(args, "--url");
        if (!file.empty()) {
            std::ifstream in(file);
            if (!in) return fail(1, "cannot read --html-file\n");
            html.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
        } else {
            // default: fixture home HTML via map transport body
            auto map = explore::make_fixture_map_transport();
            if (url.empty()) url = "https://fixture.local/";
            explore::TransportRequest treq;
            treq.url = url;
            auto resp = map->get(treq);
            if (!resp.error.empty()) return fail(1, resp.error + "\n");
            html = resp.body;
        }
        explore::HtmlToMarkdownOptions opts;
        opts.base_url = url.empty() ? "https://fixture.local/" : url;
        opts.include_source_header = true;
        opts.include_links_section = true;
        auto md = explore::html_to_markdown(html, opts);
        if (has_flag(args, "--json")) {
            nlohmann::json j{
                {"success", true},
                {"url", opts.base_url},
                {"title", explore::extract_title(html)},
                {"markdown", md},
                {"markdown_chars", md.size()},
                {"format", "markdown"},
            };
            return ok(j.dump(2) + "\n");
        }
        return ok(md + (md.empty() || md.back() == '\n' ? "" : "\n"));
    }

    auto policy = policy_from_cli_args(args);
    std::string transport_kind = optional_flag_value(args, "--transport");
    std::string url = optional_flag_value(args, "--url");
    explore::TransportPtr transport;

    if (sub == "fixture") {
        transport = explore::make_fixture_map_transport();
        if (url.empty()) url = "https://fixture.local/";
        if (transport_kind.empty()) transport_kind = "fixture";
        // sensible defaults for offline demo
        if (!has_flag(args, "--max-depth") && optional_flag_value(args, "--max-depth").empty()) {
            // policy_from already default max_depth=1
        }
        if (optional_flag_value(args, "--max-pages").empty()) {
            policy.max_pages = 8;
        }
        policy.max_depth = std::max(policy.max_depth, 1);
        policy.same_host_only = true;
        policy.allow_hosts = {"fixture.local"};
    } else if (sub == "fetch" || sub == "crawl" || sub == "explore" || sub == "md") {
        if (url.empty()) {
            return fail(2, "explore " + sub + " requires --url URL\n");
        }
        if (transport_kind.empty()) {
#if defined(HANDOFFKIT_WITH_HTTP)
            transport_kind = "http";
#else
            transport_kind = "map";
#endif
        }
        if (transport_kind == "fixture") {
            transport = explore::make_fixture_map_transport();
        } else if (transport_kind == "http" || transport_kind == "live") {
            transport = explore::make_transport("http");
        } else {
            transport = explore::make_transport("map");
        }
    } else {
        return fail(2, "unknown explore subcommand: " + sub + "\n");
    }

    policy.emit_markdown = true;
    explore::WebExplorer explorer(transport);
    const bool fetch_only = (sub == "fetch" || sub == "md");
    auto result = fetch_only ? explorer.fetch(url, policy) : explorer.explore(url, policy);
    if (!result) {
        return fail(1, result.error().message + "\n");
    }
    const auto& er = result.value();
    if (sub == "md") {
        if (!er.success) {
            return CliResult{1, er.markdown, er.error + "\n"};
        }
        if (has_flag(args, "--json")) {
            nlohmann::json j{
                {"success", true},
                {"url", er.final_url},
                {"title", er.title},
                {"markdown", er.markdown},
                {"markdown_chars", er.markdown.size()},
                {"format", "markdown"},
            };
            return ok(j.dump(2) + "\n");
        }
        return ok(er.markdown + (er.markdown.empty() || er.markdown.back() == '\n' ? "" : "\n"));
    }
    if (has_flag(args, "--json")) {
        return ok(er.to_json().dump(2) + "\n");
    }
    std::ostringstream ss;
    ss << "success=" << (er.success ? "true" : "false") << "\n"
       << "transport=" << (transport ? transport->name() : "none") << "\n"
       << "start_url=" << er.start_url << "\n"
       << "final_url=" << er.final_url << "\n"
       << "pages_fetched=" << er.pages_fetched << "\n"
       << "max_depth_reached=" << er.max_depth_reached << "\n"
       << "title=" << er.title << "\n"
       << "text_chars=" << er.text.size() << "\n"
       << "markdown_chars=" << er.markdown.size() << "\n"
       << "links=" << er.links.size() << "\n"
       << "steps=" << er.steps.size() << "\n"
       << "error=" << er.error << "\n";
    const bool prefer_md = has_flag(args, "--markdown") || !er.markdown.empty();
    if (prefer_md && !er.markdown.empty()) {
        ss << "\n## Markdown (excerpt)\n\n";
        ss << er.markdown.substr(0, std::min<std::size_t>(er.markdown.size(), 2000)) << "\n";
    } else if (!er.text.empty()) {
        ss << "\n## Extracted text (excerpt)\n\n";
        ss << er.text.substr(0, std::min<std::size_t>(er.text.size(), 1200)) << "\n";
    }
    ss << "\nwire.success=" << (er.success ? "true" : "false") << "\n"
       << "wire.title=" << er.title << "\n"
       << "wire.final_url=" << er.final_url << "\n"
       << "wire.markdown_chars=" << er.markdown.size() << "\n";
    if (!er.success) {
        return CliResult{1, ss.str(), er.error + "\n"};
    }
    return ok(ss.str());
}

CliResult cmd_benchmark(const std::vector<std::string>& args) {
    using demos::fusion::DracoRunConfig;
    using demos::fusion::load_draco_tasks;
    using demos::fusion::run_draco_batch;

    const auto usage = [] {
        return std::string(
            "benchmark draco validate --dataset PATH\n"
            "benchmark draco run --dataset PATH [--provider P] [--model M]\n"
            "  [--judge-provider P] [--judge-model M] [--tier baseline|lite|medium|pro|ultra|genius]\n"
            "  [--offset N] [--limit N] [--out DIR] [--resume|--no-resume]\n"
            "  [--generate-only|--judge-only|--no-judge] [--web] [--no-parallel]\n"
            "  [--answer-tokens N] [--judge-tokens N] [--judge-batch N]\n"
            "  [--generation-attempts N] [--judge-attempts N] [--json]\n"
        );
    };
    if (args.size() < 2 || args[1] == "help" || args[1] == "-h" || args[1] == "--help") {
        return ok(usage());
    }
    if (args[1] != "draco") {
        return fail(2, "unknown benchmark: " + args[1] + "\n" + usage());
    }
    const std::string sub = args.size() >= 3 && args[2].rfind("-", 0) != 0 ? args[2] : "run";
    const std::string dataset = optional_flag_value(args, "--dataset");
    if (dataset.empty()) return fail(2, "benchmark draco requires --dataset PATH\n" + usage());

    if (sub == "validate") {
        auto tasks = load_draco_tasks(dataset);
        if (!tasks) return fail(1, tasks.error().message + "\n");
        std::size_t criteria = 0;
        std::vector<std::string> domains;
        for (const auto& task : tasks.value()) {
            criteria += task.criteria.size();
            if (std::find(domains.begin(), domains.end(), task.domain) == domains.end()) {
                domains.push_back(task.domain);
            }
        }
        std::ostringstream ss;
        ss << "benchmark=draco\n"
           << "dataset=" << dataset << "\n"
           << "tasks=" << tasks.value().size() << "\n"
           << "criteria=" << criteria << "\n"
           << "domains=" << domains.size() << "\n";
        if (!tasks.value().empty()) {
            ss << "first_id=" << tasks.value().front().id << "\n"
               << "last_id=" << tasks.value().back().id << "\n";
        }
        for (const auto& domain : domains) ss << "domain=" << domain << "\n";
        return ok(ss.str());
    }
    if (sub != "run") return fail(2, "unknown DRACO subcommand: " + sub + "\n" + usage());

    DracoRunConfig config;
    config.dataset_path = dataset;
    config.provider = optional_flag_value(args, "--provider");
    if (config.provider.empty()) config.provider = "opencode-go";
    config.model = optional_flag_value(args, "--model");
    config.judge_provider = optional_flag_value(args, "--judge-provider");
    config.judge_model = optional_flag_value(args, "--judge-model");
    config.tier = optional_flag_value(args, "--tier");
    if (config.tier.empty()) config.tier = "baseline";
    config.resume = !has_flag(args, "--no-resume");
    if (has_flag(args, "--resume")) config.resume = true;
    config.generate_answers = !has_flag(args, "--judge-only");
    config.judge_answers = !has_flag(args, "--no-judge") && !has_flag(args, "--generate-only");
    config.enable_web_tools = has_flag(args, "--web");
    config.parallel_branches = !has_flag(args, "--no-parallel");
    config.write_markdown = !has_flag(args, "--no-markdown");

    std::string parse_error;
    auto parse_size = [&](const char* flag, std::size_t& target) {
        const std::string value = optional_flag_value(args, flag);
        if (value.empty()) return true;
        try {
            std::size_t used = 0;
            const auto parsed = std::stoull(value, &used);
            if (used != value.size()) throw std::invalid_argument("trailing");
            target = static_cast<std::size_t>(parsed);
            return true;
        } catch (...) {
            parse_error = std::string(flag) + " must be a non-negative integer";
            return false;
        }
    };
    auto parse_int = [&](const char* flag, int& target) {
        const std::string value = optional_flag_value(args, flag);
        if (value.empty()) return true;
        try {
            std::size_t used = 0;
            const auto parsed = std::stol(value, &used);
            if (used != value.size() || parsed < 0 || parsed > std::numeric_limits<int>::max()) {
                throw std::out_of_range("range");
            }
            target = static_cast<int>(parsed);
            return true;
        } catch (...) {
            parse_error = std::string(flag) + " must be a non-negative integer";
            return false;
        }
    };
    if (!parse_size("--offset", config.offset) ||
        !parse_size("--limit", config.limit) ||
        !parse_int("--answer-tokens", config.answer_max_tokens) ||
        !parse_int("--judge-tokens", config.judge_max_tokens) ||
        !parse_int("--judge-batch", config.judge_batch_size) ||
        !parse_int("--generation-attempts", config.generation_attempts) ||
        !parse_int("--judge-attempts", config.judge_attempts) ||
        !parse_int("--max-parallel", config.max_parallel_branches)) {
        return fail(2, parse_error + "\n");
    }

    const std::string out = optional_flag_value(args, "--out");
    if (!out.empty()) {
        config.output_dir = out;
    } else {
        std::ostringstream batch_name;
        batch_name << "batch-" << std::setw(3) << std::setfill('0') << config.offset
                   << "-" << std::setw(3) << std::setfill('0') << (config.offset + config.limit);
        config.output_dir = std::filesystem::path("runs") / "draco" / config.tier / batch_name.str();
    }

    auto result = run_draco_batch(config);
    if (!result) return fail(1, result.error().message + "\n");
    std::ostringstream ss;
    ss << result.value().to_markdown()
       << "\nsummary_json=" << (config.output_dir / "summary.json").string() << "\n"
       << "summary_markdown=" << (config.output_dir / "summary.md").string() << "\n"
       << "manifest=" << (config.output_dir / "manifest.json").string() << "\n";
    if (has_flag(args, "--json")) ss << "\n" << result.value().to_json().dump(2) << "\n";
    return result.value().failed_tasks == 0 ? ok(ss.str())
                                            : CliResult{1, ss.str(), "DRACO batch has failed or partial tasks\n"};
}

CliResult cmd_train(const std::vector<std::string>& args) {
    using namespace train;
    // train | train distill | train run | train pipeline | train help
    std::string sub = (args.size() >= 2) ? args[1] : "pipeline";
    if (sub == "help" || sub == "-h" || sub == "--help") {
        return ok(
            "train — distill / SFT job helpers (offline-first)\n\n"
            "  train pipeline [--out DIR] [--prompt P]...   distill+echo train (default)\n"
            "  train distill  [--out DIR] [--prompt P]...\n"
            "  train run --dataset PATH [--out DIR] [--backend echo|process]\n"
            "             [--epochs N] [--extra ARG]... | -- <argv...>\n"
            "  train dataset --prompt P [--prompt P2] --out file.jsonl\n\n"
            "Process backend argv (placeholders: {dataset} {output_dir} {epochs} {job_id}):\n"
            "  --extra ARG   repeatable; each ARG is one argv token (may be a flag)\n"
            "  -- ...        everything after bare -- is the trainer argv\n"
            "Defaults: provider/teacher=echo, backend=echo. No GPU/network required.\n"
        );
    }

    const auto out_root = default_out_dir(args) / "train";
    std::vector<std::string> prompts;
    for (std::size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == "--prompt") prompts.push_back(args[i + 1]);
    }
    if (prompts.empty()) {
        prompts = {
            "Explain structured multi-agent handoffs in one sentence.",
            "What is supervised fine-tuning (SFT)?",
        };
    }

    if (sub == "dataset") {
        const std::string out_flag = optional_flag_value(args, "--out");
        const auto path = out_flag.empty() ? (out_root / "dataset.jsonl")
                                           : std::filesystem::path(out_flag);
        auto examples = examples_from_prompts(prompts);
        auto ds = save_jsonl(path, examples, "cli_dataset");
        if (!ds) return fail(1, ds.error().message);
        std::ostringstream ss;
        ss << "train dataset ok\n"
           << "path=" << ds.value().path.string() << "\n"
           << "count=" << ds.value().count << "\n"
           << "content_hash=" << ds.value().content_hash << "\n"
           << "success=true\n";
        return ok(ss.str());
    }

    if (sub == "distill") {
        const std::string out_flag = optional_flag_value(args, "--out");
        DistillConfig dcfg;
        dcfg.output_jsonl =
            out_flag.empty() ? (out_root / "student.jsonl") : std::filesystem::path(out_flag);
        auto teacher = EchoProvider("cli-teacher").as_any();
        auto d = distill_generate(teacher, prompts, dcfg);
        if (!d) return fail(1, d.error().message);
        std::ostringstream ss;
        ss << "train distill ok\n"
           << "teacher_calls=" << d.value().teacher_calls << "\n"
           << "example_count=" << d.value().examples.size() << "\n"
           << "dataset_path=" << d.value().dataset.path.string() << "\n"
           << "content_hash=" << d.value().dataset.content_hash << "\n"
           << "success=true\n";
        return ok(ss.str());
    }

    if (sub == "run") {
        const std::string dataset_path = train_run_flag(args, "--dataset");
        if (dataset_path.empty()) {
            return fail(2, "train run requires --dataset PATH");
        }
        const std::string out_flag = train_run_flag(args, "--out");
        const std::string backend_id = train_run_flag(args, "--backend");
        const std::string epochs_s = train_run_flag(args, "--epochs");
        TrainJobSpec job;
        job.job_id = train_run_flag(args, "--job-id");
        if (job.job_id.empty()) job.job_id = "cli-train-run";
        job.kind = TrainJobKind::Sft;
        job.dataset.path = dataset_path;
        job.dataset.id = std::filesystem::path(dataset_path).stem().string();
        job.config.output_dir =
            out_flag.empty() ? (out_root / "run_out") : std::filesystem::path(out_flag);
        job.config.backend_id = backend_id.empty() ? "echo" : backend_id;
        if (!epochs_s.empty()) {
            try {
                job.config.epochs = std::stoi(epochs_s);
            } catch (...) {
                return fail(2, "train run --epochs must be an integer");
            }
        }
        job.config.extra_args = collect_train_extra_args(args);
        if (job.config.backend_id == "process" && job.config.extra_args.empty()) {
            return fail(
                2,
                "train run --backend process requires trainer argv via "
                "repeated --extra ARG or: -- <cmd> [args...]"
            );
        }
        auto backend = make_train_backend(job.config.backend_id);
        auto run = run_train_job(job, *backend);
        if (!run) return fail(1, run.error().message);
        std::ostringstream ss;
        ss << "train run ok\n"
           << "backend=" << run.value().report.backend_id << "\n"
           << "success=" << (run.value().report.success ? "true" : "false") << "\n"
           << "final_loss=" << run.value().report.metrics.final_loss << "\n"
           << "steps=" << run.value().report.metrics.steps << "\n"
           << "report_path=" << run.value().report_path.string() << "\n";
        if (!run.value().report.success) {
            ss << "error=" << run.value().report.error << "\n";
            return CliResult{1, ss.str(), run.value().report.error};
        }
        return ok(ss.str());
    }

    // default: pipeline
    if (sub != "pipeline" && sub != "train" && args.size() >= 2 && args[1].rfind("--", 0) != 0) {
        // unknown sub if not a flag after train
        if (args[1] != "pipeline" && args[1] != "distill" && args[1] != "run" &&
            args[1] != "dataset" && args[1] != "help") {
            // treat first non-flag as pipeline still if it's not known - already handled
        }
    }
    DistillThenTrainConfig cfg;
    const std::string out_flag = optional_flag_value(args, "--out");
    const auto base = out_flag.empty() ? out_root : std::filesystem::path(out_flag);
    cfg.distill.output_jsonl = base / "student.jsonl";
    cfg.train.output_dir = base / "train_out";
    cfg.train.epochs = 1;
    cfg.job_id_prefix = "cli_pipe";
    auto teacher = EchoProvider("cli-teacher").as_any();
    EchoTrainBackend student;
    auto pipe = distill_then_train(teacher, prompts, student, cfg);
    if (!pipe) return fail(1, pipe.error().message);
    std::ostringstream ss;
    ss << "train pipeline ok\n"
       << "distill_examples=" << pipe.value().distill.examples.size() << "\n"
       << "dataset_path=" << pipe.value().distill.dataset.path.string() << "\n"
       << "train_success=" << (pipe.value().train.report.success ? "true" : "false") << "\n"
       << "final_loss=" << pipe.value().train.report.metrics.final_loss << "\n"
       << "report_path=" << pipe.value().train.report_path.string() << "\n"
       << "success=true\n";
    return ok(ss.str());
}

}  // namespace

std::string help_text() {
    std::ostringstream ss;
    ss << "handoffkit-cli " << version() << " — offline multi-agent handoff toolkit\n\n"
       << "Usage:\n"
       << "  handoffkit-cli <command> [args]\n\n"
       << "Commands:\n"
       << "  help                 Show this help\n"
       << "  version              Print version\n"
       << "  doctor               Offline self-check\n"
       << "  demos                List demo ids\n"
       << "  demo <id>            Run a demo (see demos)\n"
       << "      --out DIR        Artifact directory (default runs/cpp-cli)\n"
       << "      --case ID        Optional corpus case id\n"
       << "      --no-write       Skip writing artifacts\n"
       << "  explore fixture|fetch|crawl|tools   Native web explorer (injectable transport)\n"
       << "  team [case]          Quick 3-agent team handoff demo\n"
       << "  tools [list]         Run tools demo or list tool names\n"
       << "  validate [file|--sample-good|--sample-bad]\n"
       << "  quality [file]       Score handoff quality offline\n"
       << "  report <file.json>   Load and display a report JSON\n"
       << "  cases [--domain D]   List offline case corpus entries\n"
       << "  templates [list|id]  List/run workflow templates\n"
       << "  evaluate [out.json]  Evaluate a team run offline\n"
       << "  replay <file> [--reexecute]\n"
       << "  parse-structured <file>\n"
       << "  providers [list|show <name>|resolve <name>|models <name>]\n"
       << "  generate --provider <name> --prompt \"...\" [--model M]\n"
       << "      Live LLM call (needs HANDOFFKIT_WITH_HTTP=ON + API key). Keep under rate limits.\n"
       << "  benchmark draco validate|run   Native DRACO JSONL benchmark, resume, judge, reports\n"
       << "      run --dataset PATH --tier baseline|lite|medium|pro|ultra|genius --offset N --limit N\n"
       << "  train [pipeline|distill|run|dataset|help]   Distill/SFT jobs (core train/, offline echo)\n"
       << "         [--out DIR] [--prompt P] [--dataset PATH] [--backend echo|process]\n"
       << "  fusion [--provider echo|nvidia|...] [--profile neutral|shipping|diagnostic|...]\n"
       << "         [--config FILE] [--prompt-config FILE] [--role-file FILE]\n"
       << "         [--tier lite|medium|pro|ultra|genius] [--mode lean|ultra|dag|panel]\n"
       << "         [--branches N] [--parallel-branches|--no-parallel-branches] [--max-parallel N]\n"
       << "         [--branch-tokens N] [--skeptic-tokens N] [--merge-tokens N] [--meta-tokens N]\n"
       << "         [--thinking enabled|disabled] [--reasoning-effort high|max]\n"
       << "         [--temperature X] [--top-p X] [--max-calls N] [--overlap-threshold X]\n"
       << "         [--models m1,m2,m3,m4] [--model-a A] [--model-b B] [--model-merge M]\n"
       << "         [--no-panel-judge] [--meta-judge] [--no-early-stop] [--no-anti-dilution]\n"
       << "         [--web] [--web-transport http|map] [--seed-url URL] [--web-query Q]\n"
       << "         [--web-max-pages N] [--no-web-search]\n"
       << "  fusion war-room [--provider echo] [--tiers lite,medium,pro,ultra] [--prompt ...]\n"
       << "                  [--profile research] [--json]   # multi-tier native compare (fast echo)\n"
       << "         [--model M] [--prompt \"...\"] [--out DIR]\n"
       << "         [--ultra] [--cache-dir D] [--no-cache]\n"
       << "      Tiers: Lite/Medium=lean(3), Pro=ultra(5), Ultra=DAG4(5), Genius=DAG6+meta(8).\n"
       << "  fusion profiles | fusion modes | fusion tiers\n"
       << "  fusion roles [--profile neutral] [--pack incident|product] [--file pack.json]\n"
       << "  fusion explain [--tier medium] [--mode lean|ultra|dag] [--profile neutral]\n\n"
       << demos::list_demos_text()
       << "\n" << templates::list_templates_text();
    return ss.str();
}

std::string version_text() {
    return std::string("handoffkit ") + version() + "\n";
}

std::vector<std::string> command_names() {
    return {
        "help", "version", "doctor", "demos", "demo", "explore", "team", "tools",
        "validate", "quality", "report", "cases",
        "templates", "evaluate", "replay", "parse-structured", "providers", "generate",
        "benchmark", "train", "fusion",
    };
}

CliResult run_cli(const std::vector<std::string>& args) {
    if (args.empty() || args[0] == "help" || args[0] == "-h" || args[0] == "--help") {
        return cmd_help();
    }
    if (args[0] == "version" || args[0] == "--version" || args[0] == "-V") {
        return cmd_version();
    }
    if (args[0] == "doctor") return cmd_doctor();
    if (args[0] == "demos") return cmd_list_demos();
    if (args[0] == "demo") return cmd_demo(args);
    if (args[0] == "explore") return cmd_explore(args);
    if (args[0] == "team") return cmd_team(args);
    if (args[0] == "tools") return cmd_tools(args);
    if (args[0] == "validate") return cmd_validate(args);
    if (args[0] == "quality") return cmd_quality(args);
    if (args[0] == "report") return cmd_report(args);
    if (args[0] == "cases") return cmd_list_cases(args);
    if (args[0] == "templates") return cmd_templates(args);
    if (args[0] == "evaluate") return cmd_evaluate(args);
    if (args[0] == "replay") return cmd_replay(args);
    if (args[0] == "parse-structured") return cmd_parse_structured(args);
    if (args[0] == "providers") return cmd_providers(args);
    if (args[0] == "generate") return cmd_generate(args);
    if (args[0] == "benchmark") return cmd_benchmark(args);
    if (args[0] == "train") return cmd_train(args);
    if (args[0] == "fusion") return cmd_fusion(args);
    return fail(2, "Unknown command: " + args[0] + "\n\n" + help_text());
}

}  // namespace cli
}  // namespace handoffkit
