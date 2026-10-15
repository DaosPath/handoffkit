#pragma once

#include <handoffkit/demos/cases.hpp>
#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/error.hpp>
#include <handoffkit/evaluation/workflow_eval.hpp>
#include <handoffkit/runtime/orchestrator.hpp>
#include <handoffkit/runtime/policy.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {

struct ScenarioPhase {
    std::string name;
    std::string kind;  // team|tools|orchestrator|eval|gallery|policy
    nlohmann::json config = nlohmann::json::object();
};

struct Scenario {
    std::string id;
    std::string title;
    std::string description;
    std::string case_id;  // optional corpus link
    std::vector<ScenarioPhase> phases;
};

struct ScenarioPhaseResult {
    std::string name;
    bool success = false;
    nlohmann::json output = nlohmann::json::object();
    std::string notes;
};

struct ScenarioRunResult {
    bool success = false;
    std::string scenario_id;
    std::string task;
    std::string final_output;
    std::vector<ScenarioPhaseResult> phases;
    std::vector<HandoffState> handoffs;
    RunTrace trace;
    nlohmann::json report = nlohmann::json::object();
    nlohmann::json to_json() const;
};

class ScenarioEngine {
public:
    Result<ScenarioRunResult> run(const Scenario& scenario, const DemoOptions& options = {});

    static std::vector<Scenario> catalog();
    static Scenario support_full_scenario();
    static Scenario coding_full_scenario();
    static Scenario release_readiness_scenario();
    static Scenario policy_guard_scenario();
    static Scenario multi_domain_scenario();
};

// Declarations without defaults (defaults live in demo_types.hpp)
Result<DemoResult> run_scenario_engine_demo(const DemoOptions& options);
Result<DemoResult> run_policy_guard_demo(const DemoOptions& options);
Result<DemoResult> run_report_gallery_demo(const DemoOptions& options);
Result<DemoResult> run_release_readiness_demo(const DemoOptions& options);

}  // namespace demos
}  // namespace handoffkit
