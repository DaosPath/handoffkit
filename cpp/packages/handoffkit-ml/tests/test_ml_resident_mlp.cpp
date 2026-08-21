#include <handoffkit/ml/cuda/resident.hpp>
#include <handoffkit/ml/device.hpp>

#include <iostream>
#include <random>

int main() {
    using namespace handoffkit::ml;
#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_resident_mlp SKIP\n";
    return 0;
#else
    if (!query_devices().cuda_available) {
        std::cout << "test_ml_resident_mlp SKIP no GPU\n";
        return 0;
    }
    std::mt19937 rng(1);
    auto mlp = ResidentMLP::make(32, rng);
    auto ln = ResidentRMSNorm::make(32);
    Tensor x({4, 32});
    std::mt19937 r2(2);
    x.uniform(0.2f, r2);
    Tensor xg = x.to(Device::Cuda);
    Tensor n = ln.forward(xg);
    Tensor y = mlp.forward(n);
    if (y.device != Device::Cuda) {
        std::cerr << "activation not on cuda\n";
        return 1;
    }
    Tensor dy = y;
    // unit dy
    cuda_rt::device_memset_zero(dy.device_ptr(), dy.numel() * 4);
    // fill 0.01 via host
    Tensor dyh = dy.to(Device::Cpu);
    dyh.fill(0.01f);
    dy = dyh.to(Device::Cuda);
    Tensor dn = mlp.backward(dy);
    Tensor dx = ln.backward(dn);
    if (dx.device != Device::Cuda || !mlp.fc1.on_cuda()) {
        std::cerr << "left cuda\n";
        return 1;
    }
    mlp.adamw(1e-3f);
    ln.sgd(1e-3f);
    std::cout << "test_ml_resident_mlp ok act_device=cuda weights_cuda="
              << (mlp.fc1.on_cuda() ? "true" : "false") << "\n";
    return 0;
#endif
}
