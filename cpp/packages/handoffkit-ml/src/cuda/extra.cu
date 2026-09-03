// Extra hand-written CUDA kernels: transpose, CE bwd, AdamW, mask, fill.

#include <handoffkit/ml/cuda/kernels.hpp>

#include <cuda_runtime.h>

#include <cfloat>
#include <cmath>

namespace handoffkit {
namespace ml {
namespace cuda_kern {
namespace {

__global__ void transpose_kernel(const float* in, float* out, int rows, int cols) {
    int i = blockIdx.y * blockDim.y + threadIdx.y;
    int j = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < rows && j < cols) out[j * rows + i] = in[i * cols + j];
}

__global__ void fill_kernel(float* p, std::size_t n, float v) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) p[i] = v;
}

__global__ void causal_mask_kernel(float* scores, int T) {
    int t = blockIdx.y * blockDim.y + threadIdx.y;
    int s = blockIdx.x * blockDim.x + threadIdx.x;
    if (t < T && s < T && s > t) scores[t * T + s] = -1e9f;
}

// One block per batch row for CE backward
__global__ void softmax_ce_bwd_kernel(const float* logits, const int* targets, float* dlogits,
                                      int B, int C) {
    int i = blockIdx.x;
    if (i >= B) return;
    const float* row = logits + static_cast<std::size_t>(i) * C;
    float* drow = dlogits + static_cast<std::size_t>(i) * C;

    float m = -FLT_MAX;
    for (int j = threadIdx.x; j < C; j += blockDim.x) m = fmaxf(m, row[j]);
    __shared__ float sm[256];
    sm[threadIdx.x] = m;
    __syncthreads();
    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (threadIdx.x < s) sm[threadIdx.x] = fmaxf(sm[threadIdx.x], sm[threadIdx.x + s]);
        __syncthreads();
    }
    m = sm[0];

    float sum = 0.f;
    for (int j = threadIdx.x; j < C; j += blockDim.x) {
        float e = expf(row[j] - m);
        drow[j] = e;
        sum += e;
    }
    sm[threadIdx.x] = sum;
    __syncthreads();
    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (threadIdx.x < s) sm[threadIdx.x] += sm[threadIdx.x + s];
        __syncthreads();
    }
    sum = sm[0];
    float inv = 1.f / fmaxf(sum, 1e-20f);
    float invB = 1.f / static_cast<float>(B);
    int t = targets[i];
    for (int j = threadIdx.x; j < C; j += blockDim.x) {
        float p = drow[j] * inv;
        drow[j] = (p - ((j == t) ? 1.f : 0.f)) * invB;
    }
}

__global__ void adamw_kernel(float* w, float* m, float* v, const float* g, std::size_t n, float lr,
                             float beta1, float beta2, float eps, float wd, float bc1, float bc2) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    float gi = g[i];
    w[i] -= lr * wd * w[i];
    m[i] = beta1 * m[i] + (1.f - beta1) * gi;
    v[i] = beta2 * v[i] + (1.f - beta2) * gi * gi;
    float mhat = m[i] / bc1;
    float vhat = v[i] / bc2;
    w[i] -= lr * mhat / (sqrtf(vhat) + eps);
}

int grid_n(std::size_t n, int bs = 256) {
    return static_cast<int>((n + static_cast<std::size_t>(bs) - 1) / static_cast<std::size_t>(bs));
}

}  // namespace

void transpose2d_f32(const float* in, float* out, int rows, int cols) {
    dim3 block(16, 16);
    dim3 grid((cols + 15) / 16, (rows + 15) / 16);
    transpose_kernel<<<grid, block>>>(in, out, rows, cols);
}

void fill_f32(float* p, std::size_t n, float v) {
    if (n == 0) return;
    fill_kernel<<<grid_n(n), 256>>>(p, n, v);
}

void causal_mask_f32(float* scores, int T) {
    dim3 block(16, 16);
    dim3 grid((T + 15) / 16, (T + 15) / 16);
    causal_mask_kernel<<<grid, block>>>(scores, T);
}

void softmax_ce_bwd_f32(const float* logits, const int* targets, float* dlogits, int B, int C) {
    if (B <= 0 || C <= 0) return;
    int threads = 256;
    if (C < threads) threads = 64;
    softmax_ce_bwd_kernel<<<B, threads>>>(logits, targets, dlogits, B, C);
}

void adamw_step_f32(float* w, float* m, float* v, const float* g, std::size_t n, float lr,
                    float beta1, float beta2, float eps, float weight_decay, int t) {
    if (n == 0 || t < 1) return;
    float bc1 = 1.f - powf(beta1, static_cast<float>(t));
    float bc2 = 1.f - powf(beta2, static_cast<float>(t));
    adamw_kernel<<<grid_n(n), 256>>>(w, m, v, g, n, lr, beta1, beta2, eps, weight_decay, bc1, bc2);
}

}  // namespace cuda_kern
}  // namespace ml
}  // namespace handoffkit
