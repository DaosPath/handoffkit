#include <handoffkit/demos/fusion/roles.hpp>

#include <fstream>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {

nlohmann::json RoleSpec::to_json() const {
    return nlohmann::json{
        {"role_id", role_id},
        {"agent_name", agent_name},
        {"system_role", system_role},
        {"focus", focus},
        {"is_skeptic", is_skeptic},
        {"is_merger", is_merger},
    };
}

nlohmann::json RolePack::to_json() const {
    nlohmann::json bs = nlohmann::json::array();
    for (const auto& b : branches) {
        bs.push_back({
            {"branch_id", b.branch_id},
            {"label", b.label},
            {"architect", b.architect.to_json()},
            {"skeptic", b.skeptic.to_json()},
        });
    }
    return nlohmann::json{
        {"profile", fusion_profile_to_string(profile)},
        {"description", description},
        {"task_faithful_merge", task_faithful_merge},
        {"shipping_merge_sections", shipping_merge_sections},
        {"branches", std::move(bs)},
        {"merger", merger.to_json()},
    };
}

RolePack make_role_pack(FusionProfileId profile) {
    switch (profile) {
        case FusionProfileId::Shipping: return make_shipping_pack();
        case FusionProfileId::Neutral: return make_neutral_pack();
        case FusionProfileId::Dialectic: return make_dialectic_pack();
        case FusionProfileId::Diagnostic: return make_diagnostic_pack();
        case FusionProfileId::Coding: return make_coding_pack();
        case FusionProfileId::Research: return make_research_pack();
        // Incident/product packs are file-first; map via string load if profile enum grows later.
        default: break;
    }
    return make_neutral_pack();
}

RolePack make_shipping_pack() {
    RolePack p;
    p.profile = FusionProfileId::Shipping;
    p.description = "Legacy HandoffKit C++ shipping: library-first vs CLI-first";
    p.task_faithful_merge = false;
    p.shipping_merge_sections = true;
    BranchRolePair a;
    a.branch_id = "a";
    a.label = "library-first";
    a.architect = {
        "ship_lib_arch", "BranchA_Architect",
        "You propose a library-first C++ packaging design (CMake/Conan/headers/providers). Be concrete and concise.",
        "Focus on API surface, install/export, providers, and wire parity. Max 10 short bullets.",
        false, false
    };
    a.skeptic = {
        "ship_lib_sk", "BranchA_Skeptic",
        "You stress-test packaging, ABI, dependency, and adoption risks. Be blunt and practical.",
        "library-first packaging risks",
        true, false
    };
    BranchRolePair b;
    b.branch_id = "b";
    b.label = "CLI-first";
    b.architect = {
        "ship_cli_arch", "BranchB_Architect",
        "You propose a CLI-first operator UX design (commands, demos, reports). Be concrete and concise.",
        "Focus on handoffkit-cli UX, demos, reports, and operator workflows. Max 10 short bullets.",
        false, false
    };
    b.skeptic = {
        "ship_cli_sk", "BranchB_Skeptic",
        "You stress-test CLI UX, operator mistakes, and support burden. Be blunt and practical.",
        "CLI-first operator risks",
        true, false
    };
    p.branches = {std::move(a), std::move(b)};
    p.merger = {
        "ship_merge", "Merger",
        "You merge design branches into one coherent production plan. Deduplicate, pick best ideas, list risks and next steps.",
        "",
        false, true
    };
    return p;
}

RolePack make_neutral_pack() {
    RolePack p;
    p.profile = FusionProfileId::Neutral;
    p.description = "Task-agnostic dual approach + optional skeptics + faithful merge";
    p.task_faithful_merge = true;
    p.shipping_merge_sections = false;
    BranchRolePair a;
    a.branch_id = "a";
    a.label = "approach-A";
    a.architect = {
        "neu_a", "BranchA_Architect",
        "You solve the user task from Approach A: emphasize structure, invariants, and explicit assumptions. Stay on-task.",
        "Develop Approach A thoroughly. Do not change the domain of the task.",
        false, false
    };
    a.skeptic = {
        "neu_a_sk", "BranchA_Skeptic",
        "You critique Approach A for gaps, weak evidence, and hidden assumptions. Stay in the task domain.",
        "approach-A critique",
        true, false
    };
    BranchRolePair b;
    b.branch_id = "b";
    b.label = "approach-B";
    b.architect = {
        "neu_b", "BranchB_Architect",
        "You solve the user task from Approach B: emphasize alternatives, edge cases, and pragmatic tradeoffs. Stay on-task.",
        "Develop Approach B thoroughly. Do not change the domain of the task.",
        false, false
    };
    b.skeptic = {
        "neu_b_sk", "BranchB_Skeptic",
        "You critique Approach B for gaps, weak evidence, and hidden assumptions. Stay in the task domain.",
        "approach-B critique",
        true, false
    };
    p.branches = {std::move(a), std::move(b)};
    p.merger = {
        "neu_merge", "Merger",
        "You merge both approaches into the single best answer to the ORIGINAL user task. Never invent unrelated product plans.",
        "",
        false, true
    };
    return p;
}

