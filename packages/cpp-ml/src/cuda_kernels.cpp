// Optional CUDA backend for train-path matmul (Phase D).
// Linked from ops.cpp via handoffkit_ml_cuda_matmul when HANDOFFKIT_ML_WITH_CUDA=1.

#include <handoffkit/ml/kernels.hpp>

// Always export a C-linkage hook so ops.cpp can call it when CUDA is enabled.
extern "C" bool handoffkit_ml_cuda_matmul(const float* A, const float* B, float* C, int M, int K,
                                          int N);

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA && __has_include(<cuda_runtime.h>)
#include <cublas_v2.h>
#include <cuda_runtime.h>

namespace handoffkit {
namespace ml {
namespace cuda_detail {

bool runtime_available() {
    int n = 0;
    if (cudaGetDeviceCount(&n) != cudaSuccess) return false;
    return n > 0;
}

void matmul_f32(const float* A, const float* B, float* C, int M, int K, int N) {
    float *dA = nullptr, *dB = nullptr, *dC = nullptr;
    if (cudaMalloc(&dA, sizeof(float) * static_cast<std::size_t>(M * K)) != cudaSuccess ||
        cudaMalloc(&dB, sizeof(float) * static_cast<std::size_t>(K * N)) != cudaSuccess ||
        cudaMalloc(&dC, sizeof(float) * static_cast<std::size_t>(M * N)) != cudaSuccess) {
        for (int i = 0; i < M; ++i)
            for (int j = 0; j < N; ++j) {
                float s = 0.f;
                for (int k = 0; k < K; ++k) s += A[i * K + k] * B[k * N + j];
                C[i * N + j] = s;
            }
        if (dA) cudaFree(dA);
        if (dB) cudaFree(dB);
        if (dC) cudaFree(dC);
        return;
    }
    cudaMemcpy(dA, A, sizeof(float) * static_cast<std::size_t>(M * K), cudaMemcpyHostToDevice);
    cudaMemcpy(dB, B, sizeof(float) * static_cast<std::size_t>(K * N), cudaMemcpyHostToDevice);
    cublasHandle_t h{};
    cublasCreate(&h);
    const float alpha = 1.f, beta = 0.f;
    // Row-major A(M,K)*B(K,N) via column-major cuBLAS: C^T = B^T * A^T
    cublasStatus_t st =
        cublasSgemm(h, CUBLAS_OP_N, CUBLAS_OP_N, N, M, K, &alpha, dB, N, dA, K, &beta, dC, N);
    if (st == CUBLAS_STATUS_SUCCESS) {
        cudaMemcpy(C, dC, sizeof(float) * static_cast<std::size_t>(M * N), cudaMemcpyDeviceToHost);
    } else {
        for (int i = 0; i < M; ++i)
            for (int j = 0; j < N; ++j) {
                float s = 0.f;
                for (int k = 0; k < K; ++k) s += A[i * K + k] * B[k * N + j];
                C[i * N + j] = s;
            }
    }
    cublasDestroy(h);
    cudaFree(dA);
    cudaFree(dB);
    cudaFree(dC);
}

}  // namespace cuda_detail
}  // namespace ml
}  // namespace handoffkit

extern "C" bool handoffkit_ml_cuda_matmul(const float* A, const float* B, float* C, int M, int K,
                                          int N) {
    if (!handoffkit::ml::cuda_detail::runtime_available()) return false;
    handoffkit::ml::cuda_detail::matmul_f32(A, B, C, M, K, N);
    return true;
}

#else

namespace handoffkit {
namespace ml {
namespace cuda_detail {
bool runtime_available() { return false; }
void matmul_f32(const float* A, const float* B, float* C, int M, int K, int N) {
    for (int i = 0; i < M; ++i)
        for (int j = 0; j < N; ++j) {
            float s = 0.f;
            for (int k = 0; k < K; ++k) s += A[i * K + k] * B[k * N + j];
            C[i * N + j] = s;
        }
}
}  // namespace cuda_detail
}  // namespace ml
}  // namespace handoffkit

extern "C" bool handoffkit_ml_cuda_matmul(const float*, const float*, float*, int, int, int) {
    return false;  // CPU path in ops.cpp
}

#endif
