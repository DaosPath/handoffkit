#pragma once

// Device Linear forward/backward using own CUDA kernels (no cuBLAS).

#include <handoffkit/ml/cuda/kernels.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <stdexcept>
#include <vector>

namespace handoffkit {
namespace ml {

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA

/// y = x @ W^T + b  with all tensors on CUDA (or auto-uploaded).
inline Tensor linear_forward_cuda(const Tensor& x_in, const Tensor& W_in, const Tensor& b_in,
                                  bool use_bias) {
    Tensor x = x_in.device == Device::Cuda ? x_in : x_in.to(Device::Cuda);
    Tensor W = W_in.device == Device::Cuda ? W_in : W_in.to(Device::Cuda);
    if (x.ndim() != 2 || W.ndim() != 2) throw std::runtime_error("linear_forward_cuda ranks");
    const int B = static_cast<int>(x.shape[0]);
    const int In = static_cast<int>(x.shape[1]);
    const int Out = static_cast<int>(W.shape[0]);
    if (static_cast<int>(W.shape[1]) != In) throw std::runtime_error("linear_forward_cuda shapes");

    // WT = W^T  (In, Out)
    Tensor WT({static_cast<std::size_t>(In), static_cast<std::size_t>(Out)}, Device::Cuda);
    cuda_kern::transpose2d_f32(W.device_ptr(), WT.device_ptr(), Out, In);
    Tensor y({static_cast<std::size_t>(B), static_cast<std::size_t>(Out)}, Device::Cuda);
    cuda_kern::gemm_f32(x.device_ptr(), WT.device_ptr(), y.device_ptr(), B, In, Out);
    if (use_bias) {
        Tensor b = b_in.device == Device::Cuda ? b_in : b_in.to(Device::Cuda);
        cuda_kern::bias_add_rows_f32(y.device_ptr(), b.device_ptr(), B, Out);
    }
    cuda_rt::device_sync();
    return y;
}

inline LinearBackward linear_backward_cuda(const Tensor& x_in, const Tensor& W_in,
                                           const Tensor& dy_in, bool use_bias) {
    Tensor x = x_in.device == Device::Cuda ? x_in : x_in.to(Device::Cuda);
    Tensor W = W_in.device == Device::Cuda ? W_in : W_in.to(Device::Cuda);
    Tensor dy = dy_in.device == Device::Cuda ? dy_in : dy_in.to(Device::Cuda);
    const int B = static_cast<int>(x.shape[0]);
    const int In = static_cast<int>(x.shape[1]);
    const int Out = static_cast<int>(W.shape[0]);

    LinearBackward r;
    // dW = dy^T @ x  -> (Out, In)
    Tensor dyT({static_cast<std::size_t>(Out), static_cast<std::size_t>(B)}, Device::Cuda);
    cuda_kern::transpose2d_f32(dy.device_ptr(), dyT.device_ptr(), B, Out);
    r.dW = Tensor({static_cast<std::size_t>(Out), static_cast<std::size_t>(In)}, Device::Cuda);
    cuda_kern::gemm_f32(dyT.device_ptr(), x.device_ptr(), r.dW.device_ptr(), Out, B, In);

    // dx = dy @ W -> (B, In)
    r.dx = Tensor({static_cast<std::size_t>(B), static_cast<std::size_t>(In)}, Device::Cuda);
    cuda_kern::gemm_f32(dy.device_ptr(), W.device_ptr(), r.dx.device_ptr(), B, Out, In);

    r.db = zeros({static_cast<std::size_t>(Out)}, Device::Cuda);
    if (use_bias) {
        cuda_kern::bias_grad_rows_f32(dy.device_ptr(), r.db.device_ptr(), B, Out);
    }
    cuda_rt::device_sync();
    return r;
}

/// One GPU Linear+CE train step. Returns mean loss (downloaded).
inline float linear_ce_step_cuda(Linear& layer, const Tensor& x_cpu, const std::vector<int>& targets,
                                 float lr) {
    if (!cuda_rt::available()) throw std::runtime_error("CUDA not available");
    const int B = static_cast<int>(x_cpu.shape[0]);
    const int C = static_cast<int>(layer.W.shape[0]);
    if (static_cast<int>(targets.size()) != B) throw std::runtime_error("targets size");

    Tensor x = x_cpu.to(Device::Cuda);
    Tensor W = layer.W.to(Device::Cuda);
    Tensor b = layer.use_bias ? layer.b.to(Device::Cuda) : Tensor();

    Tensor logits = linear_forward_cuda(x, W, b, layer.use_bias);
    // CE loss on host for simplicity
    Tensor logits_h = logits.to(Device::Cpu);
    float loss = cross_entropy_mean(logits_h, targets);

    // dlogits on device
    Tensor dlog({static_cast<std::size_t>(B), static_cast<std::size_t>(C)}, Device::Cuda);
    // upload targets
    int* d_t = static_cast<int*>(cuda_rt::device_alloc(sizeof(int) * static_cast<std::size_t>(B)));
    cuda_rt::copy_h2d(d_t, targets.data(), sizeof(int) * static_cast<std::size_t>(B));
    cuda_kern::softmax_ce_bwd_f32(logits.device_ptr(), d_t, dlog.device_ptr(), B, C);
    cuda_rt::device_free(d_t);

    auto bw = linear_backward_cuda(x, W, dlog, layer.use_bias);
    // SGD step on device then download W
    // w -= lr * g  via host for simplicity on dW
    Tensor dW_h = bw.dW.to(Device::Cpu);
    Tensor W_h = W.to(Device::Cpu);
    for (std::size_t i = 0; i < W_h.numel(); ++i) W_h.data[i] -= lr * dW_h.data[i];
    layer.W = W_h;
    if (layer.use_bias) {
        Tensor db_h = bw.db.to(Device::Cpu);
        for (std::size_t i = 0; i < layer.b.numel(); ++i) layer.b.data[i] -= lr * db_h.data[i];
    }
    return loss;
}

#else

inline float linear_ce_step_cuda(Linear&, const Tensor&, const std::vector<int>&, float) {
    throw std::runtime_error("linear_ce_step_cuda requires HANDOFFKIT_ML_CUDA=ON");
}

#endif

}  // namespace ml
}  // namespace handoffkit
