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

/// Softmax-CE backward: dlogits = (softmax - onehot) / B  (targets host or device int)
void softmax_ce_bwd_f32(const float* logits, const int* targets, float* dlogits, int B, int C);

/// 2D transpose: out(C,R) = in(R,C)
void transpose2d_f32(const float* in, float* out, int rows, int cols);

/// AdamW parameter update (device): w, m, v, g all length n
void adamw_step_f32(float* w, float* m, float* v, const float* g, std::size_t n, float lr,
                    float beta1, float beta2, float eps, float weight_decay, int t);

/// Fill device buffer with scalar
void fill_f32(float* p, std::size_t n, float v);

/// Causal mask: scores (T,T) set upper triangle to -1e9
void causal_mask_f32(float* scores, int T);

/// Embedding: table (V,D), indices (N,) int, out (N,D)
void embedding_fwd_f32(const float* table, const int* indices, float* out, int N, int D);

/// Embedding backward: scatter-add dy (N,D) into gtable (V,D)
void embedding_bwd_f32(const float* dy, const int* indices, float* gtable, int N, int D, int V);

/// Scale tensor by scalar: out = x * s
void scale_f32(const float* x, float* out, std::size_t n, float s);

/// axpy: y += a * x
void axpy_f32(float* y, const float* x, std::size_t n, float a);

/// RMSNorm forward: x (rows, D), weight (D), out (rows, D); writes rstd (rows) optional
void rmsnorm_fwd_f32(const float* x, const float* weight, float* out, float* rstd, int rows, int D,
                     float eps);

/// RMSNorm backward (approx matching CPU: treat rms as constant per row for weight grad)
void rmsnorm_bwd_f32(const float* x, const float* weight, const float* rstd, const float* dy,
                     float* dx, float* dweight, int rows, int D);

/// Cross-entropy mean loss (device logits + device targets) → scalar on host via download of 1 float
float ce_mean_f32(const float* logits, const int* targets, int B, int C);

/// Split one attention head from fused qkv (T, 3*D) into Q,K,V each (T, hs).
void qkv_split_head_f32(const float* qkv, float* Q, float* K, float* V, int T, int D, int hs,
                        int head);

/// Merge head output (T, hs) into y (T, D) at head offset (overwrites that slice).
void merge_head_f32(const float* head_out, float* y, int T, int D, int hs, int head);

/// Inverse of merge: head_out (T, hs) ← y (T, D) slice for head.
void unmerge_head_f32(const float* y, float* head_out, int T, int D, int hs, int head);

/// Scatter dQ/dK/dV (T, hs) into fused d_qkv (T, 3*D) for one head (additive).
void qkv_scatter_head_f32(const float* dQ, const float* dK, const float* dV, float* d_qkv, int T,
                          int D, int hs, int head);

/// Softmax backward over last dim: dout (rows, cols), softmax probs s, writes dx.
void softmax_bwd_rows_f32(const float* s, const float* dy, float* dx, int rows, int cols);

/// In-place scale: x *= s
void scale_inplace_f32(float* x, std::size_t n, float s);

}  // namespace cuda_kern
}  // namespace ml
}  // namespace handoffkit


