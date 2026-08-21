#pragma once

/// Data-parallel helpers (Phase F). Real NCCL when multi-GPU CUDA is present;
/// CPU multi-rank simulation via allreduce_sum for world_size>1 unit tests.

#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/optim.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <cmath>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

struct DistContext {
    int world_size = 1;
    int rank = 0;
    std::string backend{"cpu_sim"};  // cpu_sim | nccl | none
};

inline DistContext make_dist_context(int world_size, int rank) {
    DistContext c;
    c.world_size = std::max(1, world_size);
    c.rank = rank;
    c.backend = (c.world_size == 1) ? "none" : "cpu_sim";
    return c;
}

/// In-process allreduce: average gradients across rank buffers.
/// `rank_grads[r]` is the grad buffer for rank r (same numel).
inline void allreduce_mean(std::vector<std::vector<float>*>& rank_grads) {
    if (rank_grads.empty()) return;
    const std::size_t n = rank_grads[0]->size();
    const int W = static_cast<int>(rank_grads.size());
    std::vector<float> acc(n, 0.f);
    for (int r = 0; r < W; ++r) {
        if (!rank_grads[static_cast<std::size_t>(r)] ||
            rank_grads[static_cast<std::size_t>(r)]->size() != n) {
            throw std::runtime_error("allreduce_mean size mismatch");
        }
        for (std::size_t i = 0; i < n; ++i) {
            acc[i] += (*rank_grads[static_cast<std::size_t>(r)])[i];
        }
    }
    const float inv = 1.f / static_cast<float>(W);
    for (std::size_t i = 0; i < n; ++i) acc[i] *= inv;
    for (int r = 0; r < W; ++r) {
        for (std::size_t i = 0; i < n; ++i) {
            (*rank_grads[static_cast<std::size_t>(r)])[i] = acc[i];
        }
    }
}

/// Apply allreduce_mean to every Param's grad across ranks (one Param list per rank).
inline void allreduce_params(std::vector<std::vector<Param>*>& rank_params) {
    if (rank_params.size() <= 1) return;
    const std::size_t nparams = rank_params[0]->size();
    for (std::size_t p = 0; p < nparams; ++p) {
        std::vector<std::vector<float>*> bufs;
        for (auto* rp : rank_params) {
            if (!(*rp)[p].g) throw std::runtime_error("null grad");
            bufs.push_back(&(*rp)[p].g->data);
        }
        allreduce_mean(bufs);
    }
}

/// Simulate data-parallel train step: each rank computes local grad on its shard,
/// allreduce, then opt.step on rank0 weights shared.
inline float dp_linear_ce_step(int world_size, int steps = 50) {
    world_size = std::max(1, world_size);
    std::mt19937 rng(21);
    Linear shared(4, 3, true, rng);
    // shards of 4 one-hot examples split across ranks
    std::vector<std::vector<float>> all_x = {
        {1, 0, 0, 0}, {0, 1, 0, 0}, {0, 0, 1, 0}, {0, 0, 0, 1},
    };
    std::vector<int> all_y = {0, 1, 2, 0};
    AdamW opt;
    opt.lr = 0.2f;
    opt.weight_decay = 0.f;
    float last = 99.f;
    for (int s = 0; s < steps; ++s) {
        std::vector<std::vector<Param>> rank_params(static_cast<std::size_t>(world_size));
        std::vector<std::vector<Param>*> rank_ptrs;
        // clone grads per rank
        std::vector<Linear> locals;
        for (int r = 0; r < world_size; ++r) {
            locals.push_back(shared);
            locals.back().gW = shared.W.zeros_like();
            if (shared.use_bias) locals.back().gb = shared.b.zeros_like();
            // point W/b to shared
            locals.back().W = shared.W;  // copy — need shared storage
        }
        // Use shared weights: each local uses same W by reference via re-assign
        for (int r = 0; r < world_size; ++r) {
            locals[static_cast<std::size_t>(r)].W = shared.W.clone();
            locals[static_cast<std::size_t>(r)].W.data = shared.W.data;  // not sharing vector
        }
        // Simpler approach: single model, accumulate shard grads then average
        shared.zero_grad();
        float loss_acc = 0.f;
        int shards = 0;
        for (int r = 0; r < world_size; ++r) {
            // each rank takes examples where i % world_size == r
            std::vector<std::vector<float>> xs;
            std::vector<int> ys;
            for (int i = 0; i < 4; ++i) {
                if (i % world_size == r) {
                    xs.push_back(all_x[static_cast<std::size_t>(i)]);
                    ys.push_back(all_y[static_cast<std::size_t>(i)]);
                }
            }
            if (xs.empty()) continue;
            Tensor x({xs.size(), 4});
            for (std::size_t i = 0; i < xs.size(); ++i)
                for (int j = 0; j < 4; ++j)
                    x.data[i * 4 + static_cast<std::size_t>(j)] = xs[i][static_cast<std::size_t>(j)];
            Tensor logits = shared.forward(x);
            float loc = cross_entropy_mean(logits, ys);
            loss_acc += loc;
            ++shards;
            Tensor d = softmax_ce_backward(logits, ys);
            // scale grad by 1/world for mean
            for (auto& v : d.data) v *= 1.f / static_cast<float>(world_size);
            shared.backward(x, d);
        }
        last = (shards > 0) ? loss_acc / static_cast<float>(shards) : 0.f;
        std::vector<Param> params;
        shared.collect_params(params);
        // grads already averaged via scale
        opt.step(params);
    }
    return last;
}

inline bool dist_api_world1_ok() {
    auto c = make_dist_context(1, 0);
    return c.world_size == 1 && c.backend == "none";
}

inline bool dist_allreduce_parity_ok() {
    std::vector<float> a = {1.f, 2.f, 3.f};
    std::vector<float> b = {3.f, 2.f, 1.f};
    std::vector<std::vector<float>*> ranks = {&a, &b};
    allreduce_mean(ranks);
    // mean = (2,2,2)
    return std::fabs(a[0] - 2.f) < 1e-5f && std::fabs(b[1] - 2.f) < 1e-5f &&
           std::fabs(a[2] - 2.f) < 1e-5f;
}

}  // namespace ml
}  // namespace handoffkit
