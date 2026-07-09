#include <handoffkit/handoff.hpp>
#include <cassert>
#include <fstream>
#include <iostream>

using namespace handoffkit;

nlohmann::json fixture(const std::string& name) {
    std::ifstream input("../../contracts/fixtures/" + name);
    assert(input.good());
    nlohmann::json data;
    input >> data;
    return data;
}

void test_handoff_state_roundtrip() {
    HandoffState state;
    state.task = "Build package";
    state.from_agent = "Architect";
    state.to_agent = "Coder";
    state.summary = "Plan complete";
    state.decisions = {"Use C++"};
    state.important_files = {"CMakeLists.txt"};
    state.errors = {};
    state.next_steps = {"Write code"};
    state.context_refs = {"README.md"};

    std::string md = state.to_markdown();
    HandoffState loaded = HandoffState::from_markdown(md);

    assert(loaded.task == state.task);
    assert(loaded.from_agent == state.from_agent);
    assert(loaded.to_agent == state.to_agent);
    assert(loaded.summary == state.summary);
    assert(loaded.decisions == state.decisions);
    assert(loaded.important_files == state.important_files);
    assert(loaded.errors == state.errors);
    assert(loaded.next_steps == state.next_steps);
    assert(loaded.context_refs == state.context_refs);

    std::cout << "test_handoff_state_roundtrip passed!" << std::endl;
}

void test_run_trace_timeline() {
    RunTrace trace;
    trace.run_id = "test-run";
    trace.name = "Test flow";
    trace.success = true;
    trace.final_output = "Finished";

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
    assert(timeline.find("1. [Architect] -> Task: Design API") != std::string::npos);

    std::cout << "test_run_trace_timeline passed!" << std::endl;
}

void test_shared_validation_report_fixture_roundtrip() {
    nlohmann::json data = fixture("validation_report.json");
    ValidationReport report = ValidationReport::from_json(data);

    assert(report.success == false);
    assert(report.issues.size() == 1);
    assert(report.issues[0].code == "missing_task");
    assert(report.to_json() == data);

    std::cout << "test_shared_validation_report_fixture_roundtrip passed!" << std::endl;
}

void test_shared_quality_report_fixture_roundtrip() {
    nlohmann::json data = fixture("quality_report.json");
    HandoffQualityReport report = HandoffQualityReport::from_json(data);

    assert(report.success == true);
    assert(report.grade == "B");
    assert(report.metrics.size() == 5);
    assert(report.to_json() == data);

    std::cout << "test_shared_quality_report_fixture_roundtrip passed!" << std::endl;
}

void test_shared_tool_call_and_result_fixtures_roundtrip() {
    nlohmann::json call_data = fixture("tool_call.json");
    nlohmann::json result_data = fixture("tool_result.json");
    ToolCall call = ToolCall::from_json(call_data);
    ToolResult result = ToolResult::from_json(result_data);

    assert(call.tool_name == "add");
    assert(call.call_id == "call-12345");
    assert(result.success == true);
    assert(result.result == 15);
    assert(call.to_json() == call_data);
    assert(result.to_json() == result_data);

    std::cout << "test_shared_tool_call_and_result_fixtures_roundtrip passed!" << std::endl;
}

void test_contract_parity_report_marks_supported_contracts() {
    ContractParityReport report = ContractParityReport::from_inventory(
        "cpp",
        "1.11.0",
        {"handoff_state", "run_trace", "validation_report", "quality_report"},
        {"handoff-state", "run-trace", "validation-report", "quality-report"}
    );

    assert(report.success == true);
    assert(report.fixture_count == 4);
    assert(report.to_markdown().find("Contract Parity Report") != std::string::npos);

    std::cout << "test_contract_parity_report_marks_supported_contracts passed!" << std::endl;
}

int main() {
    test_handoff_state_roundtrip();
    test_run_trace_timeline();
    test_shared_validation_report_fixture_roundtrip();
    test_shared_quality_report_fixture_roundtrip();
    test_shared_tool_call_and_result_fixtures_roundtrip();
    test_contract_parity_report_marks_supported_contracts();
    std::cout << "All C++ tests passed successfully!" << std::endl;
    return 0;
}
