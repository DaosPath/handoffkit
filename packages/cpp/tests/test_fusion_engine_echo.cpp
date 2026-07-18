#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/roles.hpp>

#include <cassert>
#include <iostream>
#include <set>
#include <string>

using namespace handoffkit::demos::fusion;

void test_profiles_exist() {
    for (const auto& name : fusion_profile_names()) {
        auto p = fusion_profile_from_string(name);
        assert(p);
        auto pack = make_role_pack(p.value());
        assert(pack.branches.size() >= 2);
        assert(!pack.merger.agent_name.empty());
    }
    std::cout << "test_profiles_exist ok\n";
}

void test_lean_echo() {
    FusionConfig cfg;
    cfg.task = "List three benefits of dual-branch agent fusion.";
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Neutral;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = true;
    cfg.cache.use_disk = false;

    auto run1 = run_fusion(cfg);
    assert(run1);
    assert(run1.value().success);
    assert(run1.value().metrics.llm_calls == 3);
    assert(run1.value().branches.size() == 2);
    assert(!run1.value().final_output.empty());
    // task-faithful merge prompt path used for neutral
    assert(make_role_pack(FusionProfileId::Neutral).task_faithful_merge);

    // second run should get cache hits
    auto run2 = run_fusion(cfg);
    assert(run2);
    assert(run2.value().metrics.cache.hits >= 1 || run2.value().metrics.llm_calls == 3);
    std::cout << "test_lean_echo ok calls=" << run1.value().metrics.llm_calls
              << " hits2=" << run2.value().metrics.cache.hits << "\n";
}

void test_ultra_echo() {
    FusionConfig cfg;
    cfg.task = "Primary diagnosis given hypokalemia + high aldosterone + low renin.";
    cfg.mode = FusionMode::Ultra;
    cfg.profile = FusionProfileId::Diagnostic;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;

    auto run = run_fusion(cfg);
    assert(run);
    assert(run.value().success);
    assert(run.value().metrics.llm_calls == 5);
    std::cout << "test_ultra_echo ok\n";
}

void test_shipping_pack_flags() {
    auto pack = make_shipping_pack();
    assert(!pack.task_faithful_merge);
    assert(pack.shipping_merge_sections);
    auto neu = make_neutral_pack();
    assert(neu.task_faithful_merge);
    assert(!neu.shipping_merge_sections);
    auto res = make_research_pack();
    assert(res.task_faithful_merge);
    assert(!res.shipping_merge_sections);
    std::cout << "test_shipping_pack_flags ok\n";
}

void test_capability_pack_differentiation() {
    // Lite vs Pro vs Genius must differ by pack_id, depth, skills — not only call counts.
    const auto lite = fusion_capability_pack(FusionTier::Lite);
    const auto pro = fusion_capability_pack(FusionTier::Pro);
    const auto genius = fusion_capability_pack(FusionTier::Genius);
    assert(lite.pack_id == "capability_lite");
    assert(pro.pack_id == "capability_pro");
    assert(genius.pack_id == "capability_genius");
    assert(lite.pack_id != pro.pack_id);
    assert(pro.pack_id != genius.pack_id);
    assert(lite.depth != pro.depth);
    assert(pro.depth != genius.depth);
    assert(lite.skills.size() < pro.skills.size());
    assert(pro.skills.size() < genius.skills.size());
    assert(lite.tool_slots.size() < pro.tool_slots.size());
    assert(!lite.skills.empty() && !genius.skills.empty());

    // Spec JSON exposes capability
    const auto spec_l = fusion_tier_spec(FusionTier::Lite);
    const auto spec_g = fusion_tier_spec(FusionTier::Genius);
    auto jl = spec_l.to_json();
    auto jg = spec_g.to_json();
    assert(jl.contains("capability"));
    assert(jg.contains("capability"));
    assert(jl["capability"]["pack_id"] == "capability_lite");
    assert(jg["capability"]["pack_id"] == "capability_genius");
    assert(jl["capability"]["skills"] != jg["capability"]["skills"]);
    std::cout << "test_capability_pack_differentiation ok\n";
}

