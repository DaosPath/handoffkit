#pragma once

// Causal attention scores path on GPU using own GEMM + softmax (no FlashAttention/cuDNN).

#include <handoffkit/ml/cuda/kernels.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <algorithm>
#include <cmath>
#include <random>
#include <stdexcept>

namespace handoffkit {
namespace ml {

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA

/// Q,K,V: (T, hs) on host or device. Returns attention output (T, hs) on CUDA then downloaded.
inline Tensor causal_attn_head_cuda(const Tensor& Q_in, const Tensor& K_in, const Tensor& V_in) {
    if (!cuda_rt::available()) throw std::runtime_error("CUDA not available");
    Tensor Q = Q_in.device == Device::Cuda ? Q_in : Q_in.to(Device::Cuda);
    Tensor K = K_in.device == Device::Cuda ? K_in : K_in.to(Device::Cuda);
    Tensor V = V_in.device == Device::Cuda ? V_in : V_in.to(Device::Cuda);
    if (Q.ndim() != 2 || K.ndim() != 2 || V.ndim() != 2) throw std::runtime_error("attn ranks");
    const int T = static_cast<int>(Q.shape[0]);
    const int hs = static_cast<int>(Q.shape[1]);
    if (static_cast<int>(K.shape[0]) != T || static_cast<int>(V.shape[0]) != T)
        throw std::runtime_error("attn T mismatch");

    // scores = Q @ K^T / sqrt(hs)  -> (T,T)
    Tensor KT({static_cast<std::size_t>(hs), static_cast<std::size_t>(T)}, Device::Cuda);
    cuda_kern::transpose2d_f32(K.device_ptr(), KT.device_ptr(), T, hs);
    Tensor scores({static_cast<std::size_t>(T), static_cast<std::size_t>(T)}, Device::Cuda);
    cuda_kern::gemm_f32(Q.device_ptr(), KT.device_ptr(), scores.device_ptr(), T, hs, T);
    // scale
    Tensor scores_h = scores.to(Device::Cpu);
    float inv = 1.f / std::sqrt(static_cast<float>(hs));
    for (auto& v : scores_h.data) v *= inv;
    scores = scores_h.to(Device::Cuda);
    cuda_kern::causal_mask_f32(scores.device_ptr(), T);

    Tensor att({static_cast<std::size_t>(T), static_cast<std::size_t>(T)}, Device::Cuda);
    cuda_kern::softmax_rows_f32(scores.device_ptr(), att.device_ptr(), T, T);

    // out = att @ V -> (T, hs)
    Tensor out({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)}, Device::Cuda);
    cuda_kern::gemm_f32(att.device_ptr(), V.device_ptr(), out.device_ptr(), T, T, hs);
    cuda_rt::device_sync();
    return out;
}

/// Compare GPU causal attn head vs CPU reference; returns max abs error.
inline float causal_attn_cuda_parity(int T = 8, int hs = 16, int seed = 3) {
    std::mt19937 rng(static_cast<unsigned>(seed));
    Tensor Q({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)});
    Tensor K({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)});
    Tensor V({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)});
    Q.uniform(0.2f, rng);
    K.uniform(0.2f, rng);
    V.uniform(0.2f, rng);

    // CPU reference
    Tensor KT = transpose2d(K);
    Tensor scores = matmul(Q, KT);
    float inv = 1.f / std::sqrt(static_cast<float>(hs));
    for (auto& v : scores.data) v *= inv;
    for (int t = 0; t < T; ++t)
        for (int s = t + 1; s < T; ++s)
            scores.data[static_cast<std::size_t>(t * T + s)] = -1e9f;
    Tensor att = softmax_rows(scores);
    Tensor ref = matmul(att, V);

    Tensor gpu = causal_attn_head_cuda(Q, K, V).to(Device::Cpu);
    float err = 0.f;
    for (std::size_t i = 0; i < ref.numel(); ++i)
        err = std::max(err, std::fabs(ref.data[i] - gpu.data[i]));
    return err;
}

#else

inline float causal_attn_cuda_parity(int = 8, int = 16, int = 3) { return -1.f; }

#endif

}  // namespace ml
}  // namespace handoffkit
