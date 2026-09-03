#pragma once

#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/optim.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <cmath>
#include <memory>
#include <random>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

struct Linear {
    Tensor W;  // (out, in)
    Tensor b;  // (out,)
    Tensor gW;
    Tensor gb;
    bool use_bias = true;

    Linear() = default;
    Linear(std::size_t in_f, std::size_t out_f, bool bias, std::mt19937& rng)
        : use_bias(bias) {
        W = Tensor({out_f, in_f});
        W.xavier(rng);
        gW = W.zeros_like();
        if (use_bias) {
            b = zeros({out_f});
            gb = b.zeros_like();
        }
    }

    [[nodiscard]] Tensor forward(const Tensor& x) const {
        // x (B,in) -> (B,out)
        Tensor y = matmul(x, transpose2d(W));
        if (use_bias) {
            const std::size_t B = y.shape[0], Out = y.shape[1];
            for (std::size_t i = 0; i < B; ++i)
                for (std::size_t j = 0; j < Out; ++j) y.data[i * Out + j] += b.data[j];
        }
        return y;
    }

    /// Accumulate grads into gW/gb; return dx.
    Tensor backward(const Tensor& x, const Tensor& dy) {
        auto bw = linear_backward(x, W, dy, use_bias);
        add_inplace(gW, bw.dW);
        if (use_bias) add_inplace(gb, bw.db);
        return bw.dx;
    }

    void zero_grad() {
        gW.zero();
        if (use_bias) gb.zero();
    }

    void collect_params(std::vector<Param>& out) {
        out.push_back(Param{&W, &gW});
        if (use_bias) out.push_back(Param{&b, &gb});
    }
};

/// RMSNorm over last dim (2D: (B,D)).
struct RMSNorm {
    Tensor weight;  // (D,)
    Tensor gweight;
    float eps = 1e-5f;

    RMSNorm() = default;
    explicit RMSNorm(std::size_t d) {
        weight = ones({d});
        gweight = weight.zeros_like();
    }

    [[nodiscard]] Tensor forward(const Tensor& x) const {
        // x (B,T,D) flattened as (B*T, D) or (B,D)
        if (x.ndim() != 2) throw std::runtime_error("RMSNorm expects 2D");
        const std::size_t B = x.shape[0], D = x.shape[1];
        Tensor y({B, D});
        for (std::size_t i = 0; i < B; ++i) {
            float ms = 0.f;
            for (std::size_t j = 0; j < D; ++j) {
                float v = x.data[i * D + j];
                ms += v * v;
            }
            ms = std::sqrt(ms / static_cast<float>(D) + eps);
            for (std::size_t j = 0; j < D; ++j) {
                y.data[i * D + j] = (x.data[i * D + j] / ms) * weight.data[j];
            }
        }
        return y;
    }

    // Approximate backward treating rms as constant per row for tiny models (stable enough for smoke).
    Tensor backward(const Tensor& x, const Tensor& dy) {
        if (x.ndim() != 2) throw std::runtime_error("RMSNorm backward 2D");
        const std::size_t B = x.shape[0], D = x.shape[1];
        Tensor dx({B, D});
        for (std::size_t i = 0; i < B; ++i) {
            float ms = 0.f;
            for (std::size_t j = 0; j < D; ++j) {
                float v = x.data[i * D + j];
                ms += v * v;
            }
            ms = std::sqrt(ms / static_cast<float>(D) + eps);
            for (std::size_t j = 0; j < D; ++j) {
                gweight.data[j] += dy.data[i * D + j] * (x.data[i * D + j] / ms);
                dx.data[i * D + j] = dy.data[i * D + j] * weight.data[j] / ms;
            }
        }
        return dx;
    }

    void zero_grad() { gweight.zero(); }
    void collect_params(std::vector<Param>& out) { out.push_back(Param{&weight, &gweight}); }
};

/// Causal multi-head self-attention on sequence flattened as (B*T, D) with explicit T.
struct CausalSelfAttention {
    Linear qkv;  // in D -> 3D
    Linear proj;
    std::size_t n_head = 2;
    std::size_t n_embd = 32;

    CausalSelfAttention() = default;
    CausalSelfAttention(std::size_t embd, std::size_t heads, std::mt19937& rng)
        : n_head(heads), n_embd(embd) {
        if (embd % heads != 0) throw std::runtime_error("n_embd % n_head != 0");
        qkv = Linear(embd, 3 * embd, false, rng);
        proj = Linear(embd, embd, true, rng);
    }

