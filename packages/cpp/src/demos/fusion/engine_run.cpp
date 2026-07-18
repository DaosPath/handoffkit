#include <handoffkit/demos/fusion/engine.hpp>
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
namespace {

FrameOptions make_frame_opts(
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
    // Web tools are opt-in (--web); not part of the pure-tier base packs.
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

Result<AnyProvider> provider_for_model(
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
        // Allow "provider:model" in model_a/b/merge slots.
        const auto spec = parse_panel_model_spec(model_override);
        if (!spec.provider.empty()) {
            cfg.provider = spec.provider;
            model = spec.model;
        }
    }
    return make_fusion_provider(cfg, cache, model);
}

WebResearchResult prepare_web(const FusionConfig& config, FusionRunResult& run) {
    WebResearchResult wr = gather_web_research(config);
    run.report["web_research"] = wr.to_json();
    return wr;
}

HandoffState emit_via_protocol(const HandoffState& draft) {
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
    // Fall back to draft if protocol transfer fails (should be rare).
    return draft;
}

}  // namespace

FusionEngine::FusionEngine(std::shared_ptr<FusionCache> cache) : cache_(std::move(cache)) {}

void FusionEngine::set_cache(std::shared_ptr<FusionCache> cache) { cache_ = std::move(cache); }

Result<std::string> FusionEngine::call_llm(
    FusionRunResult& run,
    AnyProvider& provider,
    const FusionConfig& config,
    std::string step_id,
    std::string role_id,
    std::string agent_name,
    std::string system_role,
    std::string user_prompt
) {
    FusionBudget budget(config.policy);
    // reconstruct budget from metrics already used
    for (int i = 0; i < run.metrics.llm_calls; ++i) budget.after_call();

    if (config.ascii_sanitize) {
        user_prompt = sanitize_prompt_text(user_prompt, true);
        system_role = sanitize_prompt_text(system_role, true);
    }

    auto gate = budget.before_call(user_prompt.size() + system_role.size());
    if (!gate) {
        FusionCallRecord rec;
        rec.step_id = step_id;
        rec.role_id = role_id;
        rec.agent_name = agent_name;
        rec.error = gate.error().message;
        run.metrics.calls.push_back(rec);
        return gate.error();
    }

    // Manual cache path also tracked via CachingProvider; still record metrics here.
    const auto t0 = fusion_now_unix_ms();
    GenerateOptions opt;
    opt.agent_name = agent_name;
    opt.task = config.task;
    const std::string full_prompt = "Role: " + system_role + "\nTask: " + user_prompt + "\n";
    const std::string phash = fusion_content_hash(full_prompt);

    // Detect cache hit by peeking stats if shared cache present
    FusionCacheStats before;
    if (cache_) before = cache_->stats();

    auto out = provider.generate(full_prompt, opt);
    const auto t1 = fusion_now_unix_ms();

    FusionCallRecord rec;
    rec.step_id = std::move(step_id);
    rec.role_id = std::move(role_id);
    rec.agent_name = std::move(agent_name);
    rec.model = std::string(provider.model());
    rec.latency_ms = static_cast<int>(t1 - t0);
    rec.chars_in = full_prompt.size();
    rec.prompt_hash = phash;
    if (cache_) {
        const auto after = cache_->stats();
        rec.cache_hit = after.hits > before.hits;
    }
    if (!out) {
        rec.error = out.error().message;
        run.metrics.calls.push_back(rec);
        ++run.metrics.llm_calls;
        return out.error();
    }
    rec.chars_out = out.value().size();
    run.metrics.calls.push_back(rec);
    ++run.metrics.llm_calls;
    return out;
}

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

    const WebResearchResult web = prepare_web(config, run);
    const std::string web_sec = web.prompt_section();
    const bool tools_live = config.enable_web_tools && web.used;

    const auto& ba = pack.branches[0];
    const auto& bb = pack.branches[1];
    const FrameOptions branch_opts = make_frame_opts(config, cap, pack, {}, web_sec, tools_live);

    // Dual-path model routing: model_a / model_b (else shared provider).
    AnyProvider prov_a = provider;
    AnyProvider prov_b = provider;
    AnyProvider prov_merge = provider;
    if (!config.model_a.empty() || !config.model_b.empty() || !config.model_merge.empty()) {
        auto pa = provider_for_model(config, cache_, config.model_a.empty() ? config.model : config.model_a);
        auto pb = provider_for_model(config, cache_, config.model_b.empty() ? config.model : config.model_b);
        auto pm = provider_for_model(
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
    HandoffState h_a_arch = emit_via_protocol(make_fusion_step_handoff(
        config.task, ba.architect.agent_name,
        ultra ? ba.skeptic.agent_name : pack.merger.agent_name,
        ba.label, out_a.value(), cap, "architect"
    ));
    HandoffState h_b_arch = emit_via_protocol(make_fusion_step_handoff(
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
        FrameOptions sk_opts_a = make_frame_opts(
            config, cap, pack, format_handoff_prompt_section(h_a_arch), web_sec, tools_live
        );
        FrameOptions sk_opts_b = make_frame_opts(
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
        h_a_sk = emit_via_protocol(make_fusion_step_handoff(
            config.task, ba.skeptic.agent_name, pack.merger.agent_name,
            ba.label, sk_a, cap, "skeptic"
        ));
        h_b_sk = emit_via_protocol(make_fusion_step_handoff(
            config.task, bb.skeptic.agent_name, pack.merger.agent_name,
            bb.label, sk_b, cap, "skeptic"
        ));
    }

    // Merge-ready handoffs carry combined branch state with structured fields.
    HandoffState h_a_merge = emit_via_protocol(make_fusion_step_handoff(
        config.task,
        ultra ? "BranchA_Team" : ba.architect.agent_name,
        pack.merger.agent_name,
        ba.label, a_final, cap, "merge_ready"
    ));
    HandoffState h_b_merge = emit_via_protocol(make_fusion_step_handoff(
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
        make_frame_opts(config, cap, pack, {}, web_sec, tools_live, analysis_sec);
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

Result<FusionRunResult> FusionEngine::run_dag(const FusionConfig& config, AnyProvider provider) {
    // DAG mode: run N architect branches (up to branch_count) then one merge (no skeptics).
    FusionRunResult run;
    run.run_id = make_fusion_run_id();
    run.config = config;
    const auto wall0 = fusion_now_unix_ms();
    auto pack = make_role_pack(config.profile);
    const FusionCapabilityPack cap = fusion_capability_pack(config.tier);
    const WebResearchResult web = prepare_web(config, run);
    const std::string web_sec = web.prompt_section();
    const bool tools_live = config.enable_web_tools && web.used;
    const FrameOptions branch_opts = make_frame_opts(config, cap, pack, {}, web_sec, tools_live);
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
        FusionBranchOutput bo;
        bo.branch_id = br.branch_id;
        bo.label = br.label;
        bo.architect_output = out.value();
        bo.combined = out.value();
        run.branches.push_back(bo);
        labeled.emplace_back(br.label, out.value());

        auto h = emit_via_protocol(make_fusion_step_handoff(
            config.task, br.architect.agent_name, pack.merger.agent_name,
            br.label, out.value(), cap, "architect"
        ));
        handoff_sections.push_back(format_handoff_prompt_section(h));
        run.handoffs.push_back(std::move(h));
    }

    std::string analysis_sec;
    PanelJudgeReport pre_judge;
    if (config.attach_panel_judge) {
        pre_judge = judge_branch_outputs_as_panel(config.task, labeled, {}, "dag-pre");
        analysis_sec = pre_judge.merge_prompt_section();
    }
    FrameOptions merge_opts =
        make_frame_opts(config, cap, pack, {}, web_sec, tools_live, analysis_sec);
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
        panel_judge_json = pj.to_json();
        analysis_json = pj.analysis_json();
        run.metrics.scores["panel_judge"] = panel_judge_json;
    }

    run.report = {
        {"run_id", run.run_id},
        {"mode", "dag"},
        {"profile", fusion_profile_to_string(config.profile)},
        {"tier", fusion_tier_to_string(config.tier)},
        {"tier_display", fusion_tier_spec(config.tier).display_name},
        {"capability", cap.to_json()},
        {"branch_count", n},
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
        auto prov = provider_for_model(config, cache_, model_override, spec.provider);
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

Result<FusionRunResult> FusionEngine::run_with_provider(const FusionConfig& config, AnyProvider provider) {
    auto v = validate_fusion_config(config);
    if (!v) return v.error();

    switch (config.mode) {
        case FusionMode::Lean:
            return run_lean_ultra(config, std::move(provider), false);
        case FusionMode::Ultra:
            return run_lean_ultra(config, std::move(provider), true);
        case FusionMode::Dag:
            return run_dag(config, std::move(provider));
        case FusionMode::Panel:
            // Panel builds its own per-slot providers (multi-model).
            return run_panel(config);
    }
    return Error::invalid_argument("unknown mode");
}

Result<FusionRunResult> FusionEngine::run(const FusionConfig& config) {
    if (!cache_ && config.cache.enabled) {
        cache_ = std::make_shared<FusionCache>(config.cache);
    }
    if (config.mode == FusionMode::Panel) {
        auto result = run_panel(config);
        if (!result) return result;
        if (config.write_files) {
            auto arts = write_fusion_run(result.value());
            if (arts) result.value().artifact_paths = arts.value();
        }
        if (cache_) result.value().metrics.cache = cache_->stats();
        return result;
    }
    auto provider = make_fusion_provider(config, cache_);
    if (!provider) return provider.error();
    auto result = run_with_provider(config, std::move(provider.value()));
    if (!result) return result;

    if (config.write_files) {
        auto arts = write_fusion_run(result.value());
        if (arts) {
            result.value().artifact_paths = arts.value();
        }
    }
    if (cache_) result.value().metrics.cache = cache_->stats();
    return result;
}

Result<FusionRunResult> run_fusion(const FusionConfig& config) {
    FusionEngine engine;
    return engine.run(config);
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
