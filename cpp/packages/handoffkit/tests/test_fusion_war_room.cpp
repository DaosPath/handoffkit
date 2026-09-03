#include <handoffkit/demos/fusion/war_room.hpp>

#include <cassert>
#include <iostream>

using namespace handoffkit::demos::fusion;

int main() {
    WarRoomOptions o;
    o.task = "Primary diagnosis: hypokalemia + high aldosterone + low renin. Name it.";
    o.provider = "echo";
    o.profile = FusionProfileId::Research;
    o.tiers = {"lite", "pro"};
    o.cache_enabled = false;

    auto r = run_fusion_war_room(o);
    assert(r);
    assert(r.value().rows.size() == 2);
    assert(r.value().rows[0].tier == "lite");
    assert(r.value().rows[0].success);
    assert(r.value().rows[0].llm_calls == 3);
    assert(r.value().rows[1].tier == "pro");
    assert(r.value().rows[1].success);
    assert(r.value().rows[1].llm_calls == 5);
    assert(r.value().total_wall_ms >= 0);
    const auto md = r.value().to_markdown();
    assert(md.find("Fusion War Room") != std::string::npos);
    assert(md.find("| lite |") != std::string::npos);
    const auto j = r.value().to_json();
    assert(j["tiers"].size() == 2);
    std::cout << "test_fusion_war_room ok wall_ms=" << r.value().total_wall_ms << "\n";
    return 0;
}