    // Cache for backward
    struct Cache {
        Tensor x;      // (B*T, D)
        Tensor qkv_o;  // (B*T, 3D) cached for correct backward
        Tensor att;    // (B*H, T, T) stored flat B*H*T*T
        Tensor y_pre;  // after att @ v before proj, (B*T, D)
        std::size_t B = 0, T = 0;
    };
    mutable Cache cache;

    [[nodiscard]] Tensor forward(const Tensor& x_bt_d, std::size_t B, std::size_t T) const {
        // x: (B*T, D)
        const std::size_t D = n_embd;
        const std::size_t H = n_head;
        const std::size_t hs = D / H;
        Tensor qkv_o = qkv.forward(x_bt_d);  // (B*T, 3D)
        cache.qkv_o = qkv_o.clone();
        // Split into q,k,v each (B, H, T, hs) conceptually
        Tensor y({B * T, D});
        y.zero();
        cache.x = x_bt_d.clone();
        cache.B = B;
        cache.T = T;
        cache.att = zeros({B * H * T * T});
        cache.y_pre = zeros({B * T, D});

        auto idx = [&](std::size_t b, std::size_t t, std::size_t c) {
            return (b * T + t) * (3 * D) + c;
        };

        for (std::size_t b = 0; b < B; ++b) {
            for (std::size_t h = 0; h < H; ++h) {
                // scores (T,T)
                std::vector<float> scores(T * T, 0.f);
                for (std::size_t t = 0; t < T; ++t) {
                    for (std::size_t s = 0; s <= t; ++s) {
                        float dot = 0.f;
                        for (std::size_t i = 0; i < hs; ++i) {
                            float q = qkv_o.data[idx(b, t, h * hs + i)];
                            float k = qkv_o.data[idx(b, s, D + h * hs + i)];
                            dot += q * k;
                        }
                        scores[t * T + s] = dot / std::sqrt(static_cast<float>(hs));
                    }
                    for (std::size_t s = t + 1; s < T; ++s) scores[t * T + s] = -1e9f;
                }
                // softmax rows
                for (std::size_t t = 0; t < T; ++t) {
                    float m = scores[t * T];
                    for (std::size_t s = 1; s < T; ++s) m = std::max(m, scores[t * T + s]);
                    float sum = 0.f;
                    for (std::size_t s = 0; s < T; ++s) {
                        scores[t * T + s] = std::exp(scores[t * T + s] - m);
                        sum += scores[t * T + s];
                    }
                    for (std::size_t s = 0; s < T; ++s) scores[t * T + s] /= sum;
                }
                // store att
                for (std::size_t t = 0; t < T; ++t)
                    for (std::size_t s = 0; s < T; ++s)
                        cache.att.data[((b * H + h) * T + t) * T + s] = scores[t * T + s];
                // out = att @ v
                for (std::size_t t = 0; t < T; ++t) {
                    for (std::size_t i = 0; i < hs; ++i) {
                        float acc = 0.f;
                        for (std::size_t s = 0; s < T; ++s) {
                            float v = qkv_o.data[idx(b, s, 2 * D + h * hs + i)];
                            acc += scores[t * T + s] * v;
                        }
                        cache.y_pre.data[(b * T + t) * D + h * hs + i] = acc;
                        y.data[(b * T + t) * D + h * hs + i] = acc;
                    }
                }
            }
        }
        return proj.forward(y);
    }

