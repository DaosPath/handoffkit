#pragma once

#include <handoffkit/demos/fusion/scenarios.hpp>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

[[nodiscard]] std::vector<ScenarioSpec> all_fusion_scenarios_deep();
Result<std::vector<ScenarioResult>> run_all_fusion_scenarios_deep();

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
