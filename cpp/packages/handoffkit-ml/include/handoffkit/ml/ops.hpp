#pragma once

#include <handoffkit/ml/tensor.hpp>

#include <utility>
#include <vector>

namespace handoffkit {
namespace ml {

/// Elementwise add (same shape).
[[nodiscard]] Tensor add(const Tensor& a, const Tensor& b);
void add_inplace(Tensor& a, const Tensor& b);

/// Elementwise mul.
[[nodiscard]] Tensor mul(const Tensor& a, const Tensor& b);
[[nodiscard]] Tensor mul_scalar(const Tensor& a, float s);

/// a - b
[[nodiscard]] Tensor sub(const Tensor& a, const Tensor& b);

/// Matrix multiply: (M,K) @ (K,N) -> (M,N)
[[nodiscard]] Tensor matmul(const Tensor& a, const Tensor& b);

/// Transpose 2D.
[[nodiscard]] Tensor transpose2d(const Tensor& a);

/// ReLU
[[nodiscard]] Tensor relu(const Tensor& x);
/// GELU (tanh approx)
[[nodiscard]] Tensor gelu(const Tensor& x);

/// Softmax over last dim (2D: rows).
[[nodiscard]] Tensor softmax_rows(const Tensor& x);

/// Log-softmax over last dim.
[[nodiscard]] Tensor log_softmax_rows(const Tensor& x);

/// Mean of all elements.
[[nodiscard]] float mean_all(const Tensor& x);

/// Sum of all elements.
[[nodiscard]] float sum_all(const Tensor& x);

/// Cross-entropy: logits (B,C), targets class indices length B. Returns scalar mean loss.
[[nodiscard]] float cross_entropy_mean(const Tensor& logits, const std::vector<int>& targets);

/// Backward for Linear: y = x @ W^T + b  with W (out,in), x (B,in), y (B,out)
/// Given dy (B,out), accumulate dW, db, return dx.
struct LinearBackward {
    Tensor dx;
    Tensor dW;
    Tensor db;
};
[[nodiscard]] LinearBackward linear_backward(const Tensor& x,
                                               const Tensor& W,
                                               const Tensor& dy,
                                               bool has_bias);

/// dL/dx for ReLU given dy and forward x.
[[nodiscard]] Tensor relu_backward(const Tensor& x, const Tensor& dy);

/// dL/dx for GELU (approx via finite difference free analytic tanh form).
[[nodiscard]] Tensor gelu_backward(const Tensor& x, const Tensor& dy);

/// Softmax + CE combined backward: logits (B,C), targets -> d_logits
[[nodiscard]] Tensor softmax_ce_backward(const Tensor& logits, const std::vector<int>& targets);

/// Numerical gradcheck for f: R^n -> R. Returns max |analytic - numeric|.
using ScalarFn = float (*)(const std::vector<float>&);
[[nodiscard]] float gradcheck_scalar(const std::vector<float>& x0,
                                     const std::vector<float>& analytic_grad,
                                     ScalarFn f,
                                     float eps = 1e-3f);

/// Gradcheck matmul path: loss = sum(A @ B), compare dA.
[[nodiscard]] bool gradcheck_matmul(float tol = 1e-2f);

/// Gradcheck linear + CE overfit helper (returns max relative error).
[[nodiscard]] float gradcheck_linear_ce(float eps = 1e-3f);

/// Prefer own CUDA GEMM inside matmul when available (default true if CUDA built).
void handoffkit_ml_set_prefer_cuda_matmul(bool prefer);
[[nodiscard]] bool handoffkit_ml_get_prefer_cuda_matmul();

}  // namespace ml
}  // namespace handoffkit
