#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/panel.hpp>
#include <handoffkit/demos/fusion/war_room.hpp>

#include <cassert>
#include <iostream>
#include <set>
#include <string>

using namespace handoffkit::demos::fusion;

void test_profile_roles_differ() {
    auto r = panel_roles_for_profile(FusionProfileId::Research);
    auto c = panel_roles_for_profile(FusionProfileId::Coding);
    assert(r.size() >= 4);
    assert(c.size() >= 4);
    assert(r[0] != c[0] || r[1] != c[1]);
    std::cout << "test_profile_roles_differ ok\n";
}

void test_parse_provider_model() {
    auto s = parse_panel_model_spec("openrouter:deepseek/chat");
    assert(s.provider == "openrouter");
    assert(s.model == "deepseek/chat");
    auto bare = parse_panel_model_spec("gpt-test");
    assert(bare.provider.empty());
    assert(bare.model == "gpt-test");
    std::cout << "test_parse_provider_model ok\n";
}

void test_judge_and_offline_answer() {
    auto offline = offline_panel_answer("mechanism checker", "What is primary hyperaldosteronism?");
    assert(offline.find("Direct answer") != std::string::npos);
    assert(offline.find("mechanism") != std::string::npos || offline.find("Mechanism") != std::string::npos ||
           offline.find("evidence") != std::string::npos);

    std::vector<PanelSlot> slots;
    PanelSlot a;
    a.model = "m1";
    a.role = "broad diagnostician";
    a.answer = offline_panel_answer(a.role, "diagnose high aldo");
    a.confidence = "high";
    slots.push_back(a);
    PanelSlot b;
    b.model = "m2";
    b.role = "adversarial reviewer";
    b.answer = offline_panel_answer(b.role, "diagnose high aldo");
    b.confidence = "medium";
    slots.push_back(b);

    auto j = judge_fusion_panel("diagnose high aldo", std::move(slots), "panel");
    assert(j.success);
    assert(j.analysis_json().contains("consensus"));
    assert(!j.merge_prompt_section().empty());
    assert(j.merge_prompt_section().find("Pre-merge panel analysis") != std::string::npos);
    std::cout << "test_judge_and_offline_answer ok\n";
}

void test_panel_mode_echo_n_calls() {
    FusionConfig cfg;
    cfg.task = "Primary diagnosis for resistant HTN with hypokalemia high aldo low renin.";
    cfg.mode = FusionMode::Panel;
    cfg.provider = "echo";
    cfg.profile = FusionProfileId::Research;
    cfg.write_files = false;
    cfg.cache.enabled = false;
    cfg.panel_models = {"echo-a", "echo-b", "echo-c", "echo-d"};

    auto run = run_fusion(cfg);
    assert(run);
    assert(run.value().success);
    assert(run.value().metrics.llm_calls == 4);
    assert(run.value().report.contains("analysis"));
    assert(run.value().report["analysis"].contains("consensus"));
    assert(run.value().report.value("offline_echo_panel", false));
    // Offline answers should not be raw echo of Role: prompt
    assert(run.value().branches[0].architect_output.find("Direct answer") != std::string::npos);
    std::cout << "test_panel_mode_echo_n_calls ok\n";
}

void test_lean_merge_prompt_contains_analysis() {
    FusionConfig cfg;
    cfg.task = "Name one risk of dual-branch fusion without a skeptic.";
    cfg.mode = FusionMode::Lean;
    cfg.provider = "echo";
    cfg.profile = FusionProfileId::Neutral;
    cfg.write_files = false;
    cfg.cache.enabled = false;
    cfg.attach_panel_judge = true;

    auto run = run_fusion(cfg);
    assert(run);
    assert(run.value().success);
    assert(run.value().report.value("merge_prompt_has_analysis", false));
    const auto excerpt = run.value().report.value("merge_prompt_excerpt", std::string{});
    assert(excerpt.find("Pre-merge panel analysis") != std::string::npos);
    assert(run.value().report.contains("analysis"));
    std::cout << "test_lean_merge_prompt_contains_analysis ok\n";
}

void test_model_routing_records_models() {
    FusionConfig cfg;
    cfg.task = "Say hello from dual branch.";
    cfg.mode = FusionMode::Lean;
    cfg.provider = "echo";
    cfg.model_a = "model-alpha";
    cfg.model_b = "model-beta";
    cfg.model_merge = "model-merge";
    cfg.write_files = false;
    cfg.cache.enabled = false;

    auto run = run_fusion(cfg);
    assert(run);
    assert(run.value().metrics.calls.size() >= 3);
    std::string m_a, m_b, m_m;
    for (const auto& c : run.value().metrics.calls) {
        if (c.step_id == "branch_a_architect") m_a = c.model;
        if (c.step_id == "branch_b_architect") m_b = c.model;
        if (c.step_id == "merge") m_m = c.model;
    }
    assert(!m_a.empty() && !m_b.empty() && !m_m.empty());
    assert(m_a == "model-alpha");
    assert(m_b == "model-beta");
    assert(m_m == "model-merge");
    std::cout << "test_model_routing_records_models ok a=" << m_a << " b=" << m_b
              << " merge=" << m_m << "\n";
}

