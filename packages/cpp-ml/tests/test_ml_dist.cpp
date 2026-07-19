#include <handoffkit/ml/dist.hpp>

#include <cassert>
#include <cmath>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    assert(dist_api_world1_ok());
    assert(dist_allreduce_parity_ok());

    float l1 = dp_linear_ce_step(1, 80);
    float l2 = dp_linear_ce_step(2, 80);
    float l4 = dp_linear_ce_step(4, 80);
    std::cout << "dp loss world1=" << l1 << " world2=" << l2 << " world4=" << l4 << "\n";
    assert(l1 < 0.4f);
    assert(l2 < 0.5f);
    assert(l4 < 0.6f);

    auto ctx = make_dist_context(4, 1);
    assert(ctx.world_size == 4 && ctx.rank == 1 && ctx.backend == "cpu_sim");

    std::cout << "test_ml_dist ok\n";
    return 0;
}
