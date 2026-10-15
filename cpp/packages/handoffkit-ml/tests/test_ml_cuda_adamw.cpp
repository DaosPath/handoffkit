#include <handoffkit/ml/cuda/adamw_cuda.hpp>
#include <handoffkit/ml/device.hpp>

#include <iostream>

int main() {
    using namespace handoffkit::ml;
#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_cuda_adamw SKIP (not CUDA build)\n";
    return 0;
#else
    if (!query_devices().cuda_available) {
        std::cout << "test_ml_cuda_adamw SKIP (no GPU)\n";
        return 0;
    }
    float loss = adamw_cuda_overfit(180);
    std::cout << "adamw_cuda_overfit final=" << loss << "\n";
    if (loss > 0.35f) {
        std::cerr << "adamw overfit too high\n";
        return 1;
    }
    std::cout << "test_ml_cuda_adamw ok\n";
    return 0;
#endif
}
