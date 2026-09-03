#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/engine_internal.hpp>
#include <handoffkit/demos/fusion/persist.hpp>
#include <handoffkit/demos/fusion/policy.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/provider_wrap.hpp>
#include <handoffkit/demos/fusion/hash.hpp>
#include <handoffkit/demos/fusion/web_research.hpp>
#include <handoffkit/demos/fusion/panel.hpp>
#include <handoffkit/runtime/protocol.hpp>

#include <algorithm>
#include <chrono>
#include <future>

namespace handoffkit {
namespace demos {
namespace fusion {
Result<FusionRunResult> FusionEngine::run_dag(const FusionConfig& config, AnyProvider provider) {
    // DAG mode: run N architect branches (up to branch_count) then one merge (no skeptics).
    FusionRunResult run;
    run.run_id = make_fusion_run_id();
    run.config = config;
    const auto wall0 = fusion_now_unix_ms();
    auto pack_result = detail::resolve_role_pack(config);
    if (!pack_result) return pack_result.error();
    auto pack = std::move(pack_result.value());
    const FusionCapabilityPack cap = fusion_capability_pack(config.tier);
    const WebResearchResult web = detail::prepare_web(config, run);
    const std::string web_sec = web.prompt_section();
    const bool tools_live = config.enable_web_tools && web.used;
    const FrameOptions branch_opts = detail::make_frame_opts(config, cap, pack, {}, web_sec, tools_live);
    const int n = std::max(2, std::min(config.branch_count, 8));

    // If pack only has 2, synthesize extra branch labels for dag with distinct focuses.
    static const char* kExtraFocus[] = {
        "Answer-first, then emphasize evidence quality and what is known vs inferred.",
        "Answer-first, then emphasize counter-arguments and residual risks.",
        "Answer-first with the most specific claim; then constraints and falsifiers.",
        "Answer-first; stress edge cases and failure modes of that answer.",
        "Answer-first; compare competing candidates and pick a winner with reasons.",
        "Answer-first; be succinct under uncertainty but still name the best option.",
    };
    while (static_cast<int>(pack.branches.size()) < n) {
        const std::size_t idx = pack.branches.size();
        BranchRolePair extra = pack.branches.back();
        extra.branch_id = "x" + std::to_string(idx);
        extra.label = "approach-" + std::to_string(idx + 1);
        extra.architect.role_id += "_" + extra.branch_id;
        extra.architect.agent_name += extra.branch_id;
        extra.architect.focus = kExtraFocus[idx % 6];
        pack.branches.push_back(std::move(extra));
    }

    std::vector<std::pair<std::string, std::string>> labeled;
    std::vector<std::string> handoff_sections;

    auto append_branch = [&](int i, const std::string& output) {
        const auto& br = pack.branches[static_cast<std::size_t>(i)];
        FusionBranchOutput bo;
        bo.branch_id = br.branch_id;
        bo.label = br.label;
        bo.architect_output = output;
        bo.combined = output;
        run.branches.push_back(std::move(bo));
        labeled.emplace_back(br.label, output);
        auto h = detail::emit_via_protocol(make_fusion_step_handoff(
            config.task, br.architect.agent_name, pack.merger.agent_name,
            br.label, output, cap, "architect"
        ));
        handoff_sections.push_back(format_handoff_prompt_section(h));
        run.handoffs.push_back(std::move(h));
    };

    const bool use_parallel = config.parallel_branches && !config.cache.enabled && n > 1;
    const int parallel_limit = std::max(1, std::min({config.max_parallel_branches, n, 8}));
    if (use_parallel) {
        struct BranchCallResult {
            bool success = false;
            std::string output;
            Error error = Error::provider_failed("branch not executed");
            FusionMetrics metrics;
        };
        for (int batch = 0; batch < n; batch += parallel_limit) {
            const int end = std::min(n, batch + parallel_limit);
            std::vector<std::future<BranchCallResult>> futures;
            futures.reserve(static_cast<std::size_t>(end - batch));
            for (int i = batch; i < end; ++i) {
                const auto br = pack.branches[static_cast<std::size_t>(i)];
                futures.push_back(std::async(std::launch::async, [&, br]() mutable {
                    BranchCallResult result;
                    auto branch_provider = make_fusion_provider(config, nullptr);
                    if (!branch_provider) {
                        result.error = branch_provider.error();
                        return result;
                    }
                    FusionEngine worker;
                    FusionRunResult local;
                    local.config = config;
                    auto out = worker.call_llm(
                        local, branch_provider.value(), config,
                        "dag_branch_" + br.branch_id, br.architect.role_id, br.architect.agent_name,
                        br.architect.system_role,
                        frame_branch_task(config.task, br.label, br.architect.focus, branch_opts)
                    );
                    result.metrics = std::move(local.metrics);
                    if (!out) {
                        result.error = out.error();
                        return result;
                    }
                    result.success = true;
                    result.output = std::move(out.value());
                    return result;
                }));
            }
            for (int i = batch; i < end; ++i) {
                auto result = futures[static_cast<std::size_t>(i - batch)].get();
                run.metrics.llm_calls += result.metrics.llm_calls;
                for (auto& call : result.metrics.calls) run.metrics.calls.push_back(std::move(call));
                if (!result.success) {
                    run.success = false;
                    run.error = result.error.message;
                    run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
                    return run;
                }
                append_branch(i, result.output);
            }
        }
    } else {
        for (int i = 0; i < n; ++i) {
            const auto& br = pack.branches[static_cast<std::size_t>(i)];
            auto out = call_llm(
                run, provider, config, "dag_branch_" + br.branch_id, br.architect.role_id, br.architect.agent_name,
                br.architect.system_role,
                frame_branch_task(config.task, br.label, br.architect.focus, branch_opts)
            );
            if (!out) {
                run.success = false;
                run.error = out.error().message;
                run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
                return run;
            }
            append_branch(i, out.value());
        }
    }

    std::string analysis_sec;
    PanelJudgeReport pre_judge;
    if (config.attach_panel_judge) {
        pre_judge = judge_branch_outputs_as_panel(config.task, labeled, {}, "dag-pre");
        analysis_sec = pre_judge.merge_prompt_section();
    }
    FrameOptions merge_opts =
        detail::make_frame_opts(config, cap, pack, {}, web_sec, tools_live, analysis_sec);
    const std::string merge_user =
        frame_merge_multi(config.task, labeled, merge_opts, handoff_sections);
    auto merged = call_llm(
        run, provider, config, "dag_merge", pack.merger.role_id, pack.merger.agent_name,
        pack.merger.system_role,
        merge_user
    );
    if (!merged) {
        run.success = false;
        run.error = merged.error().message;
        run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
        return run;
    }
    std::string merge_text = merged.value();
    if (config.anti_dilution) merge_text = apply_anti_dilution(merge_text, labeled);
    run.merge_output = merge_text;
    run.final_output = merge_text;
    run.metrics.handoff_count = static_cast<int>(run.handoffs.size());
    if (cache_) run.metrics.cache = cache_->stats();
    run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
    run.success = !run.final_output.empty();

    nlohmann::json panel_judge_json = nlohmann::json::object();
    nlohmann::json analysis_json = nlohmann::json::object();
    if (config.attach_panel_judge) {
        auto pj = judge_branch_outputs_as_panel(config.task, labeled, run.merge_output, "dag");
        if (config.enable_meta_judge && pj.success) {
            std::string meta_prompt =
                "Act as the final adversarial quality gate. Repair omissions and contradictions, "
                "preserve unique supported claims, and return only the improved final answer. "
                "Audit every explicit deliverable and every numeric constraint in the ORIGINAL TASK; "
                "do not omit assumptions, tradeoffs, failure mitigations, staged plan, numeric validation, "
                "rollback trigger, strongest counterargument, falsifier, confidence, or residual risks.\n\n" +
                pj.merge_prompt_section() + "\n\nMerged draft:\n" + run.merge_output;
            auto meta = call_llm(
                run, provider, config, "dag_meta_judge", "meta_judge", "MetaJudge",
                "You are the final adversarial fusion quality gate.", meta_prompt
            );
            if (meta) {
                run.final_output = config.anti_dilution
                    ? apply_anti_dilution(meta.value(), labeled)
                    : meta.value();
                pj.final_answer = run.final_output;
                pj.meta_judge_used = true;
                pj.consensus.push_back("Meta-judge refined and replaced the DAG merge draft.");
            }
        }
        panel_judge_json = pj.to_json();
        analysis_json = pj.analysis_json();
        run.metrics.scores["panel_judge"] = panel_judge_json;
    }
    run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
    run.success = !run.final_output.empty();

    run.report = {
        {"run_id", run.run_id},
        {"mode", "dag"},
        {"profile", fusion_profile_to_string(config.profile)},
        {"tier", fusion_tier_to_string(config.tier)},
        {"tier_display", fusion_tier_spec(config.tier).display_name},
        {"capability", cap.to_json()},
        {"branch_count", n},
        {"parallel_branches_requested", config.parallel_branches},
        {"parallel_branches_used", use_parallel},
        {"max_parallel_branches", parallel_limit},
        {"llm_calls", run.metrics.llm_calls},
        {"planned_llm_calls", planned_llm_calls_for_config(config)},
        {"metrics", run.metrics.to_json()},
        {"handoff_count", run.metrics.handoff_count},
        {"web_research", web.to_json()},
        {"web_tools_live", tools_live},
        {"panel_judge", panel_judge_json},
        {"analysis", analysis_json},
        {"merge_prompt_has_analysis",
         merge_user.find("Pre-merge panel analysis") != std::string::npos},
    };
    return run;
}
}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit

