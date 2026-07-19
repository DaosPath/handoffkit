#include <handoffkit/ml/cuda/resident.hpp>
#include <handoffkit/ml/device.hpp>

#include <iostream>
#include <random>
#include <vector>

int main() {
    using namespace handoffkit::ml;
#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_resident_linear SKIP\n";
    return 0;
#else
    if (!query_devices().cuda_available) {
        std::cout << "test_ml_resident_linear SKIP no GPU\n";
        return 0;
    }
    std::mt19937 rng(3);
    auto L = ResidentLinear::make(8, 4, true, rng);
    if (!L.on_cuda()) {
        std::cerr << "weights not on cuda at init\n";
        return 1;
    }
    Tensor x({8, 8});
    for (int i = 0; i < 8; ++i)
        for (int j = 0; j < 8; ++j) x.data[static_cast<std::size_t>(i * 8 + j)] = (i == j) ? 1.f : 0.f;
    Tensor xg = x.to(Device::Cuda);
    std::vector<int> ys = {0, 1, 2, 3, 0, 1, 2, 3};
    float loss0 = 0.f, last = 0.f;
    for (int s = 0; s < 100; ++s) {
        L.zero_grad();
        Tensor logits = L.forward(xg);
        int* dt = static_cast<int*>(cuda_rt::device_alloc(sizeof(int) * 8));
        cuda_rt::copy_h2d(dt, ys.data(), sizeof(int) * 8);
        last = cuda_kern::ce_mean_f32(logits.device_ptr(), dt, 8, 4);
        if (s == 0) loss0 = last;
        Tensor dlog = Tensor({8, 4}, Device::Cuda);
        cuda_kern::softmax_ce_bwd_f32(logits.device_ptr(), dt, dlog.device_ptr(), 8, 4);
        cuda_rt::device_free(dt);
        (void)L.backward(dlog);
        if (!L.on_cuda()) {
            std::cerr << "weights left CUDA mid-loop\n";
            return 1;
        }
        L.adamw(0.05f, 0.f);
    }
    std::cout << "resident_linear loss0=" << loss0 << " final=" << last
              << " still_cuda=" << (L.on_cuda() ? "true" : "false") << "\n";
    if (!(last < loss0) || !L.on_cuda()) return 1;
    std::cout << "test_ml_resident_linear ok\n";
    return 0;
#endif
}
