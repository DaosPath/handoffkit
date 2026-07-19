// Optional CUDA backend stubs + host fallbacks (Phase D).
// When built without CUDA toolkit, only CPU path is linked.

#include <handoffkit/ml/kernels.hpp>

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA

// Try to detect CUDA runtime at runtime without requiring full toolkit at compile
// if headers are absent — use weak stubs.
#if __has_include(<cuda_runtime.h>)
#include <cuda_runtime.h>
#include <cublas_v2.h>

namespace handoffkit {
namespace ml {
namespace cuda_detail {

bool runtime_available() {
    int n = 0;
    if (cudaGetDeviceCount(&n) != cudaSuccess) return false;
    return n > 0;
}

void matmul_f32(const float* A, const float* B, float* C, int M, int K, int N) {
    // C = A(M,K) * B(K,N)  using cuBLAS column-major: C^T = B^T * A^T
    float *dA = nullptr, *dB = nullptr, *dC = nullptr;
    cudaMalloc(&dA, sizeof(float) * M * K);
    cudaMalloc(&dB, sizeof(float) * K * N);
    cudaMalloc(&dC, sizeof(float) * M * N);
    cudaMemcpy(dA, A, sizeof(float) * M * K, cudaMemcpyHostToDevice);
    cudaMemcpy(dB, B, sizeof(float) * K * N, cudaMemcpyHostToDevice);
    cublasHandle_t h;
    cublasCreate(&h);
    const float alpha = 1.f, beta = 0.f;
    // Row-major gemm via transposed op: C_rm = A_rm * B_rm
    // Using cublasSgemm with OP_N OP_N on transposed dims is error-prone;
    // fall back to simple CUDA-less host if cublas fails.
    cublasStatus_t st = cublasSgemm(h, CUBLAS_OP_N, CUBLAS_OP_N, N, M, K, &alpha, dB, N, dA, K,
                                    &beta, dC, N);
    if (st != CUBLAS_STATUS_SUCCESS) {
        // host fallback
        for (int i = 0; i < M; ++i) {
            for (int j = 0; j < N; ++j) {
                float s = 0.f;
                for (int k = 0; k < K; ++k) s += A[i * K + k] * B[k * N + j];
                C[i * N + j] = s;
            }
        }
    } else {
        cudaMemcpy(C, dC, sizeof(float) * M * N, cudaMemcpyDeviceToHost);
    }
    cublasDestroy(h);
    cudaFree(dA);
    cudaFree(dB);
    cudaFree(dC);
}

}  // namespace cuda_detail
}  // namespace ml
}  // namespace handoffkit

#else  // no cuda headers

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

#endif
#endif  // HANDOFFKIT_ML_WITH_CUDA
