#include <handoffkit/handoffkit.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

std::filesystem::path scratch_dir() {
#ifdef HANDOFFKIT_TEST_SCRATCH
    return std::filesystem::path(HANDOFFKIT_TEST_SCRATCH) / "cpp-reports";
#else
    return std::filesystem::temp_directory_path() / "handoffkit-cpp-report-tests";
#endif
}

void test_agent_memory_records_turns() {
    Agent agent("Coder", "Implements", EchoProvider().as_any());
    auto out = agent.run("first task");
    assert(out);
    assert(agent.memory().size() == 2);
    assert(agent.memory().entries()[0].role == "user");
    assert(agent.memory().entries()[1].role == "assistant");
    assert(agent.memory().to_text().find("first task") != std::string::npos);
    std::cout << "test_agent_memory_records_turns passed!" << std::endl;
}

void test_team_trace_and_report_json() {
    std::vector<Agent> agents;
    agents.emplace_back("Architect", "Designs", EchoProvider().as_any());
    agents.emplace_back("Coder", "Implements", EchoProvider().as_any());

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto result = team.run("Ship C++ packaging");
    assert(result);
    assert(result.value().success);
    assert(!result.value().final_output.empty());
    assert(result.value().handoffs.size() == 1);

    auto wire = result.value().to_json();
    assert(wire.contains("task"));
    assert(wire.contains("final_output"));
    assert(wire.contains("handoffs"));
    assert(wire.contains("agent_outputs"));
    assert(wire.at("task") == "Ship C++ packaging");

    RunTrace trace = build_run_trace("run-cpp-1", "team_demo", result.value(), "hybrid_state");
    assert(trace.steps.size() == 2);
    assert(trace.handoffs.size() == 1);
    assert(trace.to_json().at("run_id") == "run-cpp-1");
    assert(trace.to_json().at("final_output").is_string());

    const auto dir = scratch_dir();
    auto written = write_report_files(dir, "team_demo", trace);
    assert(written);
    auto loaded = load_report_json(dir / "team_demo.json");
    assert(loaded);
    assert(loaded.value().at("run_id") == "run-cpp-1");
    assert(loaded.value().at("final_output").get<std::string>() == result.value().final_output);

    auto team_path = write_report_json(dir / "team_result.json", result.value());
    assert(team_path);
    auto team_loaded = load_report_json(dir / "team_result.json");
    assert(team_loaded);
    assert(team_loaded.value().at("final_output").is_string());
    assert(!team_loaded.value().at("final_output").get<std::string>().empty());

    std::cout << "test_team_trace_and_report_json passed!" << std::endl;
}

void test_all_protocol_modes_on_team_path() {
    const ProtocolMode modes[] = {
        ProtocolMode::Natural,
        ProtocolMode::Compressed,
        ProtocolMode::HybridMin,
        ProtocolMode::HybridState,
    };
    for (auto mode : modes) {
        std::vector<Agent> agents;
        agents.emplace_back("A", "role a", EchoProvider().as_any());
        agents.emplace_back("B", "role b", EchoProvider().as_any());
        Team team(std::move(agents), HandoffProtocol(mode));
        auto result = team.run("mode check");
        assert(result);
        assert(result.value().handoffs.size() == 1);
        assert(result.value().handoffs[0].metadata.at("mode") == protocol_mode_name(mode));
    }
    std::cout << "test_all_protocol_modes_on_team_path passed!" << std::endl;
}

}  // namespace

int main() {
    test_agent_memory_records_turns();
    test_team_trace_and_report_json();
    test_all_protocol_modes_on_team_path();
    std::cout << "All memory/trace/report tests passed!" << std::endl;
    return 0;
}
