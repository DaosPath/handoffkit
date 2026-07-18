#include <handoffkit/runtime/scheduler.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/util/text.hpp>

#include <algorithm>
#include <queue>
#include <unordered_map>
#include <unordered_set>

namespace handoffkit {

nlohmann::json JobResult::to_json() const {
    return nlohmann::json{
        {"id", id},
        {"name", name},
        {"success", success},
        {"final_output", final_output},
        {"details", details},
    };
}

nlohmann::json DagResult::to_json() const {
    nlohmann::json results = nlohmann::json::array();
    for (const auto& r : node_results) results.push_back(r.to_json());
    return nlohmann::json{
        {"success", success},
        {"order", order},
        {"node_results", std::move(results)},
    };
}

void JobScheduler::enqueue(Job job) {
    jobs_.push(Item{std::move(job)});
}

Result<std::vector<JobResult>> JobScheduler::run_all(
    std::vector<Agent> agents,
    const HandoffProtocol& protocol
) {
    std::vector<JobResult> out;
    auto find = [&](const std::string& name) -> Agent* {
        for (auto& a : agents) if (a.name() == name) return &a;
        return nullptr;
    };

    while (!jobs_.empty()) {
        Job job = std::move(jobs_.top().job);
        jobs_.pop();
        JobResult jr;
        jr.id = job.id;
        jr.name = job.name;

        if (job.kind == JobKind::Agent) {
            const std::string agent_name = job.payload.value("agent", agents.empty() ? "" : agents.front().name());
            Agent* agent = find(agent_name);
            if (!agent && !agents.empty()) agent = &agents.front();
            if (!agent) {
                jr.success = false;
                jr.details = {{"error", "no agent"}};
                out.push_back(std::move(jr));
                continue;
            }
            auto r = agent->run(job.task);
            if (!r) {
                jr.success = false;
                jr.details = {{"error", r.error().message}};
            } else {
                jr.success = true;
                jr.final_output = r.value();
            }
        } else if (job.kind == JobKind::Team) {
            if (agents.size() < 2) {
                jr.success = false;
                jr.details = {{"error", "need >=2 agents for team job"}};
            } else {
                std::vector<Agent> team_agents;
                for (auto& a : agents) {
                    team_agents.emplace_back(a.name(), a.role(), a.provider());
                }
                Team team(std::move(team_agents), protocol);
                auto r = team.run(job.task);
                if (!r) {
                    jr.success = false;
                    jr.details = {{"error", r.error().message}};
                } else {
                    jr.success = r.value().success;
                    jr.final_output = r.value().final_output;
                    jr.details = r.value().to_json();
                }
            }
        } else if (job.kind == JobKind::Recipe) {
            Recipe recipe;
            recipe.name = job.name;
            recipe.protocol = ProtocolMode::HybridState;
            if (job.payload.contains("steps") && job.payload["steps"].is_array()) {
                for (const auto& s : job.payload["steps"]) {
                    RecipeStep st;
                    st.name = s.value("name", "step");
                    st.agent_name = s.value("agent_name", agents.empty() ? "Agent" : agents.front().name());
                    st.instruction = s.value("instruction", "continue");
                    recipe.steps.push_back(std::move(st));
                }
            } else {
                for (std::size_t i = 0; i < agents.size(); ++i) {
                    RecipeStep st;
                    st.name = "step_" + std::to_string(i + 1);
                    st.agent_name = agents[i].name();
                    st.instruction = "Execute scheduled recipe step";
                    recipe.steps.push_back(std::move(st));
                }
            }
            std::vector<Agent> copy;
            for (auto& a : agents) copy.emplace_back(a.name(), a.role(), a.provider());
            RecipeRunner runner(std::move(copy), protocol);
            auto r = runner.run(recipe, job.task);
            if (!r) {
                jr.success = false;
                jr.details = {{"error", r.error().message}};
            } else {
                jr.success = r.value().success;
                jr.final_output = r.value().final_output;
                jr.details = r.value().to_json();
            }
        } else {
            jr.success = true;
            jr.final_output = "callback:" + job.task;
            jr.details = job.payload;
        }
        out.push_back(std::move(jr));
    }
    return Result<std::vector<JobResult>>::success(std::move(out));
}

std::vector<Job> JobScheduler::demo_batch(std::string_view prefix) {
    std::vector<Job> jobs;
    const char* tasks[] = {
        "Validate packaging docs",
        "Run support triage notes",
        "Draft release checklist",
        "Score handoff quality sample",
        "Summarize CLI help surface",
    };
    int prio = 10;
    int i = 0;
    for (const char* t : tasks) {
        Job j;
        j.id = std::string(prefix) + "-" + std::to_string(++i);
        j.name = t;
        j.kind = (i % 2 == 0) ? JobKind::Team : JobKind::Agent;
        j.priority = prio--;
        j.task = t;
        j.payload = {{"source", "demo_batch"}};
        jobs.push_back(std::move(j));
    }
    return jobs;
}

Result<std::vector<std::string>> DagExecutor::topological_order() const {
    std::unordered_map<std::string, int> indeg;
    std::unordered_map<std::string, std::vector<std::string>> adj;
    std::unordered_set<std::string> ids;
    for (const auto& n : nodes_) {
        ids.insert(n.id);
        indeg[n.id] = indeg[n.id];  // ensure key
    }
    for (const auto& n : nodes_) {
        for (const auto& d : n.depends_on) {
            if (!ids.count(d)) {
                return Error::invalid_argument("unknown dependency: " + d, "depends_on");
            }
            adj[d].push_back(n.id);
            indeg[n.id]++;
        }
    }
    std::queue<std::string> q;
    for (const auto& id : ids) {
        if (indeg[id] == 0) q.push(id);
    }
    std::vector<std::string> order;
    while (!q.empty()) {
        auto u = q.front();
        q.pop();
        order.push_back(u);
        for (const auto& v : adj[u]) {
            if (--indeg[v] == 0) q.push(v);
        }
    }
    if (order.size() != ids.size()) {
        return Error::invalid_argument("cycle detected in DAG", "nodes");
    }
    return Result<std::vector<std::string>>::success(std::move(order));
}

Result<DagResult> DagExecutor::run(std::vector<Agent>& agents, std::string_view root_task) const {
    auto order = topological_order();
    if (!order) return order.error();
    DagResult result;
    result.order = order.value();

    std::unordered_map<std::string, std::string> outputs;
    auto find = [&](const std::string& name) -> Agent* {
        for (auto& a : agents) if (a.name() == name) return &a;
        return nullptr;
    };

    std::unordered_map<std::string, const DagNode*> by_id;
    for (const auto& n : nodes_) by_id[n.id] = &n;

    for (const auto& id : result.order) {
        const DagNode* node = by_id[id];
        JobResult jr;
        jr.id = id;
        jr.name = node->instruction;
        Agent* agent = find(node->agent_name);
        if (!agent) {
            jr.success = false;
            jr.details = {{"error", "missing agent " + node->agent_name}};
            result.node_results.push_back(std::move(jr));
            result.success = false;
            return Result<DagResult>::success(std::move(result));
        }
        std::ostringstream prompt;
        prompt << root_task << "\n\nNode: " << id << "\n" << node->instruction << "\n";
        if (!node->depends_on.empty()) {
            prompt << "Upstream outputs:\n";
            for (const auto& d : node->depends_on) {
                prompt << "- " << d << ": " << text::truncate(outputs[d], 200) << "\n";
            }
        }
        auto out = agent->run(prompt.str());
        if (!out) {
            jr.success = false;
            jr.details = {{"error", out.error().message}};
            result.node_results.push_back(std::move(jr));
            result.success = false;
            return Result<DagResult>::success(std::move(result));
        }
        outputs[id] = out.value();
        jr.success = true;
        jr.final_output = out.value();
        jr.details = {{"depends_on", node->depends_on}, {"agent", node->agent_name}};
        result.node_results.push_back(std::move(jr));
    }
    result.success = true;
    return Result<DagResult>::success(std::move(result));
}

std::vector<DagNode> DagExecutor::release_pipeline_graph() {
    return {
        {"plan", {}, "Planner", "Plan version bump and changelog"},
        {"implement", {"plan"}, "Coder", "Implement remaining release tasks"},
        {"test", {"implement"}, "Verifier", "List ctest and CLI verification commands"},
        {"package", {"test"}, "Releaser", "Describe tarball and attestation steps"},
        {"docs", {"package"}, "Editor", "Update README CLI section"},
    };
}

std::vector<DagNode> DagExecutor::support_pipeline_graph() {
    return {
        {"intake", {}, "L1_Support", "Capture customer impact"},
        {"diagnose", {"intake"}, "L2_Support", "Technical hypotheses"},
        {"mitigate", {"diagnose"}, "Oncall", "Mitigation options"},
        {"comms", {"mitigate"}, "Comms", "Customer update draft"},
        {"close", {"comms", "mitigate"}, "Scribe", "Decision log and follow-ups"},
    };
}

}  // namespace handoffkit
