#pragma once

#include <handoffkit/ml/cuda/linear_cuda.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>

#include <random>
#include <stdexcept>
#include <vector>

namespace handoffkit {
namespace ml {

/// Run a Linear CE overfit fully on GPU (CUDA-3/5 building block). Returns final loss.
inline float cuda_linear_overfit(int steps = 100) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    if (!cuda_rt::available()) throw std::runtime_error("no GPU");
    std::mt19937 rng(11);
    Linear layer(8, 4, true, rng);
    std::vector<std::vector<float>> xs;
    std::vector<int> ys;
    for (int i = 0; i < 8; ++i) {
        std::vector<float> row(8, 0.f);
        row[static_cast<std::size_t>(i)] = 1.f;
        xs.push_back(row);
        ys.push_back(i % 4);
    }
    float last = 99.f;
    for (int s = 0; s < steps; ++s) {
        Tensor x({8, 8});
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 8; ++j)
                x.data[static_cast<std::size_t>(i * 8 + j)] =
                    xs[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)];
        last = linear_ce_step_cuda(layer, x, ys, 0.2f);
    }
    return last;
#else
    (void)steps;
    throw std::runtime_error("cuda_linear_overfit requires CUDA build");
#endif
}

}  // namespace ml
}  // namespace handoffkit
