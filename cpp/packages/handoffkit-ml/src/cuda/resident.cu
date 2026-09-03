// Device-resident helpers: embedding, rmsnorm, scale, axpy, CE mean.

#include <handoffkit/ml/cuda/kernels.hpp>

#include <cuda_runtime.h>

#include <cfloat>
#include <cmath>

namespace handoffkit {
namespace ml {
namespace cuda_kern {
namespace {

__global__ void emb_fwd_kernel(const float* table, const int* idx, float* out, int N, int D) {
    int i = blockIdx.x;
    if (i >= N) return;
    int id = idx[i];
    const float* row = table + static_cast<std::size_t>(id) * D;
    float* o = out + static_cast<std::size_t>(i) * D;
    for (int d = threadIdx.x; d < D; d += blockDim.x) o[d] = row[d];
}

__global__ void emb_bwd_kernel(const float* dy, const int* idx, float* gtable, int N, int D) {
    int i = blockIdx.x;
    if (i >= N) return;
    int id = idx[i];
    float* grow = gtable + static_cast<std::size_t>(id) * D;
    const float* drow = dy + static_cast<std::size_t>(i) * D;
    for (int d = threadIdx.x; d < D; d += blockDim.x) {
        atomicAdd(grow + d, drow[d]);
    }
}

__global__ void scale_kernel(const float* x, float* out, std::size_t n, float s) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = x[i] * s;
}

__global__ void axpy_kernel(float* y, const float* x, std::size_t n, float a) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) y[i] += a * x[i];
}

// RMSNorm: one block per row
__global__ void rmsnorm_fwd_kernel(const float* x, const float* w, float* out, float* rstd, int rows,
                                   int D, float eps) {
    int r = blockIdx.x;
    if (r >= rows) return;
    const float* row = x + static_cast<std::size_t>(r) * D;
    float* orow = out + static_cast<std::size_t>(r) * D;
    float ms = 0.f;
    for (int d = threadIdx.x; d < D; d += blockDim.x) ms += row[d] * row[d];
    __shared__ float sm[256];
    sm[threadIdx.x] = ms;
    __syncthreads();
    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (threadIdx.x < s) sm[threadIdx.x] += sm[threadIdx.x + s];
        __syncthreads();
    }
    float inv = rsqrtf(sm[0] / static_cast<float>(D) + eps);
    if (threadIdx.x == 0 && rstd) rstd[r] = inv;
    __syncthreads();
    for (int d = threadIdx.x; d < D; d += blockDim.x) {
        orow[d] = (row[d] * inv) * w[d];
    }
}

__global__ void rmsnorm_bwd_kernel(const float* x, const float* w, const float* rstd, const float* dy,
                                   float* dx, float* dw, int rows, int D) {
    int r = blockIdx.x;
    if (r >= rows) return;
    const float* row = x + static_cast<std::size_t>(r) * D;
    const float* drow = dy + static_cast<std::size_t>(r) * D;
    float* dxrow = dx + static_cast<std::size_t>(r) * D;
    float inv = rstd[r];
    for (int d = threadIdx.x; d < D; d += blockDim.x) {
        atomicAdd(dw + d, drow[d] * (row[d] * inv));
        dxrow[d] = drow[d] * w[d] * inv;
    }
}

// CE mean: block reduce then atomic to scalar
__global__ void ce_mean_kernel(const float* logits, const int* targets, float* out_sum, int B,
                               int C) {
    int i = blockIdx.x;
    if (i >= B) return;
    const float* row = logits + static_cast<std::size_t>(i) * C;
    float m = -FLT_MAX;
    for (int j = 0; j < C; ++j) m = fmaxf(m, row[j]);
    float sum = 0.f;
    for (int j = 0; j < C; ++j) sum += expf(row[j] - m);
    int t = targets[i];
    float logp = (row[t] - m) - logf(fmaxf(sum, 1e-20f));
    atomicAdd(out_sum, -logp);
}

