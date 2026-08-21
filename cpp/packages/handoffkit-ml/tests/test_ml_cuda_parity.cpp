#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <cmath>
#include <iostream>
#include <random>

int main() {
    using namespace handoffkit::ml;

    auto info = query_devices();
    std::cout << "cuda_compiled=" << (info.cuda_compiled ? "true" : "false")
              << " cuda_available=" << (info.cuda_available ? "true" : "false")
              << " devices=" << info.cuda_devices << " note=" << info.cuda_note << "\n";

    if (!info.cuda_compiled) {
        std::cout << "test_ml_cuda_parity SKIP (not built with HANDOFFKIT_ML_CUDA)\n";
        return 0;
    }
    if (!info.cuda_available) {
        std::cout << "test_ml_cuda_parity SKIP (no GPU)\n";
        return 0;
    }

    // H↔D roundtrip
    Tensor a({4, 4}, Device::Cpu);
    std::mt19937 rng(7);
    a.uniform(1.f, rng);
    Tensor g = a.to(Device::Cuda);
    Tensor back = g.to(Device::Cpu);
    float err = 0.f;
    for (std::size_t i = 0; i < a.numel(); ++i) {
        err = std::max(err, std::fabs(a.data[i] - back.data[i]));
    }
    std::cout << "h2d2h max_err=" << err << "\n";
    if (err > 0.f) {
        std::cerr << "roundtrip failed\n";
        return 1;
    }

    // Own GEMM parity via host-pointer API (uses device gemm under the hood)
    Tensor A({32, 48});
    Tensor B({48, 16});
    A.uniform(0.5f, rng);
    B.uniform(0.5f, rng);
    Tensor ref = matmul(A, B);  // may use CUDA hook if available

    // Force CPU reference
    // Temporarily ensure CPU path: matmul always tries CUDA first when available.
    // Compare two runs — should be deterministic
    Tensor ref2 = matmul(A, B);
    err = 0.f;
    for (std::size_t i = 0; i < ref.numel(); ++i) {
        err = std::max(err, std::fabs(ref.data[i] - ref2.data[i]));
    }
    std::cout << "matmul consistency max_err=" << err << "\n";

    // Explicit: CPU single-thread style check vs GPU hook
    // Build naive CPU
    Tensor naive({32, 16});
    for (int i = 0; i < 32; ++i) {
        for (int j = 0; j < 16; ++j) {
            float s = 0.f;
            for (int k = 0; k < 48; ++k) {
                s += A.data[static_cast<std::size_t>(i * 48 + k)] *
                     B.data[static_cast<std::size_t>(k * 16 + j)];
            }
            naive.data[static_cast<std::size_t>(i * 16 + j)] = s;
        }
    }
    err = 0.f;
    for (std::size_t i = 0; i < ref.numel(); ++i) {
        err = std::max(err, std::fabs(ref.data[i] - naive.data[i]));
    }
    std::cout << "gemm vs naive CPU max_err=" << err << "\n";
    if (err > 5e-3f) {
        std::cerr << "gemm parity too large\n";
        return 1;
    }

    std::cout << "device0=" << info.device0_name << "\n";
    std::cout << "test_ml_cuda_parity ok\n";
    return 0;
}
