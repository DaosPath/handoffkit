#pragma once

#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>

#include <algorithm>
#include <cmath>
#include <random>
#include <vector>

namespace handoffkit {
namespace ml {

/// Numerical parity: max |analytic - finite-diff| on input of CausalSelfAttention.
/// loss = sum(attn_out) so dy = ones.
inline float attention_input_grad_parity(std::size_t B = 1,
                                         std::size_t T = 6,
                                         std::size_t D = 32,
                                         std::size_t H = 4,
                                         float eps = 1e-3f,
                                         int seed = 11) {
    if (D % H != 0) throw std::runtime_error("D%H");
    std::mt19937 rng(static_cast<unsigned>(seed));
    CausalSelfAttention attn(D, H, rng);
    Tensor x({B * T, D});
    x.uniform(0.2f, rng);

    // analytic
    attn.zero_grad();
    Tensor y = attn.forward(x, B, T);
    Tensor dy = y.zeros_like();
    dy.fill(1.f);
    Tensor dx = attn.backward(dy, B, T);

    float max_err = 0.f;
    // finite differences on a subset of coords for speed (all if small)
    const std::size_t ncheck = std::min<std::size_t>(x.numel(), 48);
    for (std::size_t i = 0; i < ncheck; ++i) {
        const float orig = x.data[i];
        x.data[i] = orig + eps;
        float fp = sum_all(attn.forward(x, B, T));
        x.data[i] = orig - eps;
        float fm = sum_all(attn.forward(x, B, T));
        x.data[i] = orig;
        float num = (fp - fm) / (2.f * eps);
        max_err = std::max(max_err, std::fabs(num - dx.data[i]));
    }
    return max_err;
}

/// Parity on qkv weight W (first few entries).
inline float attention_weight_grad_parity(float eps = 1e-3f, int seed = 13) {
    const std::size_t B = 1, T = 5, D = 32, H = 4;
    std::mt19937 rng(static_cast<unsigned>(seed));
    CausalSelfAttention attn(D, H, rng);
    Tensor x({B * T, D});
    x.uniform(0.15f, rng);

    attn.zero_grad();
    Tensor y = attn.forward(x, B, T);
    Tensor dy = y.zeros_like();
    dy.fill(1.f);
    (void)attn.backward(dy, B, T);
    Tensor gW = attn.qkv.gW.clone();

    float max_err = 0.f;
    const std::size_t ncheck = std::min<std::size_t>(gW.numel(), 32);
    for (std::size_t i = 0; i < ncheck; ++i) {
        const float orig = attn.qkv.W.data[i];
        attn.qkv.W.data[i] = orig + eps;
        float fp = sum_all(attn.forward(x, B, T));
        attn.qkv.W.data[i] = orig - eps;
        float fm = sum_all(attn.forward(x, B, T));
        attn.qkv.W.data[i] = orig;
        float num = (fp - fm) / (2.f * eps);
        max_err = std::max(max_err, std::fabs(num - gW.data[i]));
    }
    return max_err;
}

}  // namespace ml
}  // namespace handoffkit
