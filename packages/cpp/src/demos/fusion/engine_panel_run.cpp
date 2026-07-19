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
Result<FusionRunResult> FusionEngine::run_panel(const FusionConfig& config) {
    FusionRunResult run;
    run.run_id = make_fusion_run_id();
    run.config = config;
    const auto wall0 = fusion_now_unix_ms();

    if (!cache_ && config.cache.enabled) {
        cache_ = std::make_shared<FusionCache>(config.cache);
    }

    const auto specs = resolve_panel_model_specs(config);
    auto roles = config.panel_roles.empty() ? panel_roles_for_profile(config.profile)
                                            : config.panel_roles;
    while (roles.size() < specs.size()) {
        roles.push_back("panelist-" + std::to_string(roles.size() + 1));
    }

    const bool echo_offline = (config.provider == "echo");
    std::vector<PanelSlot> slots;
    std::vector<std::string> model_labels;
    for (std::size_t i = 0; i < specs.size(); ++i) {
        const auto& spec = specs[i];
        const std::string& role = roles[i];
        PanelSlot slot;
        slot.provider = spec.provider.empty() ? config.provider : spec.provider;
        slot.model = spec.model;
        slot.role = role;
        model_labels.push_back(
            slot.provider + ":" + (slot.model.empty() ? "(default)" : slot.model)
        );

        const std::string model_override =
            (spec.model == "(provider-default)" || spec.model.empty()) ? "" : spec.model;
        auto prov = detail::provider_for_model(config, cache_, model_override, spec.provider);
        if (!prov) {
            slot.confidence = "failed";
            slot.error = prov.error().message;
            slot.answer = "Provider failed: " + prov.error().message;
            slots.push_back(std::move(slot));
            continue;
        }
        auto any = std::move(prov.value());
        if (spec.model == "(provider-default)" || spec.model.empty()) {
            slot.model = std::string(any.model());
        }

        auto out = call_llm(
            run,
            any,
            config,
            "panel_" + std::to_string(i),
            "panel_role_" + std::to_string(i),
            role,
            "Fusion panelist: " + role,
            frame_panel_role_task(config.task, role, config.ascii_sanitize)
        );
        if (!out) {
            slot.confidence = "failed";
            slot.error = out.error().message;
            slot.answer = "Provider failed: " + out.error().message;
        } else if (echo_offline) {
            // Deterministic role-keyed answers for CI/demos (echo would only mirror prompts).
            slot.answer = offline_panel_answer(role, config.task);
            slot.confidence = "high";
            slot.strengths = {"offline deterministic panel"};
            slot.risks = {"not a live model response"};
        } else {
            slot.answer = out.value();
            slot.confidence = "model-reported";
            slot.strengths = {"panel role response"};
            slot.risks = {"cost/latency of multi-model panel"};
        }
        slots.push_back(std::move(slot));
    }

    auto judge = judge_fusion_panel(config.task, slots, "panel");
    if (config.enable_meta_judge && judge.success) {
        auto meta_prov = make_fusion_provider(config, cache_, config.model);
        if (meta_prov) {
            auto any = std::move(meta_prov.value());
            std::string meta_prompt =
                "Refine fusion panel analysis into a short final answer.\n\n" +
                judge.merge_prompt_section();
            auto meta = call_llm(
                run, any, config, "meta_judge", "meta_judge", "MetaJudge",
                "You refine multi-model panel analysis.", meta_prompt
            );
            if (meta) {
                judge.final_answer = meta.value();
                judge.meta_judge_used = true;
            }
        }
    }

    run.final_output = judge.final_answer;
    run.merge_output = judge.final_answer;
    run.success = judge.success;
    if (!judge.success) run.error = "panel had no successful responses";

    for (const auto& s : judge.panel) {
        FusionBranchOutput bo;
        bo.branch_id = s.role;
        bo.label = s.role + " / " + s.model;
        bo.architect_output = s.answer;
        bo.combined = s.answer;
        run.branches.push_back(std::move(bo));
    }

    if (cache_) run.metrics.cache = cache_->stats();
    run.metrics.wall_ms = static_cast<int>(fusion_now_unix_ms() - wall0);
    run.metrics.scores["panel_judge"] = judge.to_json();
    run.report = {
        {"run_id", run.run_id},
        {"mode", "panel"},
        {"profile", fusion_profile_to_string(config.profile)},
        {"tier", fusion_tier_to_string(config.tier)},
        {"llm_calls", run.metrics.llm_calls},
        {"planned_llm_calls", planned_llm_calls_for_config(config)},
        {"panel_size", static_cast<int>(slots.size())},
        {"panel_models", model_labels},
        {"panel_roles", roles},
        {"panel_judge", judge.to_json()},
        {"analysis", judge.analysis_json()},
        {"metrics", run.metrics.to_json()},
        {"offline_echo_panel", echo_offline},
    };
    return run;
}
}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit

