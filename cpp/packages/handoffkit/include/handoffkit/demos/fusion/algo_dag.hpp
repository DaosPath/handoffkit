#pragma once
#include <string>
#include <vector>
#include <nlohmann/json.hpp>
#include <handoffkit/error.hpp>
namespace handoffkit { namespace demos { namespace fusion {
struct DagNode {
  std::string id;
  std::string kind; // architect|skeptic|merge|tool
  std::vector<std::string> deps;
  int cost_ms = 1;
  nlohmann::json to_json() const;
};
struct DagGraph {
  std::vector<DagNode> nodes;
  nlohmann::json to_json() const;
  static Result<DagGraph> from_json(const nlohmann::json& j);
};
struct DagAnalysis {
  bool has_cycle = false;
  std::vector<std::string> topo_order;
  std::vector<std::string> critical_path;
  int critical_cost_ms = 0;
  std::vector<std::string> parallel_waves; // wave0:id,id; wave1:...
  nlohmann::json to_json() const;
};
Result<DagAnalysis> analyze_dag(const DagGraph& g);
// Build default fusion DAGs for modes
DagGraph make_fusion_dag_lean();
DagGraph make_fusion_dag_ultra();
DagGraph make_fusion_dag_multi(int branches);
// Validate that fusion mode matches call count expectations
Result<int> expected_llm_calls_for_dag(const DagGraph& g);
}}}
