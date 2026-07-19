#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>

#include <cassert>
#include <cmath>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    assert(gradcheck_matmul(2e-2f));
    float err = gradcheck_linear_ce(1e-3f);
    std::cout << "gradcheck_linear_ce max_err=" << err << "\n";
    assert(err < 5e-2f);

    float loss = overfit_linear_sgd(250);
    std::cout << "overfit_linear_sgd final_loss=" << loss << "\n";
    assert(loss < 0.15f);

    // basic matmul
    Tensor a({2, 2});
    a.data = {1, 2, 3, 4};
    Tensor b({2, 2});
    b.data = {1, 0, 0, 1};
    auto c = matmul(a, b);
    assert(std::fabs(c.data[0] - 1.f) < 1e-5f);
    assert(std::fabs(c.data[3] - 4.f) < 1e-5f);

    std::cout << "test_ml_ops ok\n";
    return 0;
}
