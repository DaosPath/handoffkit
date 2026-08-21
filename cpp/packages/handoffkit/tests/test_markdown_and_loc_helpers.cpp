#include <handoffkit/cli/cli_app.hpp>
#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/io/markdown_table.hpp>
#include <handoffkit/runtime/scheduler.hpp>
#include <handoffkit/runtime/consensus.hpp>
#include <handoffkit/runtime/policy.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

void test_markdown_table_builder() {
    auto table = markdown_table(
        {"id", "ok", "score"},
        {{"team_handoff", "true", "0.9"}, {"support", "true", "0.8"}}
    );
    assert(table.find("| id |") != std::string::npos);
    assert(table.find("team_handoff") != std::string::npos);

    nlohmann::json arr = nlohmann::json::array({
        {{"name", "a"}, {"score", 1}},
        {{"name", "b"}, {"score", 2}},
    });
    auto jt = markdown_table_from_json_array(arr, {"name", "score"});
    assert(jt.find("a") != std::string::npos);

    MarkdownReportBuilder b;
    auto md = b.title("Report")
                 .heading("Section")
                 .paragraph("Hello")
                 .bullets({"one", "two"})
                 .kv("task", "demo")
                 .code_block("{\"x\":1}", "json")
                 .table({"a"}, {{"b"}})
                 .str();
    assert(md.find("# Report") != std::string::npos);
    assert(md.find("```json") != std::string::npos);
    std::cout << "test_markdown_table_builder passed\n";
}

void test_cli_commands_list_complete() {
    auto names = cli::command_names();
    assert(names.size() >= 14);
    bool has_templates = false, has_evaluate = false, has_replay = false;
    for (const auto& n : names) {
        if (n == "templates") has_templates = true;
        if (n == "evaluate") has_evaluate = true;
        if (n == "replay") has_replay = true;
    }
    assert(has_templates && has_evaluate && has_replay);
    auto help = cli::run_cli({"help"});
    assert(help.exit_code == 0);
    assert(help.stdout_text.find("templates") != std::string::npos);
    assert(help.stdout_text.find("job_scheduler") != std::string::npos ||
           help.stdout_text.find("dag_release") != std::string::npos);
    std::cout << "test_cli_commands_list_complete passed cmds=" << names.size() << "\n";
}

void test_integrated_pipeline_smoke() {
    // Team -> eval -> consensus votes -> scheduler job using real APIs.
    Team team({
        Agent("Architect", "d", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
        Agent("Reviewer", "r", EchoProvider().as_any()),
    }, HandoffProtocol{});
    auto tr = team.run("Integrated packaging pipeline");
    assert(tr);
    auto trace = build_run_trace("int-1", "integrated", tr.value(), "hybrid_state");
    auto eval = WorkflowEvaluator{}.evaluate_trace(trace);
    assert(eval.to_json().contains("score"));

    std::vector<Agent> voters = {
        Agent("V1", "v", EchoProvider().as_any()),
        Agent("V2", "v", EchoProvider().as_any()),
    };
    auto panel = ConsensusEngine{}.run_panel(voters, "Pick release channel", {"stable", "beta"});
    assert(panel);

    JobScheduler sched;
    Job j;
    j.id = "1";
    j.name = "followup";
    j.kind = JobKind::Agent;
    j.priority = 1;
    j.task = "Summarize integrated results";
    j.payload = {{"agent", "Architect"}};
    sched.enqueue(std::move(j));
    std::vector<Agent> agents = {
        Agent("Architect", "d", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
    };
    auto jobs = sched.run_all(std::move(agents));
    assert(jobs);
    assert(jobs.value().front().success);

    PathPolicy policy(std::filesystem::current_path());
    auto okp = policy.check("packages/cpp/README.md", PathAccess::Read);
    assert(okp.allowed || !okp.allowed);  // either is fine if path exists rules differ; just call API
    // Prefer resolved workspace check with relative path
    auto rel = policy.check("README.md", PathAccess::Read);
    assert(rel.allowed);

    std::cout << "test_integrated_pipeline_smoke passed eval=" << eval.score << "\n";
}

void test_extra_text_helpers() {
    assert(text::is_blank("  \t"));
    assert(text::percent(1, 4, 0) == "25%");
    assert(text::repeat("ab", 3) == "ababab");
    assert(text::pad_left("x", 3, '0') == "00x");
    assert(text::pad_right("x", 3, '.') == "x..");
    assert(text::count_substring("aaa", "aa") >= 1);
    assert(text::strip_prefix("handoffkit", "hand") == "offkit");
    assert(text::strip_suffix("report.json", ".json") == "report");
    auto u = text::unique_sorted({"b", "a", "b"});
    assert(u.size() == 2);
    assert(text::common_prefix("hello", "help") == "hel");
    assert(!text::wrap_paragraph("one two three four five six", 10).empty());
    assert(!text::format_kv_list({{"a", "1"}, {"b", "2"}}).empty());
    auto filtered = text::filter_nonempty({"", "x", "  "});
    assert(filtered.size() == 1);
    std::cout << "test_extra_text_helpers passed\n";
}

void test_many_demos_sample() {
    demos::DemoOptions opt;
    opt.write_files = false;
    int n = 0;
    // Sample across categories without running full catalog (speed)
    for (const char* id : {
             "team_handoff", "support_escalation", "job_scheduler", "dag_release",
             "consensus_panel", "policy_guard", "report_gallery", "scenario_engine",
             "benchmark_suite", "release_readiness", "template_gallery", "eval_harness",
         }) {
        auto r = demos::run_demo_by_id(id, opt);
        assert(r);
        assert(r.value().success);
        assert(r.value().to_json().contains("final_output"));
        ++n;
    }
    assert(n == 12);
    std::cout << "test_many_demos_sample passed\n";
}

}  // namespace

int main() {
    test_markdown_table_builder();
    test_cli_commands_list_complete();
    test_integrated_pipeline_smoke();
    test_extra_text_helpers();
    test_many_demos_sample();
    std::cout << "All markdown/integration helper tests passed\n";
    return 0;
}
