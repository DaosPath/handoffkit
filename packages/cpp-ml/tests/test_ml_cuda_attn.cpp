#include <handoffkit/ml/cuda/attn_cuda.hpp>
#include <handoffkit/ml/device.hpp>

#include <iostream>

int main() {
    using namespace handoffkit::ml;
    auto info = query_devices();
#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_cuda_attn SKIP (not CUDA build)\n";
    return 0;
#else
    if (!info.cuda_available) {
        std::cout << "test_ml_cuda_attn SKIP (no GPU)\n";
        return 0;
    }
    float err = causal_attn_cuda_parity(8, 16, 3);
    std::cout << "causal_attn cuda vs cpu max_err=" << err << "\n";
    if (err < 0 || err > 5e-3f) {
        std::cerr << "attn parity failed\n";
        return 1;
    }
    err = causal_attn_cuda_parity(12, 32, 9);
    std::cout << "causal_attn T=12 max_err=" << err << "\n";
    if (err > 5e-3f) return 1;
    std::cout << "test_ml_cuda_attn ok\n";
    return 0;
#endif
}
