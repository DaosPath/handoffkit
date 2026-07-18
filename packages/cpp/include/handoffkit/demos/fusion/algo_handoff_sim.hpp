#pragma once
#include <handoffkit/handoff.hpp>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>
#include <handoffkit/error.hpp>
namespace handoffkit { namespace demos { namespace fusion {
struct SimAgent {
  std::string name;
  std::string role;
};
struct SimHandoffEvent {
  std::string from_agent;
  std::string to_agent;
  std::string summary;
  std::vector<std::string> decisions;
  nlohmann::json to_json() const;
};
struct SimTrace {
  std::string task;
  std::vector<SimHandoffEvent> events;
  std::vector<HandoffState> states;
  nlohmann::json to_json() const;
};
// Simulate a linear handoff chain with HybridMin protocol
Result<SimTrace> simulate_linear_handoffs(const std::string& task, const std::vector<SimAgent>& chain, const std::vector<std::string>& summaries);
// Simulate dual-branch then merge handoffs like fusion ultra
Result<SimTrace> simulate_fusion_handoffs(const std::string& task, const std::string& a_sum, const std::string& b_sum, bool ultra);
// Metrics on simulated handoffs
nlohmann::json simulate_handoff_metrics(const SimTrace& tr);
}}}
