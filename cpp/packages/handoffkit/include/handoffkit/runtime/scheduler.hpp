#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/runtime/agent.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/workflows/recipe.hpp>

#include <functional>
#include <queue>
#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

enum class JobKind { Team, Recipe, Agent, Callback };

struct Job {
    std::string id;
    std::string name;
    JobKind kind = JobKind::Team;
    int priority = 0;  // higher first
    std::string task;
    nlohmann::json payload = nlohmann::json::object();
};

struct JobResult {
    std::string id;
    std::string name;
    bool success = false;
    std::string final_output;
    nlohmann::json details = nlohmann::json::object();
    nlohmann::json to_json() const;
};

/// Priority offline job scheduler for batching multi-agent work (no threads; deterministic).
class JobScheduler {
public:
    void enqueue(Job job);
    [[nodiscard]] std::size_t size() const { return jobs_.size(); }
    [[nodiscard]] bool empty() const { return jobs_.empty(); }

    Result<std::vector<JobResult>> run_all(
        std::vector<Agent> agents,
        const HandoffProtocol& protocol = HandoffProtocol{}
    );

    /// Build a standard demo batch of jobs from known tasks.
    static std::vector<Job> demo_batch(std::string_view prefix);

private:
    struct Item {
        Job job;
        bool operator<(const Item& other) const {
            if (job.priority != other.job.priority) return job.priority < other.job.priority;
            return job.id > other.job.id;
        }
    };
    std::priority_queue<Item> jobs_;
};

/// Dependency-aware stage graph (DAG) executor for offline pipelines.
struct DagNode {
    std::string id;
    std::vector<std::string> depends_on;
    std::string agent_name;
    std::string instruction;
};

struct DagResult {
    bool success = false;
    std::vector<std::string> order;
    std::vector<JobResult> node_results;
    nlohmann::json to_json() const;
};

class DagExecutor {
public:
    explicit DagExecutor(std::vector<DagNode> nodes) : nodes_(std::move(nodes)) {}

    Result<DagResult> run(std::vector<Agent>& agents, std::string_view root_task) const;

    static std::vector<DagNode> release_pipeline_graph();
    static std::vector<DagNode> support_pipeline_graph();

private:
    Result<std::vector<std::string>> topological_order() const;
    std::vector<DagNode> nodes_;
};

}  // namespace handoffkit