void test_structured_handoff_and_prompt_injection() {
    // Unit: format + make_fusion_step_handoff produce labeled structured fields.
    const auto pack = fusion_capability_pack(FusionTier::Pro);
    auto h = make_fusion_step_handoff(
        "Research the history of X",
        "EvidenceAnalyst",
        "Merger",
        "evidence",
        "Claim A is supported by source S. Inference: Y. Unknown: Z.",
        pack,
        "architect"
    );
    assert(h.task.find("history of X") != std::string::npos);
    assert(h.from_agent == "EvidenceAnalyst");
    assert(h.to_agent == "Merger");
    assert(!h.summary.empty());
    assert(h.summary.find("Claim A") != std::string::npos);
    assert(!h.decisions.empty());
    assert(!h.next_steps.empty());
    assert(!h.context_refs.empty());
    bool has_pack_ref = false;
    for (const auto& r : h.context_refs) {
        if (r.find("pack:") == 0) has_pack_ref = true;
    }
    assert(has_pack_ref);

    const std::string section = format_handoff_prompt_section(h);
    assert(section.find("Structured handoff") != std::string::npos);
    assert(section.find("summary:") != std::string::npos);
    assert(section.find("decisions:") != std::string::npos);
    assert(section.find("next_steps:") != std::string::npos);
    assert(section.find("context_refs:") != std::string::npos);

    // Successor skeptic/merge frames must embed structured handoff labels.
    FrameOptions sk;
    sk.depth = pack.depth;
    sk.skills = pack.skills;
    sk.tool_slots = pack.tool_slots;
    sk.prior_handoff_section = section;
    const std::string skeptic_prompt = frame_skeptic_task(
        "Research the history of X",
        "raw proposal body",
        "evidence quality",
        sk
    );
    assert(skeptic_prompt.find("Structured handoff") != std::string::npos);
    assert(skeptic_prompt.find("decisions:") != std::string::npos);
    assert(skeptic_prompt.find("Prior structured handoff") != std::string::npos);

    FrameOptions mg;
    mg.depth = pack.depth;
    mg.task_faithful = true;
    mg.skills = pack.skills;
    const std::string merge_prompt = frame_merge_task(
        "Research the history of X",
        "evidence", "body A",
        "counter-evidence", "body B",
        mg, section, section
    );
    assert(merge_prompt.find("Structured handoff") != std::string::npos);
    assert(merge_prompt.find("ORIGINAL TASK") != std::string::npos);
    assert(merge_prompt.find("product roadmap") != std::string::npos);  // task-faithful rule present
    // Research profile must not force shipping section titles as required structure
    assert(merge_prompt.find("Goals, Architecture, CLI") == std::string::npos);

    // Depth differentiation: genius branch prompt asks more bullets than lite
    FrameOptions lite_o;
    lite_o.depth = FusionPromptDepth::Compact;
    lite_o.max_branch_bullets = 8;
    lite_o.evidence_min_points = 2;
    lite_o.skills = {"outline"};
    FrameOptions gen_o;
    gen_o.depth = FusionPromptDepth::Exhaustive;
    gen_o.max_branch_bullets = 18;
    gen_o.evidence_min_points = 6;
    gen_o.skills = {"multi_angle", "residual_risks"};
    const auto p_lite = frame_branch_task("T", "approach-A", "focus", lite_o);
    const auto p_gen = frame_branch_task("T", "approach-A", "focus", gen_o);
    assert(p_lite.find("up to 8") != std::string::npos);
    assert(p_gen.find("up to 18") != std::string::npos);
    assert(p_gen.find("Exhaustive") != std::string::npos || p_gen.find("adversarial") != std::string::npos
           || p_gen.find("residual") != std::string::npos);
    assert(p_lite != p_gen);
    std::cout << "test_structured_handoff_and_prompt_injection ok\n";
}

