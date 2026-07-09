#include <handoffkit/handoff.hpp>
#include <cassert>
#include <iostream>

using namespace handoffkit;

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

int main() {
    test_handoff_state_roundtrip();
    test_run_trace_timeline();
    std::cout << "All C++ tests passed successfully!" << std::endl;
    return 0;
}
