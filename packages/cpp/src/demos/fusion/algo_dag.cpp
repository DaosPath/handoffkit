#include <handoffkit/demos/fusion/algo_dag.hpp>
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <sstream>
namespace handoffkit { namespace demos { namespace fusion {

nlohmann::json DagNode::to_json() const {
  return nlohmann::json{{"id",id},{"kind",kind},{"deps",deps},{"cost_ms",cost_ms}};
}
nlohmann::json DagGraph::to_json() const {
  nlohmann::json arr=nlohmann::json::array();
  for (const auto& n: nodes) arr.push_back(n.to_json());
  return nlohmann::json{{"nodes", std::move(arr)}};
}
Result<DagGraph> DagGraph::from_json(const nlohmann::json& j) {
  if (!j.is_object() || !j.contains("nodes")) return Result<DagGraph>::failure(Error::parse_error("dag nodes"));
  DagGraph g;
  for (const auto& item: j.at("nodes")) {
    DagNode n;
    n.id = item.value("id","");
    n.kind = item.value("kind","");
    n.cost_ms = item.value("cost_ms",1);
    if (item.contains("deps")) for (const auto& d: item.at("deps")) n.deps.push_back(d.get<std::string>());
    if (n.id.empty()) return Result<DagGraph>::failure(Error::parse_error("empty node id"));
    g.nodes.push_back(std::move(n));
  }
  return g;
}
nlohmann::json DagAnalysis::to_json() const {
  return nlohmann::json{
    {"has_cycle", has_cycle},
    {"topo_order", topo_order},
    {"critical_path", critical_path},
    {"critical_cost_ms", critical_cost_ms},
    {"parallel_waves", parallel_waves},
  };
}

Result<DagAnalysis> analyze_dag(const DagGraph& g) {
  DagAnalysis out;
  std::unordered_map<std::string,int> idx;
  for (int i=0;i<(int)g.nodes.size();++i) idx[g.nodes[i].id]=i;
  // validate deps exist
  for (const auto& n: g.nodes) {
    for (const auto& d: n.deps) {
      if (!idx.count(d)) return Result<DagAnalysis>::failure(Error::invalid_argument("missing dep "+d,"deps"));
    }
  }
  std::vector<int> indeg(g.nodes.size(),0);
  std::vector<std::vector<int>> adj(g.nodes.size());
  for (int i=0;i<(int)g.nodes.size();++i) {
    for (const auto& d: g.nodes[i].deps) {
      int j = idx[d];
      adj[j].push_back(i);
      indeg[i]++;
    }
  }
  std::queue<int> q;
  for (int i=0;i<(int)indeg.size();++i) if (indeg[i]==0) q.push(i);
  std::vector<int> dist(g.nodes.size(),0);
  std::vector<int> parent(g.nodes.size(),-1);
  int seen=0;
  std::vector<std::vector<std::string>> waves;
  while (!q.empty()) {
    // process current indeg0 wave
    int sz = (int)q.size();
    std::vector<std::string> wave;
    std::vector<int> cur;
    for (int k=0;k<sz;++k) { int u=q.front(); q.pop(); cur.push_back(u); }
    for (int u: cur) {
      ++seen;
      wave.push_back(g.nodes[u].id);
      out.topo_order.push_back(g.nodes[u].id);
      for (int v: adj[u]) {
        // Longest path: dist[v] stores cost accumulated before v.
        int base = dist[u] + g.nodes[u].cost_ms;
        if (base > dist[v]) { dist[v]=base; parent[v]=u; }
        if (--indeg[v]==0) q.push(v);
      }
    }
    // format wave
    std::ostringstream ss;
    for (size_t i=0;i<wave.size();++i){ if(i) ss<<","; ss<<wave[i]; }
    out.parallel_waves.push_back(ss.str());
  }
  if (seen != (int)g.nodes.size()) {
    out.has_cycle = true;
    return out;
  }
  // critical path: node with max dist+cost
  int best=-1, bestv=-1;
  for (int i=0;i<(int)g.nodes.size();++i) {
    int v = dist[i] + g.nodes[i].cost_ms;
    if (v>bestv) { bestv=v; best=i; }
  }
  out.critical_cost_ms = bestv;
  // rebuild path
  std::vector<std::string> path;
  for (int x=best; x!=-1; x=parent[x]) path.push_back(g.nodes[x].id);
  std::reverse(path.begin(), path.end());
  out.critical_path = std::move(path);
  return out;
}

DagGraph make_fusion_dag_lean() {
  DagGraph g;
  g.nodes = {
    {"a_arch","architect",{},10},
    {"b_arch","architect",{},10},
    {"merge","merge",{"a_arch","b_arch"},15},
  };
  return g;
}
DagGraph make_fusion_dag_ultra() {
  DagGraph g;
  g.nodes = {
    {"a_arch","architect",{},10},
    {"b_arch","architect",{},10},
    {"a_sk","skeptic",{"a_arch"},8},
    {"b_sk","skeptic",{"b_arch"},8},
    {"merge","merge",{"a_sk","b_sk"},15},
  };
  return g;
}
DagGraph make_fusion_dag_multi(int branches) {
  if (branches < 2) branches = 2;
  if (branches > 8) branches = 8;
  DagGraph g;
  std::vector<std::string> arch_ids;
  for (int i=0;i<branches;++i) {
    std::string id = "arch"+std::to_string(i);
    g.nodes.push_back({id,"architect",{},10});
    arch_ids.push_back(id);
  }
  g.nodes.push_back({"merge","merge",arch_ids,20});
  return g;
}

Result<int> expected_llm_calls_for_dag(const DagGraph& g) {
  int n=0;
  for (const auto& node: g.nodes) {
    if (node.kind=="architect"||node.kind=="skeptic"||node.kind=="merge") ++n;
  }
  if (n<1) return Result<int>::failure(Error::invalid_argument("empty dag"));
  return n;
}

}}}
