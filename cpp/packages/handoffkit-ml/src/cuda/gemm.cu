// Hand-written f32 GEMM — no cuBLAS. Tiled shared-memory kernel.

#include <handoffkit/ml/cuda/kernels.hpp>

#include <cuda_runtime.h>

namespace handoffkit {
namespace ml {
namespace cuda_kern {
namespace {

constexpr int TILE = 16;

// C(M,N) = A(M,K) @ B(K,N), row-major
__global__ void gemm_tiled_kernel(const float* __restrict__ A,
                                  const float* __restrict__ B,
                                  float* __restrict__ C,
                                  int M,
                                  int K,
                                  int N) {
    __shared__ float As[TILE][TILE];
    __shared__ float Bs[TILE][TILE];

    const int row = blockIdx.y * TILE + threadIdx.y;
    const int col = blockIdx.x * TILE + threadIdx.x;

    float acc = 0.f;
    const int tiles = (K + TILE - 1) / TILE;
    for (int t = 0; t < tiles; ++t) {
        const int a_col = t * TILE + threadIdx.x;
        const int b_row = t * TILE + threadIdx.y;
        As[threadIdx.y][threadIdx.x] =
            (row < M && a_col < K) ? A[row * K + a_col] : 0.f;
        Bs[threadIdx.y][threadIdx.x] =
            (b_row < K && col < N) ? B[b_row * N + col] : 0.f;
        __syncthreads();
#pragma unroll
        for (int k = 0; k < TILE; ++k) {
            acc += As[threadIdx.y][k] * Bs[k][threadIdx.x];
        }
        __syncthreads();
    }
    if (row < M && col < N) C[row * N + col] = acc;
}

}  // namespace

void gemm_f32(const float* A, const float* B, float* C, int M, int K, int N) {
    dim3 block(TILE, TILE);
    dim3 grid((N + TILE - 1) / TILE, (M + TILE - 1) / TILE);
    gemm_tiled_kernel<<<grid, block>>>(A, B, C, M, K, N);
    cudaGetLastError();
}

}  // namespace cuda_kern
}  // namespace ml
}  // namespace handoffkit
