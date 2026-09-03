#pragma once

// Shared helpers for FusionEngine method TUs (lean/dag/panel/run).

#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/panel.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/provider_wrap.hpp>
#include <handoffkit/demos/fusion/roles.hpp>
#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/demos/fusion/web_research.hpp>
#include <handoffkit/runtime/protocol.hpp>
#include <handoffkit/runtime/provider.hpp>

#include <algorithm>
#include <memory>
#include <string>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace detail {

inline FrameOptions make_frame_opts(
    const FusionConfig& config,
    const FusionCapabilityPack& cap,
    const RolePack& pack,
    std::string prior_handoff = {},
    std::string web_research = {},
    bool tools_live = false,
    std::string panel_analysis = {}
) {
    FrameOptions o;
    o.depth = cap.depth;
    o.ascii = config.ascii_sanitize;
    o.task_faithful = pack.task_faithful_merge;
    o.shipping_sections = pack.shipping_merge_sections;
    o.max_branch_bullets = cap.max_branch_bullets;
    o.max_skeptic_bullets = cap.max_skeptic_bullets;
    o.evidence_min_points = cap.evidence_min_points;
    o.skills = cap.skills;
    o.tool_slots = cap.tool_slots;
    o.quality_gates = cap.quality_gates;
    o.output_contract = cap.output_contract;
    o.prompt_config = config.prompts;
    if (config.enable_web_tools) {
        for (const char* t : {
                 "web_search", "web_fetch_markdown", "web_explore", "html_to_markdown"}) {
            if (std::find(o.tool_slots.begin(), o.tool_slots.end(), t) == o.tool_slots.end()) {
                o.tool_slots.emplace_back(t);
            }
        }
    }
    o.prior_handoff_section = std::move(prior_handoff);
    o.web_research_section = std::move(web_research);
    o.panel_analysis_section = std::move(panel_analysis);
    o.tools_are_live = tools_live;
    return o;
}

inline Result<RolePack> resolve_role_pack(const FusionConfig& config) {
    if (!config.role_pack_file.empty()) return load_role_pack_file(config.role_pack_file);
    return Result<RolePack>::success(make_role_pack(config.profile));
}

inline Result<AnyProvider> provider_for_model(
    const FusionConfig& config,
    std::shared_ptr<FusionCache> cache,
    const std::string& model_override,
    const std::string& provider_override = {}
) {
    FusionConfig cfg = config;
    std::string model = model_override;
    if (!provider_override.empty()) {
        cfg.provider = provider_override;
    } else if (!model_override.empty()) {
        const auto spec = parse_panel_model_spec(model_override);
        if (!spec.provider.empty()) {
            cfg.provider = spec.provider;
            model = spec.model;
        }
    }
    return make_fusion_provider(cfg, cache, model);
}

inline WebResearchResult prepare_web(const FusionConfig& config, FusionRunResult& run) {
    WebResearchResult wr = gather_web_research(config);
    run.report["web_research"] = wr.to_json();
    return wr;
}

inline HandoffState emit_via_protocol(const HandoffState& draft) {
    HandoffProtocol protocol(ProtocolMode::HybridState);
    TransferOptions t;
    t.task = draft.task;
    t.from_agent = draft.from_agent;
    t.to_agent = draft.to_agent;
    t.summary = draft.summary;
    t.decisions = draft.decisions;
    t.next_steps = draft.next_steps;
    t.context_refs = draft.context_refs;
    t.errors = draft.errors;
    t.important_files = draft.important_files;
    t.metadata = draft.metadata;
    auto r = protocol.transfer(t);
    if (r) return r.value();
    return draft;
}

}  // namespace detail
}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