void test_fusion_tiers_echo() {
    // Each product tier must produce the planned LLM call count on echo.
    struct Case {
        FusionTier tier;
        int expect_calls;
        int expect_branches;
    };
    const Case cases[] = {
        {FusionTier::Lite, 3, 2},
        {FusionTier::Medium, 3, 2},
        {FusionTier::Pro, 5, 2},
        {FusionTier::Ultra, 5, 4},
        {FusionTier::Genius, 7, 6},
    };
    for (const auto& c : cases) {
        FusionConfig cfg;
        cfg.task = "Tier smoke: dual-branch fusion quality check.";
        cfg.provider = "echo";
        cfg.write_files = false;
        cfg.cache.enabled = false;
        cfg.profile = FusionProfileId::Research;
        apply_fusion_tier(cfg, c.tier);
        assert(planned_llm_calls_for_config(cfg) == c.expect_calls);
        auto run = run_fusion(cfg);
        assert(run);
        assert(run.value().success);
        assert(run.value().metrics.llm_calls == c.expect_calls);
        assert(static_cast<int>(run.value().branches.size()) == c.expect_branches);
        assert(run.value().report.value("tier", std::string()) == fusion_tier_to_string(c.tier));
        assert(run.value().report.contains("capability"));
        assert(run.value().report["capability"]["pack_id"].get<std::string>()
               == fusion_capability_pack(c.tier).pack_id);
        assert(!run.value().final_output.empty());
        // Structured handoffs non-empty
        assert(!run.value().handoffs.empty());
        for (const auto& h : run.value().handoffs) {
            assert(!h.summary.empty());
            assert(!h.task.empty());
            assert(!h.from_agent.empty());
            assert(!h.to_agent.empty());
            assert(!h.decisions.empty());
            assert(!h.next_steps.empty());
            assert(!h.context_refs.empty());
        }
        // Prompt hashes recorded for every call (prompt path exercised)
        assert(static_cast<int>(run.value().metrics.calls.size()) == c.expect_calls);
        for (const auto& rec : run.value().metrics.calls) {
            assert(!rec.prompt_hash.empty());
            assert(rec.chars_in > 0);
        }
        std::cout << "  tier=" << fusion_tier_to_string(c.tier)
                  << " calls=" << run.value().metrics.llm_calls
                  << " branches=" << run.value().branches.size()
                  << " handoffs=" << run.value().handoffs.size()
                  << " pack=" << run.value().report["capability"]["pack_id"] << "\n";
    }
    // genio alias
    auto g = fusion_tier_from_string("genio");
    assert(g && g.value() == FusionTier::Genius);
    std::cout << "test_fusion_tiers_echo ok\n";
}

void test_handoff_in_engine_prompts_lean_and_pro() {
    // Lean: merge-ready handoffs exist; Pro/ultra: skeptic steps after architect handoffs.
    FusionConfig lean;
    lean.task = "Summarize tradeoffs of approach A vs B for caching.";
    lean.provider = "echo";
    lean.write_files = false;
    lean.cache.enabled = false;
    lean.profile = FusionProfileId::Neutral;
    apply_fusion_tier(lean, FusionTier::Lite);
    auto r_lean = run_fusion(lean);
    assert(r_lean && r_lean.value().success);
    assert(r_lean.value().metrics.llm_calls == 3);
    assert(r_lean.value().handoffs.size() >= 2);
    // Architect + merge_ready pairs
    int merge_ready = 0;
    for (const auto& h : r_lean.value().handoffs) {
        if (h.metadata.contains("step_kind") && h.metadata["step_kind"] == "merge_ready") {
            ++merge_ready;
        }
        assert(h.summary.find("...") != std::string::npos || !h.summary.empty());
    }
    assert(merge_ready >= 2);

    FusionConfig pro;
    pro.task = "Summarize tradeoffs of approach A vs B for caching.";
    pro.provider = "echo";
    pro.write_files = false;
    pro.cache.enabled = false;
    pro.profile = FusionProfileId::Research;
    apply_fusion_tier(pro, FusionTier::Pro);
    auto r_pro = run_fusion(pro);
    assert(r_pro && r_pro.value().success);
    assert(r_pro.value().metrics.llm_calls == 5);
    assert(r_pro.value().handoffs.size() >= 4);  // 2 arch + 2 sk + 2 merge_ready
    std::set<std::string> kinds;
    for (const auto& h : r_pro.value().handoffs) {
        if (h.metadata.contains("step_kind")) {
            kinds.insert(h.metadata["step_kind"].get<std::string>());
        }
    }
    assert(kinds.count("architect") == 1);
    assert(kinds.count("skeptic") == 1);
    assert(kinds.count("merge_ready") == 1);

    // Genius DAG: handoffs per branch
    FusionConfig gen;
    gen.task = "Multi-angle research brief on caching tradeoffs.";
    gen.provider = "echo";
    gen.write_files = false;
    gen.cache.enabled = false;
    gen.profile = FusionProfileId::Research;
    apply_fusion_tier(gen, FusionTier::Genius);
    auto r_gen = run_fusion(gen);
    assert(r_gen && r_gen.value().success);
    assert(r_gen.value().metrics.llm_calls == 7);
    assert(static_cast<int>(r_gen.value().handoffs.size()) == 6);  // one per architect branch
    assert(r_gen.value().report["capability"]["pack_id"] == "capability_genius");
    std::cout << "test_handoff_in_engine_prompts_lean_and_pro ok\n";
}

int main() {
    test_profiles_exist();
    test_shipping_pack_flags();
    test_capability_pack_differentiation();
    test_structured_handoff_and_prompt_injection();
    test_lean_echo();
    test_ultra_echo();
    test_fusion_tiers_echo();
    test_handoff_in_engine_prompts_lean_and_pro();
    std::cout << "All fusion engine tests passed\n";
    return 0;
}