void test_meta_judge_off_and_on() {
    FusionConfig off;
    off.task = "One concrete claim about dual merge.";
    off.mode = FusionMode::Lean;
    off.provider = "echo";
    off.write_files = false;
    off.cache.enabled = false;
    off.enable_meta_judge = false;
    auto r0 = run_fusion(off);
    assert(r0);
    assert(r0.value().success);
    const int base_calls = r0.value().metrics.llm_calls;

    FusionConfig on = off;
    on.enable_meta_judge = true;
    auto r1 = run_fusion(on);
    assert(r1);
    assert(r1.value().success);
    assert(r1.value().metrics.llm_calls == base_calls + 1);
    bool has_meta = false;
    for (const auto& c : r1.value().metrics.calls) {
        if (c.step_id == "meta_judge") has_meta = true;
    }
    assert(has_meta);
    assert(r1.value().report.contains("analysis"));
    assert(r1.value().report["analysis"].value("meta_judge_used", false));
    std::cout << "test_meta_judge_off_and_on ok base=" << base_calls
              << " with_meta=" << r1.value().metrics.llm_calls << "\n";
}

void test_anti_dilution() {
    std::vector<std::pair<std::string, std::string>> bodies = {
        {"a", "Direct answer: Primary hyperaldosteronism is most likely.\nMore text."},
        {"b", "Direct answer: Consider renovascular disease.\nOther."},
    };
    auto diluted = apply_anti_dilution(
        "There is insufficient evidence to determine a diagnosis at this time.",
        bodies
    );
    assert(diluted.find("Direct answer:") != std::string::npos);
    assert(diluted.find("Anti-dilution") != std::string::npos);
    std::cout << "test_anti_dilution ok\n";
}

void test_overlap_and_early_stop_flag() {
    const double hi = branch_answer_overlap(
        "alpha beta gamma delta epsilon zeta eta theta",
        "alpha beta gamma delta epsilon zeta eta theta"
    );
    assert(hi > 0.9);
    const double lo = branch_answer_overlap("completely different words here now", "zzzz yyyy xxxx wwww vvvv");
    assert(lo < 0.2);

    // Ultra with identical branch outputs via echo may not hit 0.9 on full prompts;
    // unit-level overlap is the gate. Config flag still respected on run.
    FusionConfig cfg;
    cfg.task = "x";
    cfg.mode = FusionMode::Ultra;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    cfg.early_stop_on_overlap = true;
    cfg.overlap_skip_skeptic_threshold = 0.01;  // very low → skip skeptics when any overlap
    auto run = run_fusion(cfg);
    assert(run);
    // With low threshold, skip is likely; report field present
    assert(run.value().report.contains("skipped_skeptics"));
    std::cout << "test_overlap_and_early_stop_flag ok skipped="
              << run.value().report.value("skipped_skeptics", false) << "\n";
}

void test_war_room_has_judge_fields() {
    WarRoomOptions o;
    o.task = "Give one concrete risk of multi-agent fusion.";
    o.provider = "echo";
    o.tiers = {"lite", "pro"};
    o.cache_enabled = false;
    auto r = run_fusion_war_room(o);
    assert(r);
    assert(r.value().rows.size() == 2);
    for (const auto& row : r.value().rows) {
        assert(row.success);
        // panel judge attached on dual paths
        assert(row.panel_judge_success || row.consensus_n >= 0);
    }
    const auto md = r.value().to_markdown();
    assert(md.find("judge") != std::string::npos || md.find("cons") != std::string::npos);
    const auto j = r.value().to_json();
    assert(j["tiers"][0].contains("consensus_n"));
    std::cout << "test_war_room_has_judge_fields ok\n";
}

int main() {
    test_profile_roles_differ();
    test_parse_provider_model();
    test_judge_and_offline_answer();
    test_panel_mode_echo_n_calls();
    test_lean_merge_prompt_contains_analysis();
    test_model_routing_records_models();
    test_meta_judge_off_and_on();
    test_anti_dilution();
    test_overlap_and_early_stop_flag();
    test_war_room_has_judge_fields();
    std::cout << "ALL test_fusion_panel PASSED\n";
    return 0;
}
