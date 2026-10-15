#include <handoffkit/runtime/orchestrator.hpp>
#include <handoffkit/util/text.hpp>

#include <sstream>

namespace handoffkit {

nlohmann::json StageRunRecord::to_json() const {
    return nlohmann::json{
        {"stage_name", stage_name},
        {"success", success},
        {"attempts", attempts},
        {"team_result", team_result.to_json()},
        {"quality", quality.to_json()},
        {"notes", notes},
    };
}

nlohmann::json OrchestratorResult::to_json() const {
    nlohmann::json stages_json = nlohmann::json::array();
    for (const auto& s : stages) stages_json.push_back(s.to_json());
    nlohmann::json handoffs_json = nlohmann::json::array();
    for (const auto& h : all_handoffs) handoffs_json.push_back(h.to_json());
    return nlohmann::json{
        {"success", success},
        {"plan_name", plan_name},
        {"task", task},
        {"final_output", final_output},
        {"stages", std::move(stages_json)},
        {"handoffs", std::move(handoffs_json)},
        {"trace", trace.to_json()},
        {"metadata", metadata.is_null() ? nlohmann::json::object() : metadata},
    };
}

Agent* Orchestrator::find(const std::string& name) {
    for (auto& a : agents_) {
        if (a.name() == name) return &a;
    }
    return nullptr;
}

Result<TeamRunResult> Orchestrator::run_stage_team(
    const OrchestratorStage& stage,
    std::string_view task,
    const HandoffState* inbound
) {
    if (stage.agent_names.empty()) {
        return Error::invalid_argument("stage has no agents: " + stage.name, "agents");
    }
    std::vector<Agent> stage_agents;
    stage_agents.reserve(stage.agent_names.size());
    for (const auto& name : stage.agent_names) {
        Agent* src = find(name);
        if (!src) {
            return Error::invalid_argument("unknown agent in stage: " + name, "agent");
        }
        // Re-bind provider by reconstructing lightweight agent shell with same provider/tools.
        Agent copy(src->name(), src->role(), src->provider());
        stage_agents.push_back(std::move(copy));
    }

    if (stage_agents.size() == 1) {
        RunOptions opts;
        opts.handoff = inbound;
        auto out = stage_agents[0].run(task, opts);
        if (!out) return out.error();
        TeamRunResult tr;
        tr.task = std::string(task);
        tr.final_output = out.value();
        tr.success = true;
        tr.agent_outputs.push_back({stage_agents[0].name(), out.value()});
        if (inbound) tr.handoffs.push_back(*inbound);
        return Result<TeamRunResult>::success(std::move(tr));
    }

    // For multi-agent stages, seed first agent with inbound handoff via task annotation.
    std::string stage_task = std::string(task);
    if (inbound) {
        stage_task += "\n\nInbound handoff:\n" + inbound->to_markdown();
    }
    Team team(std::move(stage_agents), HandoffProtocol(stage.protocol));
    return team.run(stage_task);
}

Result<OrchestratorResult> Orchestrator::run(const OrchestratorPlan& plan, std::string_view task) {
    if (plan.stages.empty()) {
        return Error::invalid_argument("orchestrator plan has no stages", "stages");
    }
    if (task.empty()) {
        return Error::invalid_argument("task required", "task");
    }

    OrchestratorResult result;
    result.plan_name = plan.name;
    result.task = std::string(task);
    result.metadata = plan.metadata.is_null() ? nlohmann::json::object() : plan.metadata;

    const HandoffState* inbound = nullptr;
    HandoffState last_handoff_storage;
    std::string current_output;

    for (const auto& stage : plan.stages) {
        StageRunRecord record;
        record.stage_name = stage.name;
        bool stage_ok = false;
        std::string stage_task = result.task + "\n\n[stage=" + stage.name + "]";

        for (int attempt = 0; attempt <= stage.max_retries; ++attempt) {
            record.attempts = attempt + 1;
            auto team = run_stage_team(stage, stage_task, inbound);
            if (!team) {
                record.notes = team.error().message;
                continue;
            }
            record.team_result = std::move(team.value());
            current_output = record.team_result.final_output;
            for (const auto& h : record.team_result.handoffs) {
                result.all_handoffs.push_back(h);
            }

            if (stage.quality_gate && !record.team_result.handoffs.empty()) {
                HandoffQualityEvaluator evaluator(stage.min_quality);
                record.quality = evaluator.evaluate(record.team_result.handoffs.back());
                if (!record.quality.success && attempt < stage.max_retries) {
                    stage_task += "\n\nQuality gate failed; improve decisions/next_steps/files.";
                    record.notes = "quality_gate_retry";
                    continue;
                }
                stage_ok = record.quality.success || !stage.quality_gate;
            } else {
                stage_ok = record.team_result.success && !current_output.empty();
            }

            if (stage_ok) break;
        }

        if (!stage_ok && !stage.rescue_agent.empty()) {
            Agent* rescue = find(stage.rescue_agent);
            if (rescue) {
                auto rescued = rescue->run(
                    result.task + "\n\nRescue stage " + stage.name + " previous=" + current_output
                );
                if (rescued) {
                    current_output = rescued.value();
                    record.team_result.final_output = current_output;
                    record.team_result.agent_outputs.push_back({rescue->name(), current_output});
                    record.notes += " rescue_applied";
                    stage_ok = true;
                }
            }
        }

        record.success = stage_ok;
        if (!record.team_result.handoffs.empty()) {
            last_handoff_storage = record.team_result.handoffs.back();
            inbound = &last_handoff_storage;
        } else if (inbound == nullptr && stage_ok) {
            // synthesize a handoff for continuity
            TransferOptions t;
            t.task = result.task;
            t.from_agent = stage.agent_names.front();
            t.to_agent = stage.agent_names.back();
            t.summary = current_output;
            auto synth = HandoffProtocol(stage.protocol).transfer(t);
            if (synth) {
                last_handoff_storage = synth.value();
                inbound = &last_handoff_storage;
                result.all_handoffs.push_back(last_handoff_storage);
            }
        }
        result.stages.push_back(std::move(record));
        if (!stage_ok) {
            result.success = false;
            result.final_output = current_output;
            result.metadata["failed_stage"] = stage.name;
            // still build partial trace
            TeamRunResult partial;
            partial.task = result.task;
            partial.final_output = current_output;
            partial.success = false;
            partial.handoffs = result.all_handoffs;
            for (const auto& st : result.stages) {
                for (const auto& ao : st.team_result.agent_outputs) {
                    partial.agent_outputs.push_back(ao);
                }
            }
            result.trace = build_run_trace("orch-" + plan.name, plan.name, partial, "hybrid_state");
            return Result<OrchestratorResult>::success(std::move(result));
        }
    }

    result.final_output = current_output;
    result.success = true;
    TeamRunResult aggregate;
    aggregate.task = result.task;
    aggregate.final_output = result.final_output;
    aggregate.success = true;
    aggregate.handoffs = result.all_handoffs;
    for (const auto& st : result.stages) {
        for (const auto& ao : st.team_result.agent_outputs) {
            aggregate.agent_outputs.push_back(ao);
        }
    }
    result.trace = build_run_trace("orch-" + plan.name, plan.name, aggregate, "hybrid_state");
    return Result<OrchestratorResult>::success(std::move(result));
}

OrchestratorPlan Orchestrator::support_escalation_plan() {
    return OrchestratorPlan{
        "support_escalation",
        "L1 triage → L2 deep-dive with quality gate → IC ownership",
        {
            {"triage", {"L1_Support"}, ProtocolMode::HybridMin, false, 0.5, 0, ""},
            {"deep_dive", {"L2_Support"}, ProtocolMode::HybridState, true, 0.45, 1, "Incident_Commander"},
            {"command", {"Incident_Commander"}, ProtocolMode::HybridState, false, 0.5, 0, ""},
        },
        {{"domain", "support"}},
    };
}

OrchestratorPlan Orchestrator::coding_ship_plan() {
    return OrchestratorPlan{
        "coding_ship",
        "Author → Reviewer (quality) → Maintainer",
        {
            {"author", {"Author"}, ProtocolMode::HybridState, false, 0.5, 0, ""},
            {"review", {"Reviewer"}, ProtocolMode::HybridState, true, 0.5, 1, "Maintainer"},
            {"maintain", {"Maintainer"}, ProtocolMode::HybridState, false, 0.5, 0, ""},
        },
        {{"domain", "coding"}},
    };
}

OrchestratorPlan Orchestrator::research_then_edit_plan() {
    return OrchestratorPlan{
        "research_then_edit",
        "Librarian → Analyst → Editor",
        {
            {"collect", {"Librarian"}, ProtocolMode::Compressed, false, 0.5, 0, ""},
            {"analyze", {"Analyst"}, ProtocolMode::Compressed, false, 0.5, 0, ""},
            {"edit", {"Editor"}, ProtocolMode::HybridMin, false, 0.5, 0, ""},
        },
        {{"domain", "research"}},
    };
}

OrchestratorPlan Orchestrator::incident_with_rescue_plan() {
    return OrchestratorPlan{
        "incident_with_rescue",
        "Oncall mitigation with optional rescue scribe path",
        {
            {"mitigate", {"Oncall"}, ProtocolMode::HybridState, true, 0.4, 1, "Scribe"},
            {"comms", {"Comms"}, ProtocolMode::HybridState, false, 0.5, 0, ""},
            {"scribe", {"Scribe"}, ProtocolMode::HybridState, false, 0.5, 0, ""},
        },
        {{"domain", "ops"}},
    };
}

OrchestratorPlan Orchestrator::product_to_eng_plan() {
    return OrchestratorPlan{
        "product_to_eng",
        "PM → Designer → TechLead",
        {
            {"prd", {"PM"}, ProtocolMode::HybridState, false, 0.5, 0, ""},
            {"ux", {"Designer"}, ProtocolMode::HybridState, false, 0.5, 0, ""},
            {"eng", {"TechLead"}, ProtocolMode::HybridState, true, 0.45, 1, ""},
        },
        {{"domain", "product"}},
    };
}

std::vector<OrchestratorPlan> Orchestrator::catalog() {
    return {
        support_escalation_plan(),
        coding_ship_plan(),
        research_then_edit_plan(),
        incident_with_rescue_plan(),
        product_to_eng_plan(),
    };
}

}  // namespace handoffkit
