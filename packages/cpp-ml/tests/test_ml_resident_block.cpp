#include <handoffkit/ml/cuda/resident.hpp>
#include <handoffkit/ml/device.hpp>

#include <iostream>
#include <random>

int main() {
    using namespace handoffkit::ml;
#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_resident_block SKIP\n";
    return 0;
#else
    if (!query_devices().cuda_available) {
        std::cout << "test_ml_resident_block SKIP no GPU\n";
        return 0;
    }
    std::mt19937 rng(4);
    auto blk = ResidentBlock::make(32, 4, rng);
    Tensor x({8, 32});
    x.uniform(0.1f, rng);
    Tensor xg = x.to(Device::Cuda);
    Tensor y = blk.forward(xg);
    if (y.device != Device::Cuda) return 1;
    Tensor dyh = y.to(Device::Cpu);
    dyh.fill(0.001f);
    Tensor dy = dyh.to(Device::Cuda);
    Tensor dx = blk.backward(dy);
    if (dx.device != Device::Cuda) return 1;
    blk.adamw(1e-3f);
    std::cout << "test_ml_resident_block ok\n";
    return 0;
#endif
}
