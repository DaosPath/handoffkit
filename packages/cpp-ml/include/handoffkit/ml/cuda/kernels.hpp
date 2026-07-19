#pragma once

// Declarations for hand-written CUDA kernels (no third-party BLAS).

#include <cstddef>

namespace handoffkit {
namespace ml {
namespace cuda_kern {

/// Device pointers. C = A(M,K) @ B(K,N), row-major f32. Own tiled GEMM.
void gemm_f32(const float* A, const float* B, float* C, int M, int K, int N);

void add_f32(const float* a, const float* b, float* out, std::size_t n);
void mul_f32(const float* a, const float* b, float* out, std::size_t n);
void gelu_f32(const float* x, float* out, std::size_t n);
void gelu_bwd_f32(const float* x, const float* dy, float* dx, std::size_t n);
void bias_add_rows_f32(float* y, const float* bias, int rows, int cols);
void bias_grad_rows_f32(const float* dy, float* db, int rows, int cols);

/// Softmax over last dim for row-major (rows, cols).
void softmax_rows_f32(const float* x, float* out, int rows, int cols);

}  // namespace cuda_kern
}  // namespace ml
}  // namespace handoffkit
