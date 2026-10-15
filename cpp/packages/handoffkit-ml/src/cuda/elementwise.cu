// Hand-written elementwise CUDA kernels — no third-party libs.

#include <handoffkit/ml/cuda/kernels.hpp>

#include <cuda_runtime.h>

#include <cmath>

namespace handoffkit {
namespace ml {
namespace cuda_kern {
namespace {

__global__ void add_kernel(const float* a, const float* b, float* out, std::size_t n) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = a[i] + b[i];
}

__global__ void mul_kernel(const float* a, const float* b, float* out, std::size_t n) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = a[i] * b[i];
}

__device__ inline float gelu_one(float v) {
    constexpr float k = 0.7978845608f;
    float u = k * (v + 0.044715f * v * v * v);
    return 0.5f * v * (1.f + tanhf(u));
}

__global__ void gelu_kernel(const float* x, float* out, std::size_t n) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = gelu_one(x[i]);
}

__global__ void gelu_bwd_kernel(const float* x, const float* dy, float* dx, std::size_t n) {
    std::size_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    constexpr float k = 0.7978845608f;
    float v = x[i];
    float u = k * (v + 0.044715f * v * v * v);
    float th = tanhf(u);
    float sech2 = 1.f - th * th;
    float du = k * (1.f + 3.f * 0.044715f * v * v);
    float dgelu = 0.5f * (1.f + th) + 0.5f * v * sech2 * du;
    dx[i] = dy[i] * dgelu;
}

__global__ void bias_add_kernel(float* y, const float* bias, int rows, int cols) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    int n = rows * cols;
    if (i < n) y[i] += bias[i % cols];
}

__global__ void bias_grad_kernel(const float* dy, float* db, int rows, int cols) {
    // naive: one thread per col accumulates rows
    int j = blockIdx.x * blockDim.x + threadIdx.x;
    if (j >= cols) return;
    float s = 0.f;
    for (int i = 0; i < rows; ++i) s += dy[i * cols + j];
    db[j] = s;
}

int grid(std::size_t n, int bs = 256) {
    return static_cast<int>((n + static_cast<std::size_t>(bs) - 1) / static_cast<std::size_t>(bs));
}

}  // namespace

void add_f32(const float* a, const float* b, float* out, std::size_t n) {
    if (n == 0) return;
    add_kernel<<<grid(n), 256>>>(a, b, out, n);
}

void mul_f32(const float* a, const float* b, float* out, std::size_t n) {
    if (n == 0) return;
    mul_kernel<<<grid(n), 256>>>(a, b, out, n);
}

void gelu_f32(const float* x, float* out, std::size_t n) {
    if (n == 0) return;
    gelu_kernel<<<grid(n), 256>>>(x, out, n);
}

void gelu_bwd_f32(const float* x, const float* dy, float* dx, std::size_t n) {
    if (n == 0) return;
    gelu_bwd_kernel<<<grid(n), 256>>>(x, dy, dx, n);
}

void bias_add_rows_f32(float* y, const float* bias, int rows, int cols) {
    std::size_t n = static_cast<std::size_t>(rows) * static_cast<std::size_t>(cols);
    if (n == 0) return;
    bias_add_kernel<<<grid(n), 256>>>(y, bias, rows, cols);
}

void bias_grad_rows_f32(const float* dy, float* db, int rows, int cols) {
    if (cols <= 0) return;
    int g = (cols + 255) / 256;
    bias_grad_kernel<<<g, 256>>>(dy, db, rows, cols);
}

}  // namespace cuda_kern
}  // namespace ml
}  // namespace handoffkit
