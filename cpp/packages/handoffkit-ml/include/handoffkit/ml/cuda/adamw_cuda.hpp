#pragma once

#include <handoffkit/ml/cuda/kernels.hpp>
#include <handoffkit/ml/cuda/linear_cuda.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/optim.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <cmath>
#include <random>
#include <stdexcept>
#include <vector>

namespace handoffkit {
namespace ml {

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA

/// AdamW step on GPU for a list of params (uploads, steps, downloads weights).
inline void adamw_step_cuda(std::vector<Param>& params, AdamW& opt) {
    if (!cuda_rt::available()) throw std::runtime_error("CUDA not available");
    ++opt.t;
    for (auto& p : params) {
        if (!p.w || !p.g) continue;
        if (!p.adam_init) {
            p.m = p.w->zeros_like();
            p.v = p.w->zeros_like();
            p.adam_init = true;
        }
        Tensor w = p.w->to(Device::Cuda);
        Tensor g = p.g->to(Device::Cuda);
        Tensor m = p.m.to(Device::Cuda);
        Tensor v = p.v.to(Device::Cuda);
        cuda_kern::adamw_step_f32(w.device_ptr(), m.device_ptr(), v.device_ptr(), g.device_ptr(),
                                  w.numel(), opt.lr, opt.beta1, opt.beta2, opt.eps,
                                  opt.weight_decay, opt.t);
        cuda_rt::device_sync();
        *p.w = w.to(Device::Cpu);
        p.m = m.to(Device::Cpu);
        p.v = v.to(Device::Cpu);
        p.g->zero();
    }
}

/// Smoke: overfit Linear with AdamW on GPU; return final CE.
inline float adamw_cuda_overfit(int steps = 150) {
    std::mt19937 rng(2);
    Linear layer(8, 4, true, rng);
    AdamW opt;
    opt.lr = 0.05f;
    opt.weight_decay = 0.f;
    std::vector<int> ys = {0, 1, 2, 3, 0, 1, 2, 3};
    Tensor x({8, 8});
    for (int i = 0; i < 8; ++i)
        for (int j = 0; j < 8; ++j) x.data[static_cast<std::size_t>(i * 8 + j)] = (i == j) ? 1.f : 0.f;

    float last = 99.f;
    for (int s = 0; s < steps; ++s) {
        layer.zero_grad();
        Tensor logits = linear_forward_cuda(x, layer.W, layer.b, true).to(Device::Cpu);
        last = cross_entropy_mean(logits, ys);
        Tensor dlog = softmax_ce_backward(logits, ys);
        auto bw = linear_backward_cuda(x, layer.W, dlog, true);
        layer.gW = bw.dW.to(Device::Cpu);
        if (layer.use_bias) layer.gb = bw.db.to(Device::Cpu);
        std::vector<Param> params;
        layer.collect_params(params);
        adamw_step_cuda(params, opt);
    }
    return last;
}

#else

inline float adamw_cuda_overfit(int = 150) {
    throw std::runtime_error("adamw_cuda requires CUDA build");
}

#endif

}  // namespace ml
}  // namespace handoffkit