RolePack make_dialectic_pack() {
    RolePack p;
    p.profile = FusionProfileId::Dialectic;
    p.description = "Thesis vs antithesis then synthesis";
    p.task_faithful_merge = true;
    BranchRolePair a;
    a.branch_id = "a";
    a.label = "thesis";
    a.architect = {
        "dia_th", "Thesis",
        "Argue the strongest thesis that answers the user task. Steelman it.",
        "State thesis, supporting points, and predicted objections.",
        false, false
    };
    a.skeptic = {
        "dia_th_sk", "ThesisSkeptic",
        "Attack the thesis for overclaiming and missing counterexamples.",
        "thesis risks",
        true, false
    };
    BranchRolePair b;
    b.branch_id = "b";
    b.label = "antithesis";
    b.architect = {
        "dia_an", "Antithesis",
        "Argue the strongest opposing or alternative answer to the same user task.",
        "State antithesis and why thesis fails.",
        false, false
    };
    b.skeptic = {
        "dia_an_sk", "AntithesisSkeptic",
        "Attack the antithesis for overclaiming and missing evidence.",
        "antithesis risks",
        true, false
    };
    p.branches = {std::move(a), std::move(b)};
    p.merger = {
        "dia_syn", "Synthesis",
        "Synthesize thesis and antithesis into a balanced final answer to the original task.",
        "",
        false, true
    };
    return p;
}

RolePack make_diagnostic_pack() {
    RolePack p;
    p.profile = FusionProfileId::Diagnostic;
    p.description = "Clinical-style dual clinician panel (research/benchmark only)";
    p.task_faithful_merge = true;
    BranchRolePair a;
    a.branch_id = "a";
    a.label = "clinician-A";
    a.architect = {
        "dx_a", "ClinicianA",
        "You are Clinician A (research only, not medical advice). Diagnose from the vignette only; do not invent labs.",
        "Give primary diagnosis, top differentials, key findings, next tests, confidence.",
        false, false
    };
    a.skeptic = {
        "dx_a_sk", "SafetySkepticA",
        "Critique diagnostic reasoning for missing red flags, alternative explanations, and overconfidence.",
        "diagnostic safety",
        true, false
    };
    BranchRolePair b;
    b.branch_id = "b";
    b.label = "clinician-B";
    b.architect = {
        "dx_b", "ClinicianB",
        "You are Clinician B (research only). Independent second opinion from the same vignette only.",
        "Give primary diagnosis, top differentials, key findings, next tests, confidence.",
        false, false
    };
    b.skeptic = {
        "dx_b_sk", "SafetySkepticB",
        "Critique second opinion for bias and unsupported leaps.",
        "second-opinion critique",
        true, false
    };
    p.branches = {std::move(a), std::move(b)};
    p.merger = {
        "dx_merge", "PanelChair",
        "Merge both clinicians into one final structured answer to the diagnostic task. Research only. No product/CLI plans.",
        "",
        false, true
    };
    return p;
}

