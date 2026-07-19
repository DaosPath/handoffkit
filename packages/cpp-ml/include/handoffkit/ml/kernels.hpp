#pragma once

/// Device kernels (Phase D): multi-threaded CPU matmul always;
/// optional CUDA path when HANDOFFKIT_ML_WITH_CUDA and runtime available.

#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <algorithm>
#include <cmath>
#include <random>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
// Declaration only — link cuda kernels when building with CUDA toolkit.
namespace handoffkit {
namespace ml {
namespace cuda_detail {
bool runtime_available();
void matmul_f32(const float* A, const float* B, float* C, int M, int K, int N);
}  // namespace cuda_detail
}  // namespace ml
}  // namespace handoffkit
#endif

namespace handoffkit {
namespace ml {

struct KernelBackendInfo {
    std::string name{"cpu_mt"};
    bool cuda_runtime = false;
    int cpu_threads = 1;
};

inline int default_threads() {
    unsigned n = std::thread::hardware_concurrency();
    return n == 0 ? 2 : static_cast<int>(n);
}

/// Parallel CPU matmul (M,K)@(K,N)->(M,N)
inline Tensor matmul_cpu_mt(const Tensor& a, const Tensor& b, int threads = 0) {
    a.require_cpu();
    b.require_cpu();
    if (a.ndim() != 2 || b.ndim() != 2) throw std::runtime_error("matmul_cpu_mt needs 2D");
    const int M = static_cast<int>(a.shape[0]);
    const int K = static_cast<int>(a.shape[1]);
    const int N = static_cast<int>(b.shape[1]);
    if (static_cast<int>(b.shape[0]) != K) throw std::runtime_error("inner dim");
    Tensor o({static_cast<std::size_t>(M), static_cast<std::size_t>(N)});
    if (threads <= 0) threads = default_threads();
    threads = std::max(1, std::min(threads, M));

    auto worker = [&](int r0, int r1) {
        for (int i = r0; i < r1; ++i) {
            for (int j = 0; j < N; ++j) {
                float s = 0.f;
                for (int k = 0; k < K; ++k) {
                    s += a.data[static_cast<std::size_t>(i * K + k)] *
                         b.data[static_cast<std::size_t>(k * N + j)];
                }
                o.data[static_cast<std::size_t>(i * N + j)] = s;
            }
        }
    };

    if (threads == 1) {
        worker(0, M);
        return o;
    }
    std::vector<std::thread> pool;
    int chunk = (M + threads - 1) / threads;
    for (int t = 0; t < threads; ++t) {
        int r0 = t * chunk;
        int r1 = std::min(M, r0 + chunk);
        if (r0 >= r1) break;
        pool.emplace_back(worker, r0, r1);
    }
    for (auto& th : pool) th.join();
    return o;
}

inline KernelBackendInfo query_kernel_backend() {
    KernelBackendInfo info;
    info.cpu_threads = default_threads();
    info.name = "cpu_mt";
    info.cuda_runtime = false;
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    if (cuda_detail::runtime_available()) {
        info.cuda_runtime = true;
        info.name = "cuda";
    }
#endif
    return info;
}

/// Unified matmul: CUDA if available & requested, else multi-thread CPU.
inline Tensor matmul_device(const Tensor& a, const Tensor& b, bool prefer_cuda = true) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    if (prefer_cuda && cuda_detail::runtime_available()) {
        a.require_cpu();
        b.require_cpu();
        const int M = static_cast<int>(a.shape[0]);
        const int K = static_cast<int>(a.shape[1]);
        const int N = static_cast<int>(b.shape[1]);
        Tensor o({a.shape[0], b.shape[1]});
        cuda_detail::matmul_f32(a.data.data(), b.data.data(), o.data.data(), M, K, N);
        return o;
    }
#else
    (void)prefer_cuda;
#endif
    return matmul_cpu_mt(a, b);
}

/// Causal attention scores using matmul_device for QK^T style blocks (validation path).
inline float attention_score_kernel_smoke(int T = 8, int hs = 16) {
    Tensor Q({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)});
    Tensor K({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)});
    std::mt19937 rng(1);
    Q.uniform(0.1f, rng);
    K.uniform(0.1f, rng);
    Tensor KT = transpose2d(K);
    Tensor scores = matmul_device(Q, KT, false);
    // causal mask
    for (int t = 0; t < T; ++t)
        for (int s = t + 1; s < T; ++s) scores.data[static_cast<std::size_t>(t * T + s)] = -1e9f;
    auto p = softmax_rows(scores);
    return sum_all(p);
}

}  // namespace ml
}  // namespace handoffkit
