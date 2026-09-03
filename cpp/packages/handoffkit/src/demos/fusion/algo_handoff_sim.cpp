#include <handoffkit/demos/fusion/algo_handoff_sim.hpp>
#include <handoffkit/runtime/protocol.hpp>
namespace handoffkit { namespace demos { namespace fusion {

nlohmann::json SimHandoffEvent::to_json() const {
  return nlohmann::json{{"from_agent",from_agent},{"to_agent",to_agent},{"summary",summary},{"decisions",decisions}};
}
nlohmann::json SimTrace::to_json() const {
  nlohmann::json ev=nlohmann::json::array(); for(const auto& e:events) ev.push_back(e.to_json());
  nlohmann::json st=nlohmann::json::array(); for(const auto& s:states) st.push_back(s.to_json());
  return nlohmann::json{{"task",task},{"events",std::move(ev)},{"states",std::move(st)}};
}

Result<SimTrace> simulate_linear_handoffs(const std::string& task, const std::vector<SimAgent>& chain, const std::vector<std::string>& summaries) {
  if (chain.size() < 2) return Result<SimTrace>::failure(Error::invalid_argument("chain too short"));
  if (summaries.size() + 1 < chain.size()) return Result<SimTrace>::failure(Error::invalid_argument("need summaries between agents"));
  SimTrace tr; tr.task = task;
  HandoffProtocol protocol(ProtocolMode::HybridMin);
  for (size_t i=0;i+1<chain.size();++i) {
    TransferOptions t;
    t.task = task;
    t.from_agent = chain[i].name;
    t.to_agent = chain[i+1].name;
    t.summary = i < summaries.size() ? summaries[i] : ("step "+std::to_string(i));
    t.decisions = {"advance:"+chain[i].role};
    t.next_steps = {chain[i+1].name + " continues"};
    auto h = protocol.transfer(t);
    if (!h) return Result<SimTrace>::failure(h.error());
    SimHandoffEvent ev{t.from_agent,t.to_agent,t.summary,t.decisions};
    tr.events.push_back(std::move(ev));
    tr.states.push_back(std::move(h.value()));
  }
  return tr;
}

Result<SimTrace> simulate_fusion_handoffs(const std::string& task, const std::string& a_sum, const std::string& b_sum, bool ultra) {
  SimTrace tr; tr.task = task;
  HandoffProtocol protocol(ProtocolMode::HybridMin);
  TransferOptions t1;
  t1.task=task; t1.from_agent = ultra?"BranchA_Team":"BranchA_Architect"; t1.to_agent="Merger";
  t1.summary=a_sum; t1.decisions={"Explore branch A"}; if(ultra) t1.decisions.push_back("Incorporate skeptic A");
  t1.next_steps={"Merge with B"};
  auto h1 = protocol.transfer(t1); if(!h1) return Result<SimTrace>::failure(h1.error());
  TransferOptions t2;
  t2.task=task; t2.from_agent = ultra?"BranchB_Team":"BranchB_Architect"; t2.to_agent="Merger";
  t2.summary=b_sum; t2.decisions={"Explore branch B"}; if(ultra) t2.decisions.push_back("Incorporate skeptic B");
  t2.next_steps={"Merge with A"};
  auto h2 = protocol.transfer(t2); if(!h2) return Result<SimTrace>::failure(h2.error());
  tr.events.push_back({t1.from_agent,t1.to_agent,t1.summary,t1.decisions});
  tr.events.push_back({t2.from_agent,t2.to_agent,t2.summary,t2.decisions});
  tr.states.push_back(std::move(h1.value()));
  tr.states.push_back(std::move(h2.value()));
  return tr;
}

nlohmann::json simulate_handoff_metrics(const SimTrace& tr) {
  std::size_t sum_chars=0;
  for (const auto& e: tr.events) sum_chars += e.summary.size();
  return nlohmann::json{
    {"events", tr.events.size()},
    {"states", tr.states.size()},
    {"summary_chars", sum_chars},
    {"avg_summary_chars", tr.events.empty()?0.0: double(sum_chars)/tr.events.size()},
  };
}

}}}
