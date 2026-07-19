#include <handoffkit/ml/cuda/kernels.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <cmath>
#include <iostream>
#include <vector>

int main() {
    using namespace handoffkit::ml;
#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_resident_embed SKIP\n";
    return 0;
#else
    if (!query_devices().cuda_available) {
        std::cout << "test_ml_resident_embed SKIP no GPU\n";
        return 0;
    }
    // table 5x4 identity-ish
    Tensor table({5, 4});
    for (int i = 0; i < 5; ++i)
        for (int d = 0; d < 4; ++d) table.data[static_cast<std::size_t>(i * 4 + d)] = float(i * 10 + d);
    Tensor tg = table.to(Device::Cuda);
    std::vector<int> idx = {0, 2, 4, 1};
    int* di = static_cast<int*>(cuda_rt::device_alloc(sizeof(int) * 4));
    cuda_rt::copy_h2d(di, idx.data(), sizeof(int) * 4);
    Tensor out({4, 4}, Device::Cuda);
    cuda_kern::embedding_fwd_f32(tg.device_ptr(), di, out.device_ptr(), 4, 4);
    Tensor oh = out.to(Device::Cpu);
    for (int i = 0; i < 4; ++i)
        for (int d = 0; d < 4; ++d) {
            float expv = float(idx[static_cast<std::size_t>(i)] * 10 + d);
            if (std::fabs(oh.data[static_cast<std::size_t>(i * 4 + d)] - expv) > 1e-5f) {
                std::cerr << "emb fwd mismatch\n";
                return 1;
            }
        }
    Tensor gtable({5, 4}, Device::Cuda);
    cuda_rt::device_memset_zero(gtable.device_ptr(), gtable.numel() * 4);
    Tensor dy = out;  // same values
    cuda_kern::embedding_bwd_f32(dy.device_ptr(), di, gtable.device_ptr(), 4, 4, 5);
    Tensor gh = gtable.to(Device::Cpu);
    // index 0 appears once
    if (std::fabs(gh.data[0] - 0.f) > 1e-5f && std::fabs(gh.data[0] - 0.f) < 100) {
        // ok if gathered
    }
    float s0 = 0.f;
    for (int d = 0; d < 4; ++d) s0 += gh.data[static_cast<std::size_t>(d)];
    std::cout << "emb gtable row0 sum=" << s0 << "\n";
    if (s0 < 1.f) {
        std::cerr << "scatter-add failed\n";
        return 1;
    }
    cuda_rt::device_free(di);
    std::cout << "test_ml_resident_embed ok\n";
    return 0;
#endif
}
