#include <handoffkit/io/reports.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/replay.hpp>
#include <handoffkit/runtime/structured.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/util/text.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

std::filesystem::path scratch() {
#ifdef HANDOFFKIT_TEST_SCRATCH
    return std::filesystem::path(HANDOFFKIT_TEST_SCRATCH) / "structured-replay";
#else
    return std::filesystem::temp_directory_path() / "handoffkit-structured-replay";
#endif
}

void test_json_extract_and_repair() {
    const std::string dirty =
        "prefix\n```json\n{ 'goal': 'Ship', 'steps': ['a', 'b'], 'owners': ['x'], }\n```\nsuffix";
    auto repaired = parse_agent_structured(dirty, action_plan_schema(), true);
    assert(repaired.success);
    assert(repaired.value.at("goal") == "Ship");
    assert(repaired.value.at("steps").is_array());
    assert(!repaired.repairs.empty());

    auto clean = parse_agent_structured(
        "{\"rankings\":[{\"n\":1}],\"notes\":\"ok\"}",
        rankings_schema(),
        false
    );
    assert(clean.success);
    std::cout << "test_json_extract_and_repair passed\n";
}

void test_text_utilities() {
    assert(text::trim("  hi  ") == "hi");
    assert(text::word_count("one two three") == 3);
    assert(text::looks_like_action("Implement unit tests"));
    assert(text::jaccard_words("alpha beta", "beta gamma") > 0.0);
    assert(text::levenshtein("kitten", "sitting") == 3);
    auto top = text::top_terms("handoff handoff quality quality quality metrics", 3);
    assert(!top.empty());
    assert(text::slugify("Hello World!") == "hello-world");
    std::cout << "test_text_utilities passed\n";
}

void test_replay_from_team_trace_file() {
    std::vector<Agent> agents = {
        Agent("Architect", "d", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
        Agent("Reviewer", "r", EchoProvider().as_any()),
    };
    Team team({
        Agent("Architect", "d", EchoProvider().as_any()),
        Agent("Coder", "c", EchoProvider().as_any()),
        Agent("Reviewer", "r", EchoProvider().as_any()),
    }, HandoffProtocol(ProtocolMode::HybridState));
    auto tr = team.run("Replayable packaging task");
    assert(tr);
    auto trace = build_run_trace("replay-1", "pkg", tr.value(), "hybrid_state");
    const auto path = scratch() / "trace.json";
    auto written = write_report_json(path, trace);
    assert(written);

    ReplayRunner runner(std::move(agents));
    ReplayOptions opt;
    opt.reexecute_agents = true;
    opt.revalidate_handoffs = true;
    opt.rescore_quality = true;
    auto report = runner.replay_file(path, opt);
    assert(report);
    assert(report.value().success);
    assert(report.value().to_json().contains("steps"));
    assert(report.value().to_json().contains("source_run_id"));
    assert(report.value().source_run_id == "replay-1");
    assert(!report.value().timeline.empty());
    std::cout << "test_replay_from_team_trace_file passed\n";
}

void test_schemas_and_suffix() {
    auto suffix = structured_prompt_suffix(incident_update_schema());
    assert(suffix.find("severity") != std::string::npos);
    auto bad = validate_structured(nlohmann::json::array(), action_plan_schema());
    assert(!bad.success);
    std::cout << "test_schemas_and_suffix passed\n";
}

}  // namespace

int main() {
    test_json_extract_and_repair();
    test_text_utilities();
    test_replay_from_team_trace_file();
    test_schemas_and_suffix();
    std::cout << "All structured/replay/text tests passed\n";
    return 0;
}
