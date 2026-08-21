#include <handoffkit/demos/fusion/scenarios.hpp>

#include <cassert>
#include <iostream>

using namespace handoffkit::demos::fusion;

int main() {
    auto ids = fusion_scenario_ids();
    assert(ids.size() >= 10);
    auto all = run_all_fusion_scenarios();
    assert(all);
    int passed = 0;
    for (const auto& r : all.value()) {
        std::cout << (r.passed ? "PASS" : "FAIL") << " " << r.id << " - " << r.message << "\n";
        if (r.passed) ++passed;
        assert(r.passed);
    }
    std::cout << "All fusion scenarios passed (" << passed << ")\n";
    return 0;
}