// qkv (T, 3D) → Q,K,V (T, hs) for head h
__global__ void qkv_split_head_kernel(const float* qkv, float* Q, float* K, float* V, int T, int D,
                                      int hs, int head) {
    int t = blockIdx.x;
    if (t >= T) return;
    const float* row = qkv + static_cast<std::size_t>(t) * 3 * D;
    float* q = Q + static_cast<std::size_t>(t) * hs;
    float* k = K + static_cast<std::size_t>(t) * hs;
    float* v = V + static_cast<std::size_t>(t) * hs;
    int off = head * hs;
    for (int d = threadIdx.x; d < hs; d += blockDim.x) {
        q[d] = row[off + d];
        k[d] = row[D + off + d];
        v[d] = row[2 * D + off + d];
    }
}

__global__ void merge_head_kernel(const float* head_out, float* y, int T, int D, int hs, int head) {
    int t = blockIdx.x;
    if (t >= T) return;
    const float* hrow = head_out + static_cast<std::size_t>(t) * hs;
    float* yrow = y + static_cast<std::size_t>(t) * D + head * hs;
    for (int d = threadIdx.x; d < hs; d += blockDim.x) yrow[d] = hrow[d];
}

__global__ void unmerge_head_kernel(const float* y, float* head_out, int T, int D, int hs,
                                    int head) {
    int t = blockIdx.x;
    if (t >= T) return;
    const float* yrow = y + static_cast<std::size_t>(t) * D + head * hs;
    float* hrow = head_out + static_cast<std::size_t>(t) * hs;
    for (int d = threadIdx.x; d < hs; d += blockDim.x) hrow[d] = yrow[d];
}

__global__ void qkv_scatter_head_kernel(const float* dQ, const float* dK, const float* dV,
                                        float* d_qkv, int T, int D, int hs, int head) {
    int t = blockIdx.x;
    if (t >= T) return;
    float* row = d_qkv + static_cast<std::size_t>(t) * 3 * D;
    const float* dq = dQ + static_cast<std::size_t>(t) * hs;
    const float* dk = dK + static_cast<std::size_t>(t) * hs;
    const float* dv = dV + static_cast<std::size_t>(t) * hs;
    int off = head * hs;
    for (int d = threadIdx.x; d < hs; d += blockDim.x) {
        atomicAdd(row + off + d, dq[d]);
        atomicAdd(row + D + off + d, dk[d]);
        atomicAdd(row + 2 * D + off + d, dv[d]);
    }
}

// Softmax bwd: dx_i = s_i * (dy_i - sum_j s_j * dy_j)
__global__ void softmax_bwd_rows_kernel(const float* s, const float* dy, float* dx, int rows,
                                        int cols) {
    int r = blockIdx.x;
    if (r >= rows) return;
    const float* sr = s + static_cast<std::size_t>(r) * cols;
    const float* dyr = dy + static_cast<std::size_t>(r) * cols;
    float* dxr = dx + static_cast<std::size_t>(r) * cols;
    float dot = 0.f;
    for (int j = threadIdx.x; j < cols; j += blockDim.x) dot += sr[j] * dyr[j];
    __shared__ float sm[256];
    sm[threadIdx.x] = dot;
    __syncthreads();
    for (int k = blockDim.x / 2; k > 0; k >>= 1) {
        if (threadIdx.x < k) sm[threadIdx.x] += sm[threadIdx.x + k];
        __syncthreads();
    }
    float sum = sm[0];
    for (int j = threadIdx.x; j < cols; j += blockDim.x) dxr[j] = sr[j] * (dyr[j] - sum);
}

__global__ void scale_inplace_kernel(float* x, std::size_t n, float s) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) x[i] *= s;
}

int grids(std::size_t n, int bs = 256) {
    return static_cast<int>((n + static_cast<std::size_t>(bs) - 1) / static_cast<std::size_t>(bs));
}

}  // namespace

void embedding_fwd_f32(const float* table, const int* indices, float* out, int N, int D) {
    if (N <= 0) return;
    int thr = 256;
    if (D < thr) thr = 64;
    emb_fwd_kernel<<<N, thr>>>(table, indices, out, N, D);
}