RolePack make_coding_pack() {
    RolePack p;
    p.profile = FusionProfileId::Coding;
    p.description = "Design-focused vs risk-focused software answers";
    p.task_faithful_merge = true;
    BranchRolePair a;
    a.branch_id = "a";
    a.label = "design";
    a.architect = {
        "code_d", "DesignLead",
        "Propose a clear software design that answers the user task (APIs, modules, data flow).",
        "Be concrete: types, boundaries, failure modes.",
        false, false
    };
    a.skeptic = {
        "code_d_sk", "DesignSkeptic",
        "Critique design complexity, coupling, and missing tests.",
        "design risks",
        true, false
    };
    BranchRolePair b;
    b.branch_id = "b";
    b.label = "delivery-risks";
    b.architect = {
        "code_r", "RiskEngineer",
        "Answer the same task emphasizing delivery risks, rollbacks, observability, and test strategy.",
        "Practical risks and mitigations.",
        false, false
    };
    b.skeptic = {
        "code_r_sk", "RiskSkeptic",
        "Critique whether risks are actionable and prioritized.",
        "risk-plan gaps",
        true, false
    };
    p.branches = {std::move(a), std::move(b)};
    p.merger = {
        "code_m", "TechMerger",
        "Merge design and risk views into one actionable engineering answer to the original task.",
        "",
        false, true
    };
    return p;
}

RolePack make_research_pack() {
    RolePack p;
    p.profile = FusionProfileId::Research;
    p.description = "Answer-first research panel: evidence vs counter-evidence with calibrated merge";
    p.task_faithful_merge = true;
    p.shipping_merge_sections = false;
    BranchRolePair a;
    a.branch_id = "a";
    a.label = "evidence";
    a.architect = {
        "res_ev", "EvidenceAnalyst",
        "You are a research evidence analyst. FIRST give your best direct answer to the ORIGINAL "
        "task (name/number/verdict/best hypothesis + confidence 0-100). THEN marshall supporting "
        "claims, separating facts vs inferences vs unknowns. Prefer verifiable structure. "
        "Do not invent product roadmaps or shipping plans. Do not refuse if a best answer exists.",
        "Answer-first; then facts, inferences, unknowns; note confidence; stay on-task.",
        false, false
    };
    a.skeptic = {
        "res_ev_sk", "EvidenceSkeptic",
        "Challenge weak evidence and overclaim, but keep the best answer if still best-supported. "
        "Flag domain drift. Stay on the research task.",
        "evidence quality; protect the direct answer if still warranted",
        true, false
    };
    BranchRolePair b;
    b.branch_id = "b";
    b.label = "counter-evidence";
    b.architect = {
        "res_ce", "CounterAnalyst",
        "You are a counter-evidence analyst. Still start with your best direct answer to the SAME "
        "task, then stress disconfirming evidence, alternative hypotheses, and falsification tests. "
        "Stay on-task. Alternatives must still answer the original question.",
        "Answer-first; then what would falsify it; alternatives; residual risks.",
        false, false
    };
    b.skeptic = {
        "res_ce_sk", "CounterSkeptic",
        "Challenge contrarianism that ignores strong evidence; keep the original task domain; "
        "do not erase a concrete best answer without a stronger replacement.",
        "counter-evidence balance",
        true, false
    };
    p.branches = {std::move(a), std::move(b)};
    p.merger = {
        "res_m", "ResearchMerger",
        "Merge into ONE final answer to the ORIGINAL task. Open with the best direct answer "
        "(and confidence). Then consensus, disagreements, residual uncertainty, and open questions. "
        "Preserve specific names/numbers/claims from branches when they are the strongest option. "
        "Never invent unrelated shipping/CLI/product roadmaps. "
        "Avoid pure process essays that never answer the question.",
        "",
        false, true
    };
    return p;
}

RolePack make_incident_pack() {
    RolePack p;
    p.profile = FusionProfileId::Neutral;
    p.description = "Incident response: mitigate vs communicate dual panel";
    p.task_faithful_merge = true;
    BranchRolePair a;
    a.branch_id = "a";
    a.label = "mitigate";
    a.architect = {
        "inc_mit", "OncallLead",
        "You are on-call. Answer the incident task with containment, blast radius, and rollback steps.",
        "Mitigation-first; concrete commands/checks; stay on the incident.",
        false, false
    };
    a.skeptic = {
        "inc_mit_sk", "SRESkeptic",
        "Critique mitigation for missing detection, incomplete rollback, or silent data loss.",
        "mitigation gaps",
        true, false
    };
    BranchRolePair b;
    b.branch_id = "b";
    b.label = "comms";
    b.architect = {
        "inc_com", "CommsLead",
        "Answer the same incident with stakeholder comms, status pages, and escalation paths.",
        "Clear audiences, cadences, and what not to promise.",
        false, false
    };
    b.skeptic = {
        "inc_com_sk", "CommsSkeptic",
        "Critique for PR fluff, missing legal/security constraints, and unclear owners.",
        "comms risks",
        true, false
    };
    p.branches = {std::move(a), std::move(b)};
    p.merger = {
        "inc_m", "IncidentCommander",
        "Merge mitigation and comms into one incident action plan for the original task.",
        "",
        false, true
    };
    return p;
}

