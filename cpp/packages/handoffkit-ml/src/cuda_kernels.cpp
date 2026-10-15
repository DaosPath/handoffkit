// Compatibility shim: train-path matmul CUDA entry uses OWN gemm (no cuBLAS).
// Device pointers preferred; this host-pointer API is for gradual migration.

#include <handoffkit/ml/cuda/kernels.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>

#include <vector>

extern "C" bool handoffkit_ml_cuda_matmul(const float* A, const float* B, float* C, int M, int K,
                                          int N) {
    if (!handoffkit::ml::cuda_rt::available()) return false;
    if (M <= 0 || K <= 0 || N <= 0) return false;

    const std::size_t a_bytes = static_cast<std::size_t>(M) * static_cast<std::size_t>(K) * 4;
    const std::size_t b_bytes = static_cast<std::size_t>(K) * static_cast<std::size_t>(N) * 4;
    const std::size_t c_bytes = static_cast<std::size_t>(M) * static_cast<std::size_t>(N) * 4;

    void* dA = handoffkit::ml::cuda_rt::device_alloc(a_bytes);
    void* dB = handoffkit::ml::cuda_rt::device_alloc(b_bytes);
    void* dC = handoffkit::ml::cuda_rt::device_alloc(c_bytes);
    if (!dA || !dB || !dC) {
        handoffkit::ml::cuda_rt::device_free(dA);
        handoffkit::ml::cuda_rt::device_free(dB);
        handoffkit::ml::cuda_rt::device_free(dC);
        return false;
    }
    handoffkit::ml::cuda_rt::copy_h2d(dA, A, a_bytes);
    handoffkit::ml::cuda_rt::copy_h2d(dB, B, b_bytes);
    handoffkit::ml::cuda_kern::gemm_f32(static_cast<const float*>(dA), static_cast<const float*>(dB),
                                        static_cast<float*>(dC), M, K, N);
    handoffkit::ml::cuda_rt::device_sync();
    handoffkit::ml::cuda_rt::copy_d2h(C, dC, c_bytes);
    handoffkit::ml::cuda_rt::device_free(dA);
    handoffkit::ml::cuda_rt::device_free(dB);
    handoffkit::ml::cuda_rt::device_free(dC);
    return handoffkit::ml::cuda_rt::last_error().empty();
}