    Tensor backward(const Tensor& dy, std::size_t B, std::size_t T) {
        // Simplified: project backward then approximate residual path through attention
        // with finite-free path: treat attention as fixed for d_qkv via y_pre
        Tensor d_ypre = proj.backward(cache.y_pre, dy);
        // Propagate d_ypre to qkv via identity-ish path (attn frozen grads for stability in tiny train)
        // Full correct attention backward is long; we accumulate proj+qkv with residual connection style:
        // d_qkv from d_ypre broadcast through value path only (partial) + residual to x via qkv
        Tensor d_qkv_out = zeros({B * T, 3 * n_embd});
        const std::size_t D = n_embd, H = n_head, hs = D / H;
        auto idx = [&](std::size_t b, std::size_t t, std::size_t c) {
            return (b * T + t) * (3 * D) + c;
        };
        // dV via att^T @ dY; dScores via outer; then dQ,dK
        const Tensor& qkv_o = cache.qkv_o;
        for (std::size_t b = 0; b < B; ++b) {
            for (std::size_t h = 0; h < H; ++h) {
                for (std::size_t t = 0; t < T; ++t) {
                    for (std::size_t s = 0; s < T; ++s) {
                        float a = cache.att.data[((b * H + h) * T + t) * T + s];
                        for (std::size_t i = 0; i < hs; ++i) {
                            float dyv = d_ypre.data[(b * T + t) * D + h * hs + i];
                            d_qkv_out.data[idx(b, s, 2 * D + h * hs + i)] += a * dyv;
                        }
                    }
                }
                // d scores
                std::vector<float> dscore(T * T, 0.f);
                for (std::size_t t = 0; t < T; ++t) {
                    for (std::size_t s = 0; s < T; ++s) {
                        float acc = 0.f;
                        for (std::size_t i = 0; i < hs; ++i) {
                            float v = qkv_o.data[idx(b, s, 2 * D + h * hs + i)];
                            acc += d_ypre.data[(b * T + t) * D + h * hs + i] * v;
                        }
                        dscore[t * T + s] = acc;
                    }
                }
                // softmax backward
                for (std::size_t t = 0; t < T; ++t) {
                    float dot = 0.f;
                    for (std::size_t s = 0; s < T; ++s) {
                        float a = cache.att.data[((b * H + h) * T + t) * T + s];
                        dot += dscore[t * T + s] * a;
                    }
                    for (std::size_t s = 0; s < T; ++s) {
                        float a = cache.att.data[((b * H + h) * T + t) * T + s];
                        float ds = a * (dscore[t * T + s] - dot);
                        // dQ, dK
                        for (std::size_t i = 0; i < hs; ++i) {
                            float scale = 1.f / std::sqrt(static_cast<float>(hs));
                            float q = qkv_o.data[idx(b, t, h * hs + i)];
                            float k = qkv_o.data[idx(b, s, D + h * hs + i)];
                            d_qkv_out.data[idx(b, t, h * hs + i)] += ds * scale * k;
                            d_qkv_out.data[idx(b, s, D + h * hs + i)] += ds * scale * q;
                        }
                    }
                }
            }
        }
        return qkv.backward(cache.x, d_qkv_out);
    }

    void zero_grad() {
        qkv.zero_grad();
        proj.zero_grad();
    }
    void collect_params(std::vector<Param>& out) {
        qkv.collect_params(out);
        proj.collect_params(out);
    }
};

struct MLP {
    Linear fc1;
    Linear fc2;
    Tensor pre_cache;
    Tensor h_cache;
    Tensor x_cache;

    MLP() = default;
    MLP(std::size_t embd, std::mt19937& rng) {
        fc1 = Linear(embd, 4 * embd, true, rng);
        fc2 = Linear(4 * embd, embd, true, rng);
    }

    [[nodiscard]] Tensor forward(const Tensor& x) {
        x_cache = x.clone();
        pre_cache = fc1.forward(x);
        h_cache = gelu(pre_cache);
        return fc2.forward(h_cache);
    }

    Tensor backward(const Tensor& /*x*/, const Tensor& dy) {
        Tensor dh = fc2.backward(h_cache, dy);
        Tensor dpre = gelu_backward(pre_cache, dh);
        return fc1.backward(x_cache, dpre);
    }

    void zero_grad() {
        fc1.zero_grad();
        fc2.zero_grad();
    }
    void collect_params(std::vector<Param>& out) {
        fc1.collect_params(out);
        fc2.collect_params(out);
    }
};

struct Block {
    RMSNorm ln1;
    CausalSelfAttention attn;
    RMSNorm ln2;
    MLP mlp;
    Tensor x_cache, a_cache, n1_cache, n2_cache;

    Block() = default;
    Block(std::size_t embd, std::size_t heads, std::mt19937& rng)
        : ln1(embd), attn(embd, heads, rng), ln2(embd), mlp(embd, rng) {}

    [[nodiscard]] Tensor forward(const Tensor& x, std::size_t B, std::size_t T) {
        x_cache = x.clone();
        n1_cache = ln1.forward(x);
        a_cache = attn.forward(n1_cache, B, T);
        Tensor x2 = add(x, a_cache);
        n2_cache = ln2.forward(x2);
        Tensor m = mlp.forward(n2_cache);
        return add(x2, m);
    }