RolePack make_product_pack() {
    RolePack p;
    p.profile = FusionProfileId::Neutral;
    p.description = "Product dual view: user value vs feasibility";
    p.task_faithful_merge = true;
    BranchRolePair a;
    a.branch_id = "a";
    a.label = "user-value";
    a.architect = {
        "prd_uv", "PM_UserValue",
        "Answer the product task emphasizing user jobs-to-be-done, success metrics, and scope.",
        "Concrete outcomes; avoid vague vision essays.",
        false, false
    };
    a.skeptic = {
        "prd_uv_sk", "PMSkeptic",
        "Critique vanity metrics, underspecified users, and scope creep.",
        "product definition gaps",
        true, false
    };
    BranchRolePair b;
    b.branch_id = "b";
    b.label = "feasibility";
    b.architect = {
        "prd_fe", "TechPM_Feasibility",
        "Answer the same task emphasizing delivery feasibility, dependencies, and sequencing.",
        "Milestones, risks, and cut lines.",
        false, false
    };
    b.skeptic = {
        "prd_fe_sk", "FeasibilitySkeptic",
        "Critique hidden tech debt, staffing assumptions, and false precision.",
        "delivery risks",
        true, false
    };
    p.branches = {std::move(a), std::move(b)};
    p.merger = {
        "prd_m", "ProductMerger",
        "Merge user-value and feasibility into one prioritized product answer to the original task.",
        "",
        false, true
    };
    return p;
}

Result<void> validate_role_pack(const RolePack& pack) {
    if (pack.branches.size() < 2) {
        return Result<void>::failure(Error::invalid_argument("role pack needs >= 2 branches"));
    }
    if (pack.merger.system_role.empty() || pack.merger.agent_name.empty()) {
        return Result<void>::failure(
            Error::invalid_argument("role pack merger system_role/agent_name required")
        );
    }
    for (const auto& b : pack.branches) {
        if (b.architect.system_role.empty() || b.architect.agent_name.empty()) {
            return Result<void>::failure(Error::invalid_argument(
                "branch " + b.branch_id + " architect system_role/agent_name required"
            ));
        }
        if (b.architect.role_id.empty()) {
            return Result<void>::failure(
                Error::invalid_argument("branch " + b.branch_id + " architect role_id required")
            );
        }
    }
    if (pack.merger.role_id.empty()) {
        return Result<void>::failure(Error::invalid_argument("merger role_id required"));
    }
    return Result<void>::success();
}

namespace {

RoleSpec role_from_json(const nlohmann::json& j) {
    RoleSpec r;
    r.role_id = j.value("role_id", "");
    r.agent_name = j.value("agent_name", "");
    r.system_role = j.value("system_role", "");
    r.focus = j.value("focus", "");
    r.is_skeptic = j.value("is_skeptic", false);
    r.is_merger = j.value("is_merger", false);
    return r;
}

}  // namespace

Result<RolePack> role_pack_from_json(const nlohmann::json& j) {
    try {
        RolePack p;
        if (j.contains("profile")) {
            auto pr = fusion_profile_from_string(j.at("profile").get<std::string>());
            if (pr) p.profile = pr.value();
        }
        p.description = j.value("description", "");
        p.task_faithful_merge = j.value("task_faithful_merge", true);
        p.shipping_merge_sections = j.value("shipping_merge_sections", false);
        if (!j.contains("branches") || !j.at("branches").is_array()) {
            return Error::invalid_argument("role pack JSON needs branches array");
        }
        for (const auto& bj : j.at("branches")) {
            BranchRolePair br;
            br.branch_id = bj.value("branch_id", "");
            br.label = bj.value("label", br.branch_id);
            if (bj.contains("architect")) br.architect = role_from_json(bj.at("architect"));
            if (bj.contains("skeptic")) br.skeptic = role_from_json(bj.at("skeptic"));
            p.branches.push_back(std::move(br));
        }
        if (j.contains("merger")) p.merger = role_from_json(j.at("merger"));
        p.merger.is_merger = true;
        auto v = validate_role_pack(p);
        if (!v) return v.error();
        return p;
    } catch (const std::exception& ex) {
        return Error::invalid_argument(std::string("role pack JSON: ") + ex.what());
    }
}

