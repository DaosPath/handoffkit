#pragma once

/// NF4 quantization + QLoRA-style train (Phase E).
/// Base weights stored NF4; LoRA adapters train in f32; dequant for forward.

#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/peft.hpp>
#include <handoffkit/ml/quant.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace handoffkit {
namespace ml {

/// Approximate NF4 codebook (16 levels, from QLoRA paper style symmetric).
inline const float* nf4_codebook() {
    static const float cb[16] = {
        -1.0f, -0.6961928009986877f, -0.5250730514526367f, -0.39491748809814453f,
        -0.28444138169288635f, -0.18477343022823334f, -0.09105003625154495f, 0.0f,
        0.07958029955625534f, 0.16093020141124725f, 0.24611230194568634f, 0.33791524171829224f,
        0.44070982933044434f, 0.5626170039176941f, 0.7229568362236023f, 1.0f,
    };
    return cb;
}

struct Nf4Tensor {
    std::vector<std::uint8_t> packed;  // 2 values per byte (nibbles)
    std::vector<float> absmax;         // per-block scale
    int block_size = 64;
    std::vector<std::size_t> shape;
};

inline Nf4Tensor quantize_nf4(const Tensor& t, int block = 64) {
    Nf4Tensor q;
    q.block_size = block;
    q.shape = t.shape;
    const auto* cb = nf4_codebook();
    const std::size_t n = t.numel();
    const std::size_t nblocks = (n + static_cast<std::size_t>(block) - 1) / static_cast<std::size_t>(block);
    q.absmax.assign(nblocks, 1.f);
    q.packed.assign((n + 1) / 2, 0);
    for (std::size_t b = 0; b < nblocks; ++b) {
        std::size_t i0 = b * static_cast<std::size_t>(block);
        std::size_t i1 = std::min(n, i0 + static_cast<std::size_t>(block));
        float amax = 0.f;
        for (std::size_t i = i0; i < i1; ++i) amax = std::max(amax, std::fabs(t.data[i]));
        if (amax < 1e-8f) amax = 1.f;
        q.absmax[b] = amax;
        for (std::size_t i = i0; i < i1; ++i) {
            float x = t.data[i] / amax;
            int best = 0;
            float bestd = std::fabs(x - cb[0]);
            for (int c = 1; c < 16; ++c) {
                float d = std::fabs(x - cb[c]);
                if (d < bestd) {
                    bestd = d;
                    best = c;
                }
            }
            std::size_t byte = i / 2;
            if ((i & 1) == 0) q.packed[byte] = static_cast<std::uint8_t>(best);
            else q.packed[byte] = static_cast<std::uint8_t>(q.packed[byte] | (best << 4));
        }
    }
    return q;
}

inline Tensor dequantize_nf4(const Nf4Tensor& q) {
    Tensor t(q.shape);
    const auto* cb = nf4_codebook();
    const std::size_t n = t.numel();
    const int block = q.block_size;
    for (std::size_t i = 0; i < n; ++i) {
        std::size_t b = i / static_cast<std::size_t>(block);
        std::uint8_t byte = q.packed[i / 2];
        int code = (i & 1) ? (byte >> 4) : (byte & 0xf);
        t.data[i] = cb[code] * q.absmax[b];
    }
    return t;
}

/// QLoRA step on a Linear: freeze NF4 base, train LoRA, return loss after CE.
struct QLoraLinear {
    Nf4Tensor base_nf4;
    Linear base_view;  // dequantized view each step
    LoraLinear lora;
    Tensor W_dequant;

    static QLoraLinear from_linear(const Linear& lin, int rank, int seed) {
        QLoraLinear q;
        q.base_nf4 = quantize_nf4(lin.W);
        q.W_dequant = dequantize_nf4(q.base_nf4);
        // build a Linear shell
        std::mt19937 rng(static_cast<unsigned>(seed));
        q.base_view = Linear(lin.W.shape[1], lin.W.shape[0], lin.use_bias, rng);
        q.base_view.W = q.W_dequant.clone();
        q.base_view.gW = q.base_view.W.zeros_like();
        if (lin.use_bias) {
            q.base_view.b = lin.b.clone();
            q.base_view.gb = lin.b.zeros_like();
        }
        q.lora = LoraLinear::wrap(q.base_view, rank, seed + 1);
        return q;
    }

    void refresh_dequant() {
        W_dequant = dequantize_nf4(base_nf4);
        base_view.W = W_dequant.clone();
    }

    [[nodiscard]] Tensor forward(const Tensor& x) {
        refresh_dequant();
        return lora.forward(x);
    }

    Tensor backward(const Tensor& dy) { return lora.backward(dy); }

    void zero_grad() { lora.zero_grad(); }
    void collect_params(std::vector<Param>& out) { lora.collect_params(out); }
};

/// End-to-end QLoRA classification overfit for tests.
inline float qlora_overfit_ce(int steps = 300) {
    std::mt19937 rng(5);
    Linear base(8, 4, true, rng);
    auto q = QLoraLinear::from_linear(base, 4, 7);
    std::vector<std::vector<float>> xs;
    std::vector<int> ys;
    for (int i = 0; i < 8; ++i) {
        std::vector<float> row(8, 0.f);
        row[static_cast<std::size_t>(i)] = 1.f;
        xs.push_back(row);
        ys.push_back(i % 4);
    }
    AdamW opt;
    opt.lr = 0.05f;
    opt.weight_decay = 0.f;
    float last = 99.f;
    for (int s = 0; s < steps; ++s) {
        Tensor x({8, 8});
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 8; ++j)
                x.data[static_cast<std::size_t>(i * 8 + j)] = xs[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)];
        q.zero_grad();
        Tensor logits = q.forward(x);
        last = cross_entropy_mean(logits, ys);
        Tensor d = softmax_ce_backward(logits, ys);
        q.backward(d);
        std::vector<Param> params;
        q.collect_params(params);
        opt.step(params);
    }
    return last;
}

}  // namespace ml
}  // namespace handoffkit
