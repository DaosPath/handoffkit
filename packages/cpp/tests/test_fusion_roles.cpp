#include <handoffkit/demos/fusion/roles.hpp>
#include <handoffkit/demos/fusion/types.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>

int main() {
    using namespace handoffkit::demos::fusion;
    namespace fs = std::filesystem;

    // Built-in packs validate
    for (auto id : {FusionProfileId::Neutral, FusionProfileId::Shipping, FusionProfileId::Coding,
                    FusionProfileId::Research, FusionProfileId::Dialectic, FusionProfileId::Diagnostic}) {
        auto p = make_role_pack(id);
        auto v = validate_role_pack(p);
        if (!v) {
            std::cerr << "builtin pack invalid: " << fusion_profile_to_string(id) << " "
                      << v.error().message << "\n";
            return 1;
        }
        if (p.branches.size() < 2 || p.merger.system_role.empty()) {
            std::cerr << "builtin pack structure\n";
            return 1;
        }
    }
    auto inc = make_incident_pack();
    auto prd = make_product_pack();
    if (!validate_role_pack(inc) || !validate_role_pack(prd)) {
        std::cerr << "incident/product pack invalid\n";
        return 1;
    }
    std::cout << "builtin packs ok\n";

    // Round-trip JSON → load file
    const auto dir = fs::current_path() / "test_artifacts_fusion_roles";
    std::error_code ec;
    fs::create_directories(dir, ec);
    const auto path = dir / "custom_pack.json";
    {
        auto neutral = make_neutral_pack();
        std::ofstream o(path);
        o << neutral.to_json().dump(2);
    }
    auto loaded = load_role_pack_file(path);
    if (!loaded) {
        std::cerr << "load failed: " << loaded.error().message << "\n";
        return 1;
    }
    auto lv = validate_role_pack(loaded.value());
    if (!lv) {
        std::cerr << "loaded invalid: " << lv.error().message << "\n";
        return 1;
    }
    if (loaded.value().branches.size() < 2 ||
        loaded.value().merger.system_role.empty() ||
        loaded.value().branches[0].architect.system_role.empty()) {
        std::cerr << "loaded structure incomplete\n";
        return 1;
    }
    std::cout << "load_role_pack_file ok branches=" << loaded.value().branches.size() << "\n";

    auto text = format_role_pack_text(loaded.value());
    if (text.find("role_id=") == std::string::npos || text.find("merger") == std::string::npos) {
        std::cerr << "format_role_pack_text weak\n";
        return 1;
    }

    FusionConfig cfg;
    cfg.tier = FusionTier::Medium;
    cfg.profile = FusionProfileId::Neutral;
    apply_fusion_tier(cfg, cfg.tier);  // Medium → mode=Lean
    auto plan = explain_fusion_plan(cfg);
    if (plan.find("planned_llm_calls=") == std::string::npos ||
        plan.find("call_plan:") == std::string::npos ||
        plan.find("mode=lean") == std::string::npos) {
        std::cerr << "explain_fusion_plan lean weak\n" << plan << "\n";
        return 1;
    }
    std::cout << "explain sample lines:\n"
              << plan.substr(0, 200) << "\n";

    // Explicit --mode override must survive explain (tier re-apply must not clobber).
    // Mirrors CLI: apply_fusion_tier(medium) then cfg.mode = Ultra.
    FusionConfig ultra_cfg;
    ultra_cfg.tier = FusionTier::Medium;
    ultra_cfg.profile = FusionProfileId::Neutral;
    apply_fusion_tier(ultra_cfg, ultra_cfg.tier);
    ultra_cfg.mode = FusionMode::Ultra;
    auto ultra_plan = explain_fusion_plan(ultra_cfg);
    if (ultra_plan.find("mode=ultra") == std::string::npos) {
        std::cerr << "explain must keep mode=ultra after medium tier\n" << ultra_plan << "\n";
        return 1;
    }
    if (ultra_plan.find("skeptic") == std::string::npos) {
        std::cerr << "ultra call_plan must list skeptic steps\n" << ultra_plan << "\n";
        return 1;
    }
    if (ultra_plan.find("planned_llm_calls=5") == std::string::npos) {
        std::cerr << "ultra planned_llm_calls expected 5\n" << ultra_plan << "\n";
        return 1;
    }
    std::cout << "explain ultra override ok (mode=ultra + skeptic lines)\n";
    std::cout << "test_fusion_roles ok\n";
    return 0;
}