Result<RolePack> load_role_pack_file(const std::filesystem::path& path) {
    std::ifstream in(path);
    if (!in) {
        return Error::invalid_argument("cannot open role pack: " + path.string(), "path");
    }
    try {
        nlohmann::json j;
        in >> j;
        return role_pack_from_json(j);
    } catch (const std::exception& ex) {
        return Error::parse_error(std::string("role pack parse: ") + ex.what());
    }
}

std::string format_role_pack_text(const RolePack& pack) {
    std::ostringstream ss;
    ss << "profile=" << fusion_profile_to_string(pack.profile) << "\n"
       << "description=" << pack.description << "\n"
       << "task_faithful_merge=" << (pack.task_faithful_merge ? "true" : "false") << "\n"
       << "branches=" << pack.branches.size() << "\n";
    for (const auto& b : pack.branches) {
        ss << "branch id=" << b.branch_id << " label=" << b.label << "\n"
           << "  architect role_id=" << b.architect.role_id
           << " agent=" << b.architect.agent_name << "\n"
           << "  architect system_role=" << b.architect.system_role.substr(0, 120)
           << (b.architect.system_role.size() > 120 ? "..." : "") << "\n"
           << "  skeptic role_id=" << b.skeptic.role_id
           << " agent=" << b.skeptic.agent_name << "\n";
    }
    ss << "merger role_id=" << pack.merger.role_id << " agent=" << pack.merger.agent_name << "\n"
       << "merger system_role=" << pack.merger.system_role.substr(0, 160)
       << (pack.merger.system_role.size() > 160 ? "..." : "") << "\n"
       << "json=\n" << pack.to_json().dump(2) << "\n";
    return ss.str();
}

std::string explain_fusion_plan(const FusionConfig& config) {
    FusionConfig cfg = config;
    // Tier fills branch_count / policy / labels, but mode on the input config is
    // authoritative (CLI applies tier then may override with --mode).
    const FusionMode mode = cfg.mode;
    apply_fusion_tier(cfg, cfg.tier);
    cfg.mode = mode;
    const RolePack pack = make_role_pack(cfg.profile);
    const int planned = planned_llm_calls_for_config(cfg);
    std::ostringstream ss;
    ss << "fusion explain\n"
       << "tier=" << fusion_tier_to_string(cfg.tier) << "\n"
       << "mode=" << fusion_mode_to_string(cfg.mode) << "\n"
       << "profile=" << fusion_profile_to_string(cfg.profile) << "\n"
       << "branches=" << pack.branches.size() << "\n"
       << "branch_count_config=" << cfg.branch_count << "\n"
       << "planned_llm_calls=" << planned << "\n"
       << "attach_panel_judge=" << (cfg.attach_panel_judge ? "true" : "false") << "\n"
       << "cache_enabled=" << (cfg.cache.enabled ? "true" : "false") << "\n"
       << "call_plan:\n";
    if (cfg.mode == FusionMode::Panel) {
        ss << "  - panel: one LLM call per panel model/role (+ optional meta judge)\n";
    } else if (cfg.mode == FusionMode::Dag) {
        ss << "  - dag: architect per branch (parallel DAG), then merger\n";
        for (const auto& b : pack.branches) {
            ss << "  - branch " << b.branch_id << " architect (" << b.architect.role_id << ")\n";
        }
        ss << "  - merge (" << pack.merger.role_id << ")\n";
    } else {
        // lean / ultra
        for (const auto& b : pack.branches) {
            ss << "  - branch " << b.branch_id << " architect (" << b.architect.role_id << ")\n";
            if (cfg.mode == FusionMode::Ultra) {
                ss << "  - branch " << b.branch_id << " skeptic (" << b.skeptic.role_id
                   << ") [ultra; may skip on high overlap]\n";
            }
        }
        ss << "  - merge (" << pack.merger.role_id << ")\n";
    }
    ss << "roles_summary:\n" << format_role_pack_text(pack);
    return ss.str();
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit

