// Softmax over rows — hand-written (no cuDNN).

#include <handoffkit/ml/cuda/kernels.hpp>

#include <cuda_runtime.h>

#include <cfloat>

namespace handoffkit {
namespace ml {
namespace cuda_kern {
namespace {

// One block per row; blockDim.x threads reduce along cols.
__global__ void softmax_rows_kernel(const float* x, float* out, int rows, int cols) {
    int r = blockIdx.x;
    if (r >= rows) return;
    const float* row = x + static_cast<std::size_t>(r) * cols;
    float* orow = out + static_cast<std::size_t>(r) * cols;

    // max
    float m = -FLT_MAX;
    for (int j = threadIdx.x; j < cols; j += blockDim.x) {
        m = fmaxf(m, row[j]);
    }
    __shared__ float sm[256];
    sm[threadIdx.x] = m;
    __syncthreads();
    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (threadIdx.x < s) sm[threadIdx.x] = fmaxf(sm[threadIdx.x], sm[threadIdx.x + s]);
        __syncthreads();
    }
    m = sm[0];

    float sum = 0.f;
    for (int j = threadIdx.x; j < cols; j += blockDim.x) {
        float e = expf(row[j] - m);
        orow[j] = e;
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
    for (int j = threadIdx.x; j < cols; j += blockDim.x) {
        orow[j] *= inv;
    }
}

}  // namespace

void softmax_rows_f32(const float* x, float* out, int rows, int cols) {
    if (rows <= 0 || cols <= 0) return;
    int threads = 256;
    if (cols < threads) threads = 64;
    softmax_rows_kernel<<<rows, threads>>>(x, out, rows, cols);
}

}  // namespace cuda_kern
}  // namespace ml
}  // namespace handoffkit
