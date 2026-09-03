#pragma once

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/error.hpp>

#include <functional>
#include <string>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct ScenarioResult {
    std::string id;
    bool passed = false;
    std::string message;
    nlohmann::json details = nlohmann::json::object();
    nlohmann::json to_json() const;
};

struct ScenarioSpec {
    std::string id;
    std::string title;
    std::string description;
    std::function<Result<ScenarioResult>()> run;
};

[[nodiscard]] std::vector<ScenarioSpec> all_fusion_scenarios();
[[nodiscard]] std::vector<std::string> fusion_scenario_ids();
Result<ScenarioResult> run_fusion_scenario(std::string_view id);
Result<std::vector<ScenarioResult>> run_all_fusion_scenarios();

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
