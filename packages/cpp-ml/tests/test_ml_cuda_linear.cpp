#include <handoffkit/ml/cuda/linear_cuda.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>

#include <cmath>
#include <iostream>
#include <random>
#include <vector>

int main() {
    using namespace handoffkit::ml;
    auto info = query_devices();
    std::cout << "cuda_available=" << (info.cuda_available ? "true" : "false") << "\n";
#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_cuda_linear SKIP (not CUDA build)\n";
    return 0;
#else
    if (!info.cuda_available) {
        std::cout << "test_ml_cuda_linear SKIP (no GPU)\n";
        return 0;
    }

    std::mt19937 rng(5);
    Linear layer(16, 8, true, rng);
    Tensor x({4, 16});
    x.uniform(0.3f, rng);
    std::vector<int> targets = {0, 1, 2, 3};

    // Force pure CPU matmul for baseline (default may prefer CUDA GEMM hook)
    handoffkit_ml_set_prefer_cuda_matmul(false);
    Tensor y_cpu = layer.forward(x);
    handoffkit_ml_set_prefer_cuda_matmul(true);
    Tensor y_gpu = linear_forward_cuda(x, layer.W, layer.b, true).to(Device::Cpu);
    float ferr = 0.f;
    for (std::size_t i = 0; i < y_cpu.numel(); ++i)
        ferr = std::max(ferr, std::fabs(y_cpu.data[i] - y_gpu.data[i]));
    std::cout << "linear forward max_err=" << ferr << "\n";
    if (ferr > 5e-3f) return 1;

    // Backward parity on dW (CPU path must not use CUDA matmul hook)
    Tensor dy = y_cpu.zeros_like();
    dy.fill(0.01f);
    handoffkit_ml_set_prefer_cuda_matmul(false);
    auto bw_cpu = linear_backward(x, layer.W, dy, true);
    handoffkit_ml_set_prefer_cuda_matmul(true);
    auto bw_gpu = linear_backward_cuda(x, layer.W, dy, true);
    Tensor dW_g = bw_gpu.dW.to(Device::Cpu);
    float berr = 0.f;
    for (std::size_t i = 0; i < bw_cpu.dW.numel(); ++i)
        berr = std::max(berr, std::fabs(bw_cpu.dW.data[i] - dW_g.data[i]));
    std::cout << "linear dW max_err=" << berr << "\n";
    if (berr > 5e-3f) return 1;

    float loss0 = cross_entropy_mean(layer.forward(x), targets);
    float last = loss0;
    for (int s = 0; s < 80; ++s) {
        last = linear_ce_step_cuda(layer, x, targets, 0.15f);
    }
    std::cout << "linear_ce_step_cuda loss0=" << loss0 << " final=" << last << "\n";
    if (!(last < loss0) && last > 0.5f) {
        std::cerr << "loss did not drop enough\n";
        return 1;
    }

    std::cout << "test_ml_cuda_linear ok\n";
    return 0;
#endif
}
