#include <handoffkit/ml/kernels.hpp>
#include <handoffkit/ml/ops.hpp>

#include <cassert>
#include <cmath>
#include <iostream>
#include <random>

int main() {
    using namespace handoffkit::ml;
    auto info = query_kernel_backend();
    std::cout << "kernel backend=" << info.name << " threads=" << info.cpu_threads
              << " cuda=" << (info.cuda_runtime ? "true" : "false") << "\n";
    assert(info.cpu_threads >= 1);

    std::mt19937 rng(2);
    Tensor A({32, 48});
    Tensor B({48, 16});
    A.uniform(0.5f, rng);
    B.uniform(0.5f, rng);
    auto ref = matmul(A, B);
    auto mt = matmul_cpu_mt(A, B, 4);
    float err = 0.f;
    for (std::size_t i = 0; i < ref.numel(); ++i) err = std::max(err, std::fabs(ref.data[i] - mt.data[i]));
    std::cout << "matmul_cpu_mt max_err=" << err << "\n";
    assert(err < 1e-4f);

    auto dev = matmul_device(A, B, true);
    err = 0.f;
    for (std::size_t i = 0; i < ref.numel(); ++i) err = std::max(err, std::fabs(ref.data[i] - dev.data[i]));
    std::cout << "matmul_device max_err=" << err << "\n";
    assert(err < 1e-4f);

    float att = attention_score_kernel_smoke(8, 16);
    std::cout << "attn_score_sum=" << att << "\n";
    assert(std::isfinite(att) && att > 0.f);

    std::cout << "test_ml_kernels ok\n";
    return 0;
}
