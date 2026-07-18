#include <handoffkit/handoffkit.hpp>

#include <cassert>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

using namespace handoffkit;

namespace {

std::filesystem::path contracts_dir() {
#ifdef HANDOFFKIT_CONTRACTS_DIR
    return std::filesystem::path(HANDOFFKIT_CONTRACTS_DIR);
#else
    namespace fs = std::filesystem;
    const fs::path candidates[] = {
        fs::path("../../contracts"),
        fs::path("../../../contracts"),
        fs::path("../contracts"),
    };
    for (const auto& candidate : candidates) {
        if (fs::exists(candidate / "fixtures")) {
            return candidate;
        }
    }
    return fs::path("../../contracts");
#endif
}

nlohmann::json fixture(const std::string& name) {
    const auto path = contracts_dir() / "fixtures" / name;
    std::ifstream input(path);
    if (!input.good()) {
        std::cerr << "Missing fixture: " << path << std::endl;
        assert(false && "fixture not found");
    }
    nlohmann::json data;
    input >> data;
    return data;
}

void test_all_fixtures_roundtrip() {
    const std::vector<std::string> fixtures = {
        "handoff_state.json",
        "run_trace.json",
        "validation_report.json",
        "quality_report.json",
        "tool_call.json",
        "tool_result.json",
        "provider_tool_schema.json",
    };

    for (const auto& name : fixtures) {
        nlohmann::json data = fixture(name);
        if (name == "handoff_state.json") {
            auto obj = HandoffState::from_json(data);
            assert(obj.to_json() == data);
        } else if (name == "run_trace.json") {
            auto obj = RunTrace::from_json(data);
            assert(obj.to_json() == data);
        } else if (name == "validation_report.json") {
            auto obj = ValidationReport::from_json(data);
            assert(obj.to_json() == data);
        } else if (name == "quality_report.json") {
            auto obj = HandoffQualityReport::from_json(data);
            assert(obj.to_json() == data);
        } else if (name == "tool_call.json") {
            auto obj = ToolCall::from_json(data);
            assert(obj.to_json() == data);
        } else if (name == "tool_result.json") {
            auto obj = ToolResult::from_json(data);
            assert(obj.to_json() == data);
        } else if (name == "provider_tool_schema.json") {
            auto obj = ProviderToolSchema::from_json(data);
            assert(obj.to_json() == data);
        }
        std::cout << "  fixture ok: " << name << "\n";
    }
    std::cout << "test_all_fixtures_roundtrip passed!" << std::endl;
}

void test_handoff_state_markdown_roundtrip() {
    HandoffState state;
    state.task = "Build package";
    state.from_agent = "Architect";
    state.to_agent = "Coder";
    state.summary = "Plan complete";
    state.decisions = {"Use C++"};
    state.important_files = {"CMakeLists.txt"};
    state.next_steps = {"Write code"};
    state.context_refs = {"README.md"};

    HandoffState loaded = HandoffState::from_markdown(state.to_markdown());
    assert(loaded.task == state.task);
    assert(loaded.from_agent == state.from_agent);
    assert(loaded.to_agent == state.to_agent);
    assert(loaded.summary == state.summary);
    assert(loaded.decisions == state.decisions);
    std::cout << "test_handoff_state_markdown_roundtrip passed!" << std::endl;
}

void test_run_trace_timeline() {
    RunTrace trace;
    trace.run_id = "test-run";
    trace.name = "Test flow";
    trace.success = true;
    TraceStep step;
    step.name = "Step 1";
    step.agent = "Architect";
    step.task = "Design API";
    step.mode = "hybrid_state";
    step.success = true;
    step.output = "Designed";
    trace.steps.push_back(step);
    std::string timeline = trace.to_timeline();
    assert(timeline.find("Execution Timeline: Test flow") != std::string::npos);
    std::cout << "test_run_trace_timeline passed!" << std::endl;
}

void test_contract_parity_report() {
    ContractParityReport report = ContractParityReport::from_inventory(
        "cpp",
        version(),
        {"handoff_state", "run_trace", "validation_report", "quality_report",
         "tool_call", "tool_result", "provider_tool_schema"},
        {"handoff-state", "run-trace", "validation-report", "quality-report",
         "tool-call", "tool-result", "provider-tool-schema"}
    );
    assert(report.success);
    assert(report.fixture_count == 7);
    std::cout << "test_contract_parity_report passed!" << std::endl;
}

}  // namespace

int main() {
    test_all_fixtures_roundtrip();
    test_handoff_state_markdown_roundtrip();
    test_run_trace_timeline();
    test_contract_parity_report();
    std::cout << "All C++ contract tests passed successfully!" << std::endl;
    return 0;
}