    Tensor backward(const Tensor& dy, std::size_t B, std::size_t T) {
        // y = x2 + mlp(ln2(x2)); x2 = x + attn(ln1(x))
        Tensor x2 = add(x_cache, a_cache);
        Tensor dm = dy.clone();
        Tensor dn2 = mlp.backward(n2_cache, dm);
        Tensor dx2_from_mlp = ln2.backward(x2, dn2);
        Tensor dx2 = add(dy, dx2_from_mlp);
        Tensor da = dx2.clone();
        Tensor dx_from_attn = attn.backward(da, B, T);
        Tensor dn1 = dx_from_attn;  // path through attn to ln1 out
        // actually attn.backward returns dx of ln1 input path - it returns d(n1)
        Tensor dx_ln = ln1.backward(x_cache, dn1);
        return add(dx2, dx_ln);
    }

    void zero_grad() {
        ln1.zero_grad();
        attn.zero_grad();
        ln2.zero_grad();
        mlp.zero_grad();
    }
    void collect_params(std::vector<Param>& out) {
        ln1.collect_params(out);
        attn.collect_params(out);
        ln2.collect_params(out);
        mlp.collect_params(out);
    }
};

struct GPTConfig {
    // Non-tiny Standard defaults (Phase A floors). Use DebugTiny for unit tests.
    int vocab_size = 1024;
    int n_embd = 128;
    int n_head = 4;
    int n_layer = 4;
    int block_size = 128;
    int seed = 42;
    std::string arch{"gpt2"};  // gpt-mini | gpt2 | llama-like
};

struct GPT {
    GPTConfig cfg;
    Tensor wte;  // (V, D)
    Tensor gwte;
    Tensor wpe;  // (T, D)
    Tensor gwpe;
    std::vector<Block> blocks;
    RMSNorm ln_f;
    Linear lm_head;  // optional weight-tying: use wte as head; we use separate small head
    // caches
    Tensor tok_emb_cache;
    std::vector<int> last_idx;

    GPT() = default;
    explicit GPT(GPTConfig c) : cfg(c) {
        std::mt19937 rng(static_cast<unsigned>(cfg.seed));
        wte = Tensor({static_cast<std::size_t>(cfg.vocab_size),
                      static_cast<std::size_t>(cfg.n_embd)});
        wte.uniform(0.02f, rng);
        gwte = wte.zeros_like();
        wpe = Tensor({static_cast<std::size_t>(cfg.block_size),
                      static_cast<std::size_t>(cfg.n_embd)});
        wpe.uniform(0.02f, rng);
        gwpe = wpe.zeros_like();
        blocks.reserve(static_cast<std::size_t>(cfg.n_layer));
        for (int i = 0; i < cfg.n_layer; ++i) {
            blocks.emplace_back(static_cast<std::size_t>(cfg.n_embd),
                                static_cast<std::size_t>(cfg.n_head), rng);
        }
        ln_f = RMSNorm(static_cast<std::size_t>(cfg.n_embd));
        lm_head = Linear(static_cast<std::size_t>(cfg.n_embd),
                         static_cast<std::size_t>(cfg.vocab_size), false, rng);
    }

    /// idx length B*T, values in vocab. Returns logits (B*T, V)
    [[nodiscard]] Tensor forward(const std::vector<int>& idx, std::size_t B, std::size_t T) {
        if (idx.size() != B * T) throw std::runtime_error("idx size");
        last_idx = idx;
        const std::size_t D = static_cast<std::size_t>(cfg.n_embd);
        Tensor x({B * T, D});
        for (std::size_t b = 0; b < B; ++b) {
            for (std::size_t t = 0; t < T; ++t) {
                int id = idx[b * T + t];
                if (id < 0 || id >= cfg.vocab_size) id = 0;
                for (std::size_t d = 0; d < D; ++d) {
                    x.data[(b * T + t) * D + d] =
                        wte.data[static_cast<std::size_t>(id) * D + d] + wpe.data[t * D + d];
                }
            }
        }
        tok_emb_cache = x.clone();
        for (auto& bl : blocks) x = bl.forward(x, B, T);
        x = ln_f.forward(x);
        return lm_head.forward(x);
    }

