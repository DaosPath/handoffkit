#pragma once

#include <handoffkit/ml/tensor.hpp>

#include <cmath>
#include <vector>

namespace handoffkit {
namespace ml {

struct Param {
    Tensor* w = nullptr;
    Tensor* g = nullptr;  // same shape as w; accumulated grad
    // Adam state
    Tensor m;
    Tensor v;
    bool adam_init = false;
};

class SGD {
public:
    float lr = 0.1f;
    float weight_decay = 0.f;

    void step(std::vector<Param>& params) {
        for (auto& p : params) {
            if (!p.w || !p.g) continue;
            auto& w = *p.w;
            auto& g = *p.g;
            for (std::size_t i = 0; i < w.numel(); ++i) {
                float gi = g.data[i] + weight_decay * w.data[i];
                w.data[i] -= lr * gi;
            }
            g.zero();
        }
    }
};

class AdamW {
public:
    float lr = 1e-3f;
    float beta1 = 0.9f;
    float beta2 = 0.999f;
    float eps = 1e-8f;
    float weight_decay = 0.01f;
    int t = 0;

    void step(std::vector<Param>& params) {
        ++t;
        const float bc1 = 1.f - std::pow(beta1, static_cast<float>(t));
        const float bc2 = 1.f - std::pow(beta2, static_cast<float>(t));
        for (auto& p : params) {
            if (!p.w || !p.g) continue;
            auto& w = *p.w;
            auto& g = *p.g;
            if (!p.adam_init) {
                p.m = w.zeros_like();
                p.v = w.zeros_like();
                p.adam_init = true;
            }
            for (std::size_t i = 0; i < w.numel(); ++i) {
                // decoupled weight decay
                w.data[i] -= lr * weight_decay * w.data[i];
                const float gi = g.data[i];
                p.m.data[i] = beta1 * p.m.data[i] + (1.f - beta1) * gi;
                p.v.data[i] = beta2 * p.v.data[i] + (1.f - beta2) * gi * gi;
                const float mhat = p.m.data[i] / bc1;
                const float vhat = p.v.data[i] / bc2;
                w.data[i] -= lr * mhat / (std::sqrt(vhat) + eps);
            }
            g.zero();
        }
    }
};

inline void clip_grad_norm(std::vector<Param>& params, float max_norm) {
    if (max_norm <= 0.f) return;
    double sq = 0.0;
    for (auto& p : params) {
        if (!p.g) continue;
        for (float x : p.g->data) sq += static_cast<double>(x) * x;
    }
    const float norm = static_cast<float>(std::sqrt(sq));
    if (norm <= max_norm || norm < 1e-12f) return;
    const float scale = max_norm / norm;
    for (auto& p : params) {
        if (!p.g) continue;
        for (auto& x : p.g->data) x *= scale;
    }
}

}  // namespace ml
}  // namespace handoffkit
