#pragma once

#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>

#include <cmath>
#include <random>

namespace handoffkit {
namespace ml {

/// LoRA on a Linear: y = x @ (W + scale * B @ A)^T + b
/// A: (rank, in), B: (out, rank). Train A,B; base W frozen by caller.
struct LoraLinear {
    Linear* base = nullptr;  // non-owning
    Tensor A;                // (rank, in)
    Tensor B;                // (out, rank)
    Tensor gA, gB;
    float scale = 1.f;
    int rank = 4;
    Tensor x_cache;
    Tensor delta_cache;

    static LoraLinear wrap(Linear& lin, int r, int seed) {
        LoraLinear L;
        L.base = &lin;
        L.rank = r;
        std::mt19937 rng(static_cast<unsigned>(seed));
        const std::size_t out_f = lin.W.shape[0];
        const std::size_t in_f = lin.W.shape[1];
        L.A = Tensor({static_cast<std::size_t>(r), in_f});
        L.B = Tensor({out_f, static_cast<std::size_t>(r)});
        L.A.uniform(0.02f, rng);
        L.B.zero();  // B=0 => identity start
        L.gA = L.A.zeros_like();
        L.gB = L.B.zeros_like();
        L.scale = 1.f;
        return L;
    }

    [[nodiscard]] Tensor effective_W() const {
        // W_eff = W + scale * B @ A
        Tensor BA = matmul(B, A);  // (out, in)
        Tensor We = base->W.clone();
        for (std::size_t i = 0; i < We.numel(); ++i) We.data[i] += scale * BA.data[i];
        return We;
    }

    [[nodiscard]] Tensor forward(const Tensor& x) {
        x_cache = x.clone();
        Tensor We = effective_W();
        Tensor y = matmul(x, transpose2d(We));
        if (base->use_bias) {
            const std::size_t BB = y.shape[0], Out = y.shape[1];
            for (std::size_t i = 0; i < BB; ++i)
                for (std::size_t j = 0; j < Out; ++j) y.data[i * Out + j] += base->b.data[j];
        }
        return y;
    }

    Tensor backward(const Tensor& dy) {
        Tensor We = effective_W();
        auto bw = linear_backward(x_cache, We, dy, base->use_bias);
        // d(BA)=dW_eff; dB = dW @ A^T; dA = B^T @ dW
        Tensor dW = bw.dW;
        for (auto& v : dW.data) v *= scale;
        Tensor dB = matmul(dW, transpose2d(A));
        Tensor dA = matmul(transpose2d(B), dW);
        add_inplace(gA, dA);
        add_inplace(gB, dB);
        // do not update base->gW when LoRA-only training
        return bw.dx;
    }

    void zero_grad() {
        gA.zero();
        gB.zero();
    }

    void collect_params(std::vector<Param>& out) {
        out.push_back(Param{&A, &gA});
        out.push_back(Param{&B, &gB});
    }

    /// Merge LoRA into base weights (in-place).
    void merge_into(Linear& lin) const {
        Tensor BA = matmul(B, A);
        for (std::size_t i = 0; i < lin.W.numel(); ++i) lin.W.data[i] += scale * BA.data[i];
        // reset adapters optional
    }
};

}  // namespace ml
}  // namespace handoffkit