void embedding_bwd_f32(const float* dy, const int* indices, float* gtable, int N, int D, int /*V*/) {
    if (N <= 0) return;
    int thr = 256;
    if (D < thr) thr = 64;
    emb_bwd_kernel<<<N, thr>>>(dy, indices, gtable, N, D);
}

void scale_f32(const float* x, float* out, std::size_t n, float s) {
    if (n == 0) return;
    scale_kernel<<<grids(n), 256>>>(x, out, n, s);
}

void axpy_f32(float* y, const float* x, std::size_t n, float a) {
    if (n == 0) return;
    axpy_kernel<<<grids(n), 256>>>(y, x, n, a);
}

void rmsnorm_fwd_f32(const float* x, const float* weight, float* out, float* rstd, int rows, int D,
                     float eps) {
    if (rows <= 0) return;
    int thr = 256;
    if (D < thr) thr = 64;
    rmsnorm_fwd_kernel<<<rows, thr>>>(x, weight, out, rstd, rows, D, eps);
}

void rmsnorm_bwd_f32(const float* x, const float* weight, const float* rstd, const float* dy,
                     float* dx, float* dweight, int rows, int D) {
    if (rows <= 0) return;
    int thr = 256;
    if (D < thr) thr = 64;
    rmsnorm_bwd_kernel<<<rows, thr>>>(x, weight, rstd, dy, dx, dweight, rows, D);
}

float ce_mean_f32(const float* logits, const int* targets, int B, int C) {
    if (B <= 0) return 0.f;
    float* dsum = nullptr;
    cudaMalloc(&dsum, sizeof(float));
    cudaMemset(dsum, 0, sizeof(float));
    ce_mean_kernel<<<B, 1>>>(logits, targets, dsum, B, C);
    float h = 0.f;
    cudaMemcpy(&h, dsum, sizeof(float), cudaMemcpyDeviceToHost);
    cudaFree(dsum);
    return h / static_cast<float>(B);
}

void qkv_split_head_f32(const float* qkv, float* Q, float* K, float* V, int T, int D, int hs,
                        int head) {
    if (T <= 0) return;
    int thr = 64;
    if (hs > thr) thr = 256;
    qkv_split_head_kernel<<<T, thr>>>(qkv, Q, K, V, T, D, hs, head);
}

void merge_head_f32(const float* head_out, float* y, int T, int D, int hs, int head) {
    if (T <= 0) return;
    int thr = 64;
    if (hs > thr) thr = 256;
    merge_head_kernel<<<T, thr>>>(head_out, y, T, D, hs, head);
}

void unmerge_head_f32(const float* y, float* head_out, int T, int D, int hs, int head) {
    if (T <= 0) return;
    int thr = 64;
    if (hs > thr) thr = 256;
    unmerge_head_kernel<<<T, thr>>>(y, head_out, T, D, hs, head);
}

void qkv_scatter_head_f32(const float* dQ, const float* dK, const float* dV, float* d_qkv, int T,
                          int D, int hs, int head) {
    if (T <= 0) return;
    int thr = 64;
    if (hs > thr) thr = 256;
    qkv_scatter_head_kernel<<<T, thr>>>(dQ, dK, dV, d_qkv, T, D, hs, head);
}

void softmax_bwd_rows_f32(const float* s, const float* dy, float* dx, int rows, int cols) {
    if (rows <= 0) return;
    int thr = 256;
    if (cols < thr) thr = 64;
    if (thr > cols) thr = cols > 0 ? cols : 1;
    // pad thr to power of 2 for reduction
    int p2 = 1;
    while (p2 < thr) p2 <<= 1;
    if (p2 > 256) p2 = 256;
    thr = p2;
    softmax_bwd_rows_kernel<<<rows, thr>>>(s, dy, dx, rows, cols);
}

void scale_inplace_f32(float* x, std::size_t n, float s) {
    if (n == 0) return;
    scale_inplace_kernel<<<grids(n), 256>>>(x, n, s);
}

}  // namespace cuda_kern
}  // namespace ml
}  // namespace handoffkit