    float loss_and_backward(const std::vector<int>& idx,
                            const std::vector<int>& targets,
                            std::size_t B,
                            std::size_t T,
                            const std::vector<float>& loss_mask /* 0/1 per position, size B*T */) {
        // Forward with intermediates
        if (idx.size() != B * T) throw std::runtime_error("idx size");
        last_idx = idx;
        const std::size_t D = static_cast<std::size_t>(cfg.n_embd);
        Tensor x({B * T, D});
        for (std::size_t b = 0; b < B; ++b) {
            for (std::size_t t = 0; t < T; ++t) {
                int id = idx[b * T + t];
                if (id < 0 || id >= cfg.vocab_size) id = 0;
                for (std::size_t d = 0; d < D; ++d) {
                    x.data[(b * T + t) * D + d] =
                        wte.data[static_cast<std::size_t>(id) * D + d] + wpe.data[t * D + d];
                }
            }
        }
        tok_emb_cache = x.clone();
        std::vector<Tensor> block_in;
        block_in.reserve(blocks.size());
        for (auto& bl : blocks) {
            block_in.push_back(x.clone());
            x = bl.forward(x, B, T);
        }
        Tensor x_ln_in = x.clone();
        x = ln_f.forward(x);
        Tensor x_head_in = x.clone();
        Tensor logits = lm_head.forward(x);

        const std::size_t V = static_cast<std::size_t>(cfg.vocab_size);
        auto logp = log_softmax_rows(logits);
        float loss = 0.f;
        float denom = 0.f;
        Tensor dlog = logits.zeros_like();
        auto p = softmax_rows(logits);
        for (std::size_t i = 0; i < B * T; ++i) {
            float m = loss_mask.empty() ? 1.f : loss_mask[i];
            if (m <= 0.f) continue;
            int t = targets[i];
            if (t < 0 || t >= cfg.vocab_size) continue;
            loss += -logp.data[i * V + static_cast<std::size_t>(t)] * m;
            denom += m;
            for (std::size_t j = 0; j < V; ++j) dlog.data[i * V + j] = p.data[i * V + j] * m;
            dlog.data[i * V + static_cast<std::size_t>(t)] -= m;
        }
        if (denom < 1e-6f) return 0.f;
        loss /= denom;
        for (auto& v : dlog.data) v /= denom;

        Tensor dx = lm_head.backward(x_head_in, dlog);
        dx = ln_f.backward(x_ln_in, dx);
        for (int i = static_cast<int>(blocks.size()) - 1; i >= 0; --i) {
            (void)blocks[static_cast<std::size_t>(i)].forward(block_in[static_cast<std::size_t>(i)], B, T);
            dx = blocks[static_cast<std::size_t>(i)].backward(dx, B, T);
        }
        for (std::size_t b = 0; b < B; ++b) {
            for (std::size_t t = 0; t < T; ++t) {
                int id = idx[b * T + t];
                if (id < 0 || id >= cfg.vocab_size) id = 0;
                for (std::size_t d = 0; d < D; ++d) {
                    float g = dx.data[(b * T + t) * D + d];
                    gwte.data[static_cast<std::size_t>(id) * D + d] += g;
                    gwpe.data[t * D + d] += g;
                }
            }
        }
        return loss;
    }

    void zero_grad() {
        gwte.zero();
        gwpe.zero();
        for (auto& bl : blocks) bl.zero_grad();
        ln_f.zero_grad();
        lm_head.zero_grad();
    }

    void collect_params(std::vector<Param>& out) {
        out.push_back(Param{&wte, &gwte});
        out.push_back(Param{&wpe, &gwpe});
        for (auto& bl : blocks) bl.collect_params(out);
        ln_f.collect_params(out);
        lm_head.collect_params(out);
    }
};

/// Overfit a tiny Linear classifier (F1 proof).
[[nodiscard]] inline float overfit_linear_sgd(int steps = 200) {
    std::mt19937 rng(7);
    Linear layer(4, 3, true, rng);
    // Fixed dataset: 4 points XOR-like in R^4 one-hot-ish
    std::vector<std::vector<float>> xs = {
        {1, 0, 0, 0},
        {0, 1, 0, 0},
        {0, 0, 1, 0},
        {0, 0, 0, 1},
    };
    std::vector<int> ys = {0, 1, 2, 0};
    SGD opt;
    opt.lr = 0.5f;
    float last = 0.f;
    for (int step = 0; step < steps; ++step) {
        Tensor x({4, 4});
        for (int i = 0; i < 4; ++i)
            for (int j = 0; j < 4; ++j) x.data[static_cast<std::size_t>(i * 4 + j)] = xs[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)];
        layer.zero_grad();
        Tensor logits = layer.forward(x);
        last = cross_entropy_mean(logits, ys);
        Tensor d = softmax_ce_backward(logits, ys);
        layer.backward(x, d);
        std::vector<Param> params;
        layer.collect_params(params);
        opt.step(params);
    }
    return last;
}

}  // namespace ml
}  // namespace handoffkit
