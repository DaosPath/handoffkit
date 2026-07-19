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

namespace handoffkit {
namespace demos {
namespace fusion {
Result<FusionRunResult> FusionEngine::run_lean_ultra(const FusionConfig& config, AnyProvider provider, bool ultra) {
    FusionRunResult run;
    run.run_id = make_fusion_run_id();
    run.config = config;
    const auto wall0 = fusion_now_unix_ms();

    const RolePack pack = make_role_pack(config.profile);
    const FusionCapabilityPack cap = fusion_capability_pack(config.tier);
    if (pack.branches.size() < 2) {
        return Error::invalid_argument("role pack needs >= 2 branches");
    }

    const WebResearchResult web = detail::prepare_web(config, run);
    const std::string web_sec = web.prompt_section();
    const bool tools_live = config.enable_web_tools && web.used;

    const auto& ba = pack.branches[0];
    const auto& bb = pack.branches[1];
    const FrameOptions branch_opts = detail::make_frame_opts(config, cap, pack, {}, web_sec, tools_live);

    // Dual-path model routing: model_a / model_b (else shared provider).
    AnyProvider prov_a = provider;
    AnyProvider prov_b = provider;
    AnyProvider prov_merge = provider;
    if (!config.model_a.empty() || !config.model_b.empty() || !config.model_merge.empty()) {
        auto pa = detail::provider_for_model(config, cache_, config.model_a.empty() ? config.model : config.model_a);
        auto pb = detail::provider_for_model(config, cache_, config.model_b.empty() ? config.model : config.model_b);
        auto pm = detail::provider_for_model(
            config, cache_, config.model_merge.empty() ? config.model : config.model_merge
        );
        if (pa) prov_a = std::move(pa.value());
        if (pb) prov_b = std::move(pb.value());
        if (pm) prov_merge = std::move(pm.value());
    }

    auto out_a = call_llm(
        run, prov_a, config, "branch_a_architect", ba.architect.role_id, ba.architect.agent_name,
        ba.architect.system_role,
        frame_branch_task(config.task, ba.label, ba.architect.focus, branch_opts)
    );
    if (!out_a) {
        run.success = false;
        run.error = out_a.error().message;
        run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
        return run;
    }

    auto out_b = call_llm(
        run, prov_b, config, "branch_b_architect", bb.architect.role_id, bb.architect.agent_name,
        bb.architect.system_role,
        frame_branch_task(config.task, bb.label, bb.architect.focus, branch_opts)
    );
    if (!out_b) {
        run.success = false;
        run.error = out_b.error().message;
        run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
        return run;
    }

    const double arch_overlap = branch_answer_overlap(out_a.value(), out_b.value());
    bool skipped_skeptics = false;

    // Structured handoffs after architects (for skeptic and merge successors).
    HandoffState h_a_arch = detail::emit_via_protocol(make_fusion_step_handoff(
        config.task, ba.architect.agent_name,
        ultra ? ba.skeptic.agent_name : pack.merger.agent_name,
        ba.label, out_a.value(), cap, "architect"
    ));
    HandoffState h_b_arch = detail::emit_via_protocol(make_fusion_step_handoff(
        config.task, bb.architect.agent_name,
        ultra ? bb.skeptic.agent_name : pack.merger.agent_name,
        bb.label, out_b.value(), cap, "architect"
    ));

    std::string a_final = out_a.value();
    std::string b_final = out_b.value();
    std::string sk_a;
    std::string sk_b;
    HandoffState h_a_sk;
    HandoffState h_b_sk;

    if (ultra) {
        if (config.early_stop_on_overlap &&
            arch_overlap >= config.overlap_skip_skeptic_threshold) {
            skipped_skeptics = true;
        }
    }
    if (ultra && !skipped_skeptics) {
        FrameOptions sk_opts_a = detail::make_frame_opts(
            config, cap, pack, format_handoff_prompt_section(h_a_arch), web_sec, tools_live
        );
        FrameOptions sk_opts_b = detail::make_frame_opts(
            config, cap, pack, format_handoff_prompt_section(h_b_arch), web_sec, tools_live
        );
        auto sa = call_llm(
            run, prov_a, config, "branch_a_skeptic", ba.skeptic.role_id, ba.skeptic.agent_name,
            ba.skeptic.system_role,
            frame_skeptic_task(config.task, a_final, ba.skeptic.focus, sk_opts_a)
        );
        if (!sa) {
            run.success = false;
            run.error = sa.error().message;
            run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
            return run;
        }
        auto sb = call_llm(
            run, prov_b, config, "branch_b_skeptic", bb.skeptic.role_id, bb.skeptic.agent_name,
            bb.skeptic.system_role,
            frame_skeptic_task(config.task, b_final, bb.skeptic.focus, sk_opts_b)
        );
        if (!sb) {
            run.success = false;
            run.error = sb.error().message;
            run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
            return run;
        }
        sk_a = sa.value();
        sk_b = sb.value();
        a_final = a_final + "\n\n[Skeptic A]\n" + sk_a;
        b_final = b_final + "\n\n[Skeptic B]\n" + sk_b;
        h_a_sk = detail::emit_via_protocol(make_fusion_step_handoff(
            config.task, ba.skeptic.agent_name, pack.merger.agent_name,
            ba.label, sk_a, cap, "skeptic"
        ));
        h_b_sk = detail::emit_via_protocol(make_fusion_step_handoff(
            config.task, bb.skeptic.agent_name, pack.merger.agent_name,
            bb.label, sk_b, cap, "skeptic"
        ));
    }

    // Merge-ready handoffs carry combined branch state with structured fields.
    HandoffState h_a_merge = detail::emit_via_protocol(make_fusion_step_handoff(
        config.task,
        ultra ? "BranchA_Team" : ba.architect.agent_name,
        pack.merger.agent_name,
        ba.label, a_final, cap, "merge_ready"
    ));
    HandoffState h_b_merge = detail::emit_via_protocol(make_fusion_step_handoff(
        config.task,
        ultra ? "BranchB_Team" : bb.architect.agent_name,
        pack.merger.agent_name,
        bb.label, b_final, cap, "merge_ready"
    ));

    // Pre-merge deterministic analysis (injected into merge prompt).
    std::vector<std::pair<std::string, std::string>> labeled = {
        {ba.label, a_final},
        {bb.label, b_final},
    };
    PanelJudgeReport pre_judge;
    std::string analysis_sec;
    if (config.attach_panel_judge) {
        pre_judge = judge_branch_outputs_as_panel(
            config.task, labeled, {}, ultra ? "ultra-dual-pre" : "lean-dual-pre"
        );
        analysis_sec = pre_judge.merge_prompt_section();
    }

    FrameOptions merge_opts =
        detail::make_frame_opts(config, cap, pack, {}, web_sec, tools_live, analysis_sec);
    const std::string merge_user = frame_merge_task(
        config.task, ba.label, a_final, bb.label, b_final, merge_opts,
        format_handoff_prompt_section(h_a_merge),
        format_handoff_prompt_section(h_b_merge)
    );
    auto merged = call_llm(
        run, prov_merge, config, "merge", pack.merger.role_id, pack.merger.agent_name,
        pack.merger.system_role,
        merge_user
    );
    if (!merged) {
        run.success = false;
        run.error = merged.error().message;
        run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
        return run;
    }

    FusionBranchOutput boa;
    boa.branch_id = ba.branch_id;
    boa.label = ba.label;
    boa.architect_output = out_a.value();
    boa.skeptic_output = sk_a;
    boa.combined = a_final;
    FusionBranchOutput bob;
    bob.branch_id = bb.branch_id;
    bob.label = bb.label;
    bob.architect_output = out_b.value();
    bob.skeptic_output = sk_b;
    bob.combined = b_final;
    run.branches = {std::move(boa), std::move(bob)};

    std::string merge_text = merged.value();
    if (config.anti_dilution) {
        merge_text = apply_anti_dilution(merge_text, labeled);
    }
    run.merge_output = merge_text;
    run.final_output = merge_text;

    run.handoffs = {h_a_arch, h_b_arch};
    if (ultra && !skipped_skeptics) {
        run.handoffs.push_back(h_a_sk);
        run.handoffs.push_back(h_b_sk);
    }
    run.handoffs.push_back(h_a_merge);
    run.handoffs.push_back(h_b_merge);

    run.metrics.handoff_count = static_cast<int>(run.handoffs.size());
    if (cache_) run.metrics.cache = cache_->stats();
    run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
    run.success = !run.final_output.empty();

    nlohmann::json panel_judge_json = nlohmann::json::object();
    nlohmann::json analysis_json = nlohmann::json::object();
    if (config.attach_panel_judge) {
        auto pj = judge_branch_outputs_as_panel(
            config.task, labeled, run.merge_output, ultra ? "ultra-dual" : "lean-dual"
        );
        // Optional meta-judge LLM refine
        if (config.enable_meta_judge) {
            std::string meta_prompt =
                "Refine this fusion analysis. Return concise consensus, contradictions, "
                "and a final answer.\n\n" +
                pj.merge_prompt_section() + "\n\nMerged draft:\n" + run.merge_output;
            auto meta = call_llm(
                run, prov_merge, config, "meta_judge", "meta_judge", "MetaJudge",
                "You refine multi-branch fusion analysis.", meta_prompt
            );
            if (meta) {
                pj.final_answer = meta.value();
                pj.meta_judge_used = true;
                pj.consensus.push_back("Meta-judge LLM refined the deterministic analysis.");
            }
        }
        panel_judge_json = pj.to_json();
        analysis_json = pj.analysis_json();
        run.metrics.scores["panel_judge"] = panel_judge_json;
        run.report["merge_prompt_has_analysis"] =
            merge_user.find("Pre-merge panel analysis") != std::string::npos;
        run.report["merge_prompt_excerpt"] = merge_user.substr(
            0, std::min<std::size_t>(merge_user.size(), 1200)
        );
    }

    // Preserve merge_prompt fields set above
    auto merge_has = run.report.value("merge_prompt_has_analysis", false);
    auto merge_ex = run.report.value("merge_prompt_excerpt", std::string{});
    run.report = {
        {"run_id", run.run_id},
        {"mode", fusion_mode_to_string(config.mode)},
        {"profile", fusion_profile_to_string(config.profile)},
        {"tier", fusion_tier_to_string(config.tier)},
        {"tier_display", fusion_tier_spec(config.tier).display_name},
        {"capability", cap.to_json()},
        {"llm_calls", run.metrics.llm_calls},
        {"planned_llm_calls", planned_llm_calls_for_config(config)},
        {"ultra", ultra},
        {"pack", pack.to_json()},
        {"metrics", run.metrics.to_json()},
        {"handoff_count", run.metrics.handoff_count},
        {"web_research", web.to_json()},
        {"web_tools_live", tools_live},
        {"panel_judge", panel_judge_json},
        {"analysis", analysis_json},
        {"architect_overlap", arch_overlap},
        {"skipped_skeptics", skipped_skeptics},
        {"anti_dilution", config.anti_dilution},
        {"merge_prompt_has_analysis", merge_has},
        {"merge_prompt_excerpt", merge_ex},
    };
    return run;
}
}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit

