#include <handoffkit/ml/qlora.hpp>

#include <cassert>
#include <cmath>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    std::mt19937 rng(1);
    Tensor W({64, 32});
    W.uniform(1.f, rng);
    auto q = quantize_nf4(W, 32);
    auto d = dequantize_nf4(q);
    float err = 0.f;
    for (std::size_t i = 0; i < W.numel(); ++i) err = std::max(err, std::fabs(W.data[i] - d.data[i]));
    std::cout << "nf4 max_abs_err=" << err << " packed=" << q.packed.size() << "\n";
    assert(err < 0.25f);  // nf4 is lossy
    assert(q.packed.size() * 2 >= W.numel());

    float loss = qlora_overfit_ce(350);
    std::cout << "qlora overfit final_loss=" << loss << "\n";
    assert(loss < 0.5f);

    std::cout << "test_ml_qlora ok\n";
    return 0;
}
