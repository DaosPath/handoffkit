#pragma once

// Full device-resident train: weights + activations remain on CUDA for the loop.
// Own kernels only (cudart). No cuBLAS.

#include <handoffkit/ml/cuda/kernels.hpp>
#include <handoffkit/ml/cuda/linear_cuda.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <cmath>
#include <memory>
#include <random>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace handoffkit {
namespace ml {

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA

inline void require_gpu() {
    if (!cuda_rt::available()) throw std::runtime_error("CUDA device required");
}

inline Tensor tcuda(std::vector<std::size_t> sh) { return Tensor(std::move(sh), Device::Cuda); }

inline void tzero(Tensor& t) {
    t.ensure_device_alloc();
    cuda_rt::device_memset_zero(t.device_ptr(), t.numel() * sizeof(float));
}

// ----- ResidentLinear: W,b,g always CUDA -----
struct ResidentLinear {
    Tensor W, b, gW, gb, mW, vW, mb, vb, x_cache;
    bool use_bias = true;
    bool adam_ok = false;
    int t = 0;

    static ResidentLinear make(std::size_t in_f, std::size_t out_f, bool bias, std::mt19937& rng) {
        require_gpu();
        ResidentLinear L;
        L.use_bias = bias;
        Tensor Wh({out_f, in_f});
        Wh.xavier(rng);
        L.W = Wh.to(Device::Cuda);
        L.gW = tcuda({out_f, in_f});
        tzero(L.gW);
        if (bias) {
            L.b = tcuda({out_f});
            tzero(L.b);
            L.gb = tcuda({out_f});
            tzero(L.gb);
        }
        return L;
    }

    void zero_grad() {
        tzero(gW);
        if (use_bias) tzero(gb);
    }

    Tensor forward(const Tensor& x) {
        if (x.device != Device::Cuda) throw std::runtime_error("ResidentLinear needs CUDA x");
        x_cache = x;  // same device; shared shape
        // deep device copy of activations for safe backward
        x_cache = tcuda(x.shape);
        cuda_rt::copy_d2d(x_cache.device_ptr(), x.device_ptr(), x.numel() * sizeof(float));
        Tensor bb = use_bias ? b : Tensor();
        return linear_forward_cuda(x_cache, W, bb, use_bias);
    }

    Tensor backward(const Tensor& dy) {
        if (dy.device != Device::Cuda) throw std::runtime_error("ResidentLinear needs CUDA dy");
        auto bw = linear_backward_cuda(x_cache, W, dy, use_bias);
        cuda_kern::add_f32(gW.device_ptr(), bw.dW.device_ptr(), gW.device_ptr(), gW.numel());
        if (use_bias)
            cuda_kern::add_f32(gb.device_ptr(), bw.db.device_ptr(), gb.device_ptr(), gb.numel());
        cuda_rt::device_sync();
        return bw.dx;
    }

    void adamw(float lr, float wd = 0.01f) {
        if (!adam_ok) {
            mW = tcuda(W.shape);
            vW = tcuda(W.shape);
            tzero(mW);
            tzero(vW);
            if (use_bias) {
                mb = tcuda(b.shape);
                vb = tcuda(b.shape);
                tzero(mb);
                tzero(vb);
            }
            adam_ok = true;
        }
        ++t;
        cuda_kern::adamw_step_f32(W.device_ptr(), mW.device_ptr(), vW.device_ptr(), gW.device_ptr(),
                                  W.numel(), lr, 0.9f, 0.999f, 1e-8f, wd, t);
        if (use_bias)
            cuda_kern::adamw_step_f32(b.device_ptr(), mb.device_ptr(), vb.device_ptr(),
                                      gb.device_ptr(), b.numel(), lr, 0.9f, 0.999f, 1e-8f, wd, t);
        zero_grad();
        cuda_rt::device_sync();
    }

    bool on_cuda() const { return W.device == Device::Cuda && W.device_data != nullptr; }
};

struct ResidentRMSNorm {
    Tensor weight, gweight, x_cache, rstd;
    float eps = 1e-5f;

    static ResidentRMSNorm make(std::size_t d) {
        require_gpu();
        ResidentRMSNorm n;
        Tensor w({d});
        w.fill(1.f);
        n.weight = w.to(Device::Cuda);
        n.gweight = tcuda({d});
        tzero(n.gweight);
        return n;
    }

    void zero_grad() { tzero(gweight); }

    Tensor forward(const Tensor& x) {
        x_cache = tcuda(x.shape);
        cuda_rt::copy_d2d(x_cache.device_ptr(), x.device_ptr(), x.numel() * sizeof(float));
        int rows = static_cast<int>(x.shape[0]);
        int D = static_cast<int>(x.shape[1]);
        rstd = tcuda({static_cast<std::size_t>(rows)});
        Tensor out = tcuda(x.shape);
        cuda_kern::rmsnorm_fwd_f32(x_cache.device_ptr(), weight.device_ptr(), out.device_ptr(),
                                   rstd.device_ptr(), rows, D, eps);
        cuda_rt::device_sync();
        return out;
    }

    Tensor backward(const Tensor& dy) {
        int rows = static_cast<int>(x_cache.shape[0]);
        int D = static_cast<int>(x_cache.shape[1]);
        Tensor dx = tcuda(x_cache.shape);
        cuda_kern::rmsnorm_bwd_f32(x_cache.device_ptr(), weight.device_ptr(), rstd.device_ptr(),
                                   dy.device_ptr(), dx.device_ptr(), gweight.device_ptr(), rows, D);
        cuda_rt::device_sync();
        return dx;
    }

    void sgd(float lr) {
        // stay on device: weight += (-lr) * gweight
        cuda_kern::axpy_f32(weight.device_ptr(), gweight.device_ptr(), weight.numel(), -lr);
        zero_grad();
        cuda_rt::device_sync();
    }
};

struct ResidentMLP {
    ResidentLinear fc1, fc2;
    Tensor pre, h;

    static ResidentMLP make(std::size_t embd, std::mt19937& rng) {
        ResidentMLP m;
        m.fc1 = ResidentLinear::make(embd, 4 * embd, true, rng);
        m.fc2 = ResidentLinear::make(4 * embd, embd, true, rng);
        return m;
    }

    void zero_grad() {
        fc1.zero_grad();
        fc2.zero_grad();
    }

    Tensor forward(const Tensor& x) {
        pre = fc1.forward(x);
        h = tcuda(pre.shape);
        cuda_kern::gelu_f32(pre.device_ptr(), h.device_ptr(), pre.numel());
        cuda_rt::device_sync();
        return fc2.forward(h);
    }

    Tensor backward(const Tensor& dy) {
        Tensor dh = fc2.backward(dy);
        Tensor dpre = tcuda(pre.shape);
        cuda_kern::gelu_bwd_f32(pre.device_ptr(), dh.device_ptr(), dpre.device_ptr(), pre.numel());
        cuda_rt::device_sync();
        return fc1.backward(dpre);
    }

    void adamw(float lr) {
        fc1.adamw(lr);
        fc2.adamw(lr);
    }
};

/// Single-sequence causal MHA: Q/K/V/att/y stay on CUDA (no host head packing).
struct ResidentMHA {
    ResidentLinear qkv, proj;
    int n_head = 4;
    int n_embd = 64;
    Tensor x_c, qkv_c, y_pre;
    // per-head caches for full device backward (allocated each forward)
    std::vector<Tensor> cache_Q, cache_K, cache_V, cache_att;
    int T = 0;

    static ResidentMHA make(int embd, int heads, std::mt19937& rng) {
        if (embd % heads) throw std::runtime_error("embd%heads");
        ResidentMHA a;
        a.n_embd = embd;
        a.n_head = heads;
        a.qkv = ResidentLinear::make(static_cast<std::size_t>(embd),
                                     static_cast<std::size_t>(3 * embd), false, rng);
        a.proj = ResidentLinear::make(static_cast<std::size_t>(embd), static_cast<std::size_t>(embd),
                                      true, rng);
        return a;
    }

    void zero_grad() {
        qkv.zero_grad();
        proj.zero_grad();
    }

    Tensor forward_seq(const Tensor& x_td) {
        // x: (T, D) CUDA — entire attention path is device-resident
        if (x_td.ndim() != 2 || static_cast<int>(x_td.shape[1]) != n_embd)
            throw std::runtime_error("MHA x shape");
        if (x_td.device != Device::Cuda) throw std::runtime_error("MHA needs CUDA x");
        T = static_cast<int>(x_td.shape[0]);
        x_c = tcuda(x_td.shape);
        cuda_rt::copy_d2d(x_c.device_ptr(), x_td.device_ptr(), x_td.numel() * sizeof(float));
        qkv_c = qkv.forward(x_c);
        const int D = n_embd, H = n_head, hs = D / H;
        const float inv = 1.f / std::sqrt(static_cast<float>(hs));

        cache_Q.assign(static_cast<std::size_t>(H), Tensor());
        cache_K.assign(static_cast<std::size_t>(H), Tensor());
        cache_V.assign(static_cast<std::size_t>(H), Tensor());
        cache_att.assign(static_cast<std::size_t>(H), Tensor());

        y_pre = tcuda({static_cast<std::size_t>(T), static_cast<std::size_t>(D)});
        tzero(y_pre);

        for (int h = 0; h < H; ++h) {
            Tensor Q = tcuda({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)});
            Tensor K = tcuda(Q.shape);
            Tensor V = tcuda(Q.shape);
            cuda_kern::qkv_split_head_f32(qkv_c.device_ptr(), Q.device_ptr(), K.device_ptr(),
                                          V.device_ptr(), T, D, hs, h);
            Tensor KT = tcuda({static_cast<std::size_t>(hs), static_cast<std::size_t>(T)});
            cuda_kern::transpose2d_f32(K.device_ptr(), KT.device_ptr(), T, hs);
            Tensor scores = tcuda({static_cast<std::size_t>(T), static_cast<std::size_t>(T)});
            cuda_kern::gemm_f32(Q.device_ptr(), KT.device_ptr(), scores.device_ptr(), T, hs, T);
            cuda_kern::scale_inplace_f32(scores.device_ptr(), scores.numel(), inv);
            cuda_kern::causal_mask_f32(scores.device_ptr(), T);
            Tensor att = tcuda(scores.shape);
            cuda_kern::softmax_rows_f32(scores.device_ptr(), att.device_ptr(), T, T);
            Tensor yh = tcuda({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)});
            cuda_kern::gemm_f32(att.device_ptr(), V.device_ptr(), yh.device_ptr(), T, T, hs);
            cuda_kern::merge_head_f32(yh.device_ptr(), y_pre.device_ptr(), T, D, hs, h);
            cache_Q[static_cast<std::size_t>(h)] = std::move(Q);
            cache_K[static_cast<std::size_t>(h)] = std::move(K);
            cache_V[static_cast<std::size_t>(h)] = std::move(V);
            cache_att[static_cast<std::size_t>(h)] = std::move(att);
        }
        cuda_rt::device_sync();
        return proj.forward(y_pre);
    }

    Tensor backward_seq(const Tensor& dy) {
        if (dy.device != Device::Cuda) throw std::runtime_error("MHA needs CUDA dy");
        Tensor dyp = proj.backward(dy);
        const int D = n_embd, H = n_head, hs = D / H;
        const float inv = 1.f / std::sqrt(static_cast<float>(hs));

        Tensor d_qkv = tcuda(qkv_c.shape);
        tzero(d_qkv);

        for (int h = 0; h < H; ++h) {
            Tensor& Q = cache_Q[static_cast<std::size_t>(h)];
            Tensor& K = cache_K[static_cast<std::size_t>(h)];
            Tensor& V = cache_V[static_cast<std::size_t>(h)];
            Tensor& att = cache_att[static_cast<std::size_t>(h)];

            // dy_head (T, hs) ← dyp (T, D) slice — device only
            Tensor dyh = tcuda({static_cast<std::size_t>(T), static_cast<std::size_t>(hs)});
            cuda_kern::unmerge_head_f32(dyp.device_ptr(), dyh.device_ptr(), T, D, hs, h);

            // dV = att^T @ dyh
            Tensor attT = tcuda({static_cast<std::size_t>(T), static_cast<std::size_t>(T)});
            cuda_kern::transpose2d_f32(att.device_ptr(), attT.device_ptr(), T, T);
            Tensor dV = tcuda(dyh.shape);
            cuda_kern::gemm_f32(attT.device_ptr(), dyh.device_ptr(), dV.device_ptr(), T, T, hs);

            // dAtt = dyh @ V^T
            Tensor VT = tcuda({static_cast<std::size_t>(hs), static_cast<std::size_t>(T)});
            cuda_kern::transpose2d_f32(V.device_ptr(), VT.device_ptr(), T, hs);
            Tensor dAtt = tcuda({static_cast<std::size_t>(T), static_cast<std::size_t>(T)});
            cuda_kern::gemm_f32(dyh.device_ptr(), VT.device_ptr(), dAtt.device_ptr(), T, hs, T);

            // dScores = softmax_bwd(att, dAtt) * inv_sqrt
            Tensor dS = tcuda(dAtt.shape);
            cuda_kern::softmax_bwd_rows_f32(att.device_ptr(), dAtt.device_ptr(), dS.device_ptr(), T,
                                            T);
            cuda_kern::scale_inplace_f32(dS.device_ptr(), dS.numel(), inv);

            // dQ = dS @ K ; dK = dS^T @ Q
            Tensor dQ = tcuda(Q.shape);
            cuda_kern::gemm_f32(dS.device_ptr(), K.device_ptr(), dQ.device_ptr(), T, T, hs);
            Tensor dST = tcuda(dS.shape);
            cuda_kern::transpose2d_f32(dS.device_ptr(), dST.device_ptr(), T, T);
            Tensor dK = tcuda(K.shape);
            cuda_kern::gemm_f32(dST.device_ptr(), Q.device_ptr(), dK.device_ptr(), T, T, hs);

            cuda_kern::qkv_scatter_head_f32(dQ.device_ptr(), dK.device_ptr(), dV.device_ptr(),
                                            d_qkv.device_ptr(), T, D, hs, h);
        }
        cuda_rt::device_sync();
        return qkv.backward(d_qkv);
    }

    void adamw(float lr) {
        qkv.adamw(lr);
        proj.adamw(lr);
    }
};

struct ResidentBlock {
    ResidentRMSNorm ln1, ln2;
    ResidentMHA attn;
    ResidentMLP mlp;
    Tensor x_c, a_c;

    static ResidentBlock make(int embd, int heads, std::mt19937& rng) {
        ResidentBlock b;
        b.ln1 = ResidentRMSNorm::make(static_cast<std::size_t>(embd));
        b.ln2 = ResidentRMSNorm::make(static_cast<std::size_t>(embd));
        b.attn = ResidentMHA::make(embd, heads, rng);
        b.mlp = ResidentMLP::make(static_cast<std::size_t>(embd), rng);
        return b;
    }

    void zero_grad() {
        ln1.zero_grad();
        ln2.zero_grad();
        attn.zero_grad();
        mlp.zero_grad();
    }

    Tensor forward(const Tensor& x_td) {
        // (T,D)
        x_c = tcuda(x_td.shape);
        cuda_rt::copy_d2d(x_c.device_ptr(), x_td.device_ptr(), x_td.numel() * sizeof(float));
        Tensor n1 = ln1.forward(x_c);
        a_c = attn.forward_seq(n1);
        Tensor x2 = tcuda(x_c.shape);
        cuda_kern::add_f32(x_c.device_ptr(), a_c.device_ptr(), x2.device_ptr(), x_c.numel());
        cuda_rt::device_sync();
        Tensor n2 = ln2.forward(x2);
        Tensor m = mlp.forward(n2);
        Tensor y = tcuda(x2.shape);
        cuda_kern::add_f32(x2.device_ptr(), m.device_ptr(), y.device_ptr(), x2.numel());
        cuda_rt::device_sync();
        return y;
    }

    Tensor backward(const Tensor& dy) {
        Tensor x2 = tcuda(x_c.shape);
        cuda_kern::add_f32(x_c.device_ptr(), a_c.device_ptr(), x2.device_ptr(), x_c.numel());
        cuda_rt::device_sync();
        // re-run ln2/mlp caches
        Tensor n2 = ln2.forward(x2);
        (void)mlp.forward(n2);
        Tensor dm = dy;
        Tensor dn2 = mlp.backward(dm);
        Tensor dx2a = ln2.backward(dn2);
        Tensor dx2 = tcuda(dy.shape);
        cuda_kern::add_f32(dy.device_ptr(), dx2a.device_ptr(), dx2.device_ptr(), dy.numel());
        cuda_rt::device_sync();
        Tensor n1 = ln1.forward(x_c);
        (void)attn.forward_seq(n1);
        Tensor dn1 = attn.backward_seq(dx2);
        Tensor dx1 = ln1.backward(dn1);
        Tensor dx = tcuda(dx2.shape);
        cuda_kern::add_f32(dx2.device_ptr(), dx1.device_ptr(), dx.device_ptr(), dx2.numel());
        cuda_rt::device_sync();
        return dx;
    }

    void adamw(float lr) {
        ln1.sgd(lr);
        ln2.sgd(lr);
        attn.adamw(lr);
        mlp.adamw(lr);
    }
};

/// Snapshot for residency audits (mid-step, before any end-of-train download).
struct ResidencySnapshot {
    bool weights_on_cuda = false;
    bool activation_on_cuda = false;
    bool activation_device_storage = false;
    std::string note;
};

/// Device-resident GPT: all weights on CUDA; activations on CUDA during step.
struct DeviceGPT {
    int vocab = 259, n_embd = 64, n_head = 4, n_layer = 2, block_size = 48;
    Tensor wte, wpe, gwte, gwpe, m_wte, v_wte, m_wpe, v_wpe;
    bool adam_ok = false;
    int adam_t = 0;
    std::vector<ResidentBlock> blocks;
    ResidentRMSNorm ln_f;
    ResidentLinear lm_head;
    Tensor x0_cache;
    int* d_idx = nullptr;
    std::size_t idx_cap = 0;
    ResidencySnapshot last_residency;

    static DeviceGPT make(int vocab, int embd, int heads, int layers, int blk, int seed = 42) {
        require_gpu();
        std::mt19937 rng(static_cast<unsigned>(seed));
        DeviceGPT g;
        g.vocab = vocab;
        g.n_embd = embd;
        g.n_head = heads;
        g.n_layer = layers;
        g.block_size = blk;
        Tensor te({static_cast<std::size_t>(vocab), static_cast<std::size_t>(embd)});
        te.uniform(0.02f, rng);
        g.wte = te.to(Device::Cuda);
        g.gwte = tcuda(te.shape);
        tzero(g.gwte);
        Tensor pe({static_cast<std::size_t>(blk), static_cast<std::size_t>(embd)});
        pe.uniform(0.02f, rng);
        g.wpe = pe.to(Device::Cuda);
        g.gwpe = tcuda(pe.shape);
        tzero(g.gwpe);
        for (int i = 0; i < layers; ++i) g.blocks.push_back(ResidentBlock::make(embd, heads, rng));
        g.ln_f = ResidentRMSNorm::make(static_cast<std::size_t>(embd));
        g.lm_head =
            ResidentLinear::make(static_cast<std::size_t>(embd), static_cast<std::size_t>(vocab), false, rng);
        return g;
    }

    ~DeviceGPT() {
        if (d_idx) cuda_rt::device_free(d_idx);
    }
    DeviceGPT() = default;
    DeviceGPT(const DeviceGPT&) = delete;
    DeviceGPT& operator=(const DeviceGPT&) = delete;
    DeviceGPT(DeviceGPT&& o) noexcept { move_from(std::move(o)); }
    DeviceGPT& operator=(DeviceGPT&& o) noexcept {
        if (this != &o) move_from(std::move(o));
        return *this;
    }

    void move_from(DeviceGPT&& o) {
        if (d_idx) cuda_rt::device_free(d_idx);
        vocab = o.vocab;
        n_embd = o.n_embd;
        n_head = o.n_head;
        n_layer = o.n_layer;
        block_size = o.block_size;
        wte = std::move(o.wte);
        wpe = std::move(o.wpe);
        gwte = std::move(o.gwte);
        gwpe = std::move(o.gwpe);
        m_wte = std::move(o.m_wte);
        v_wte = std::move(o.v_wte);
        m_wpe = std::move(o.m_wpe);
        v_wpe = std::move(o.v_wpe);
        adam_ok = o.adam_ok;
        adam_t = o.adam_t;
        blocks = std::move(o.blocks);
        ln_f = std::move(o.ln_f);
        lm_head = std::move(o.lm_head);
        x0_cache = std::move(o.x0_cache);
        d_idx = o.d_idx;
        idx_cap = o.idx_cap;
        o.d_idx = nullptr;
        o.idx_cap = 0;
    }

    void ensure_idx(std::size_t n) {
        if (d_idx && n <= idx_cap) return;
        if (d_idx) cuda_rt::device_free(d_idx);
        d_idx = static_cast<int*>(cuda_rt::device_alloc(sizeof(int) * n));
        idx_cap = n;
    }

    void zero_grad() {
        tzero(gwte);
        tzero(gwpe);
        for (auto& b : blocks) b.zero_grad();
        ln_f.zero_grad();
        lm_head.zero_grad();
    }

    bool weights_on_cuda() const {
        return wte.device == Device::Cuda && lm_head.on_cuda() && wte.device_data != nullptr;
    }

    /// Download weights once (end of train / ckpt export only). Not used mid-step.
    GPT to_host_gpt() const {
        if (!weights_on_cuda()) throw std::runtime_error("to_host_gpt: weights not on CUDA");
        GPTConfig c;
        c.vocab_size = vocab;
        c.n_embd = n_embd;
        c.n_head = n_head;
        c.n_layer = n_layer;
        c.block_size = block_size;
        c.seed = 0;
        c.arch = "gpt-mini";
        GPT m(c);
        m.wte = wte.to(Device::Cpu);
        m.gwte = m.wte.zeros_like();
        m.wpe = wpe.to(Device::Cpu);
        m.gwpe = m.wpe.zeros_like();
        if (static_cast<int>(m.blocks.size()) != n_layer)
            throw std::runtime_error("to_host_gpt: layer count mismatch");
        for (int i = 0; i < n_layer; ++i) {
            const auto& rb = blocks[static_cast<std::size_t>(i)];
            auto& hb = m.blocks[static_cast<std::size_t>(i)];
            hb.ln1.weight = rb.ln1.weight.to(Device::Cpu);
            hb.ln1.gweight = hb.ln1.weight.zeros_like();
            hb.attn.qkv.W = rb.attn.qkv.W.to(Device::Cpu);
            hb.attn.qkv.gW = hb.attn.qkv.W.zeros_like();
            hb.attn.qkv.use_bias = rb.attn.qkv.use_bias;
            if (rb.attn.qkv.use_bias) {
                hb.attn.qkv.b = rb.attn.qkv.b.to(Device::Cpu);
                hb.attn.qkv.gb = hb.attn.qkv.b.zeros_like();
            }
            hb.attn.proj.W = rb.attn.proj.W.to(Device::Cpu);
            hb.attn.proj.gW = hb.attn.proj.W.zeros_like();
            hb.attn.proj.use_bias = true;
            hb.attn.proj.b = rb.attn.proj.b.to(Device::Cpu);
            hb.attn.proj.gb = hb.attn.proj.b.zeros_like();
            hb.ln2.weight = rb.ln2.weight.to(Device::Cpu);
            hb.ln2.gweight = hb.ln2.weight.zeros_like();
            hb.mlp.fc1.W = rb.mlp.fc1.W.to(Device::Cpu);
            hb.mlp.fc1.gW = hb.mlp.fc1.W.zeros_like();
            hb.mlp.fc1.b = rb.mlp.fc1.b.to(Device::Cpu);
            hb.mlp.fc1.gb = hb.mlp.fc1.b.zeros_like();
            hb.mlp.fc2.W = rb.mlp.fc2.W.to(Device::Cpu);
            hb.mlp.fc2.gW = hb.mlp.fc2.W.zeros_like();
            hb.mlp.fc2.b = rb.mlp.fc2.b.to(Device::Cpu);
            hb.mlp.fc2.gb = hb.mlp.fc2.b.zeros_like();
        }
        m.ln_f.weight = ln_f.weight.to(Device::Cpu);
        m.ln_f.gweight = m.ln_f.weight.zeros_like();
        m.lm_head.W = lm_head.W.to(Device::Cpu);
        m.lm_head.gW = m.lm_head.W.zeros_like();
        m.lm_head.use_bias = lm_head.use_bias;
        if (lm_head.use_bias) {
            m.lm_head.b = lm_head.b.to(Device::Cpu);
            m.lm_head.gb = m.lm_head.b.zeros_like();
        }
        return m;
    }

    Tensor embed(const std::vector<int>& idx) {
        // B=1 sequence length T
        const int T = static_cast<int>(idx.size());
        ensure_idx(static_cast<std::size_t>(T));
        cuda_rt::copy_h2d(d_idx, idx.data(), sizeof(int) * static_cast<std::size_t>(T));
        Tensor te = tcuda({static_cast<std::size_t>(T), static_cast<std::size_t>(n_embd)});
        cuda_kern::embedding_fwd_f32(wte.device_ptr(), d_idx, te.device_ptr(), T, n_embd);
        std::vector<int> pos(static_cast<std::size_t>(T));
        for (int t = 0; t < T; ++t) pos[static_cast<std::size_t>(t)] = t;
        int* dpos = static_cast<int*>(cuda_rt::device_alloc(sizeof(int) * static_cast<std::size_t>(T)));
        cuda_rt::copy_h2d(dpos, pos.data(), sizeof(int) * static_cast<std::size_t>(T));
        Tensor pe = tcuda(te.shape);
        cuda_kern::embedding_fwd_f32(wpe.device_ptr(), dpos, pe.device_ptr(), T, n_embd);
        cuda_rt::device_free(dpos);
        Tensor x = tcuda(te.shape);
        cuda_kern::add_f32(te.device_ptr(), pe.device_ptr(), x.device_ptr(), x.numel());
        cuda_rt::device_sync();
        x0_cache = tcuda(x.shape);
        cuda_rt::copy_d2d(x0_cache.device_ptr(), x.device_ptr(), x.numel() * sizeof(float));
        return x;
    }

    Tensor forward(const std::vector<int>& idx) {
        Tensor x = embed(idx);
        for (auto& bl : blocks) x = bl.forward(x);
        x = ln_f.forward(x);
        return lm_head.forward(x);
    }

    float train_step(const std::vector<int>& input, const std::vector<int>& target, float lr) {
        if (input.size() != target.size() || input.empty())
            throw std::runtime_error("train_step sizes");
        const int T = static_cast<int>(input.size());
        zero_grad();

        // Forward with caches — activations stay on CUDA for the whole step
        Tensor x = embed(input);
        if (x.device != Device::Cuda || !x.device_data)
            throw std::runtime_error("embed activation left CUDA");
        std::vector<Tensor> bin;
        bin.reserve(blocks.size());
        for (auto& bl : blocks) {
            bin.push_back(tcuda(x.shape));
            cuda_rt::copy_d2d(bin.back().device_ptr(), x.device_ptr(), x.numel() * sizeof(float));
            x = bl.forward(x);
            if (x.device != Device::Cuda || !x.device_data)
                throw std::runtime_error("block activation left CUDA");
        }
        // Residency audit before any scalar loss download / ckpt export
        last_residency.weights_on_cuda = weights_on_cuda();
        last_residency.activation_on_cuda = (x.device == Device::Cuda);
        last_residency.activation_device_storage = (x.device_data != nullptr);
        last_residency.note = "mid_step_pre_loss weights+multi_layer_act on CUDA";
        if (!last_residency.weights_on_cuda || !last_residency.activation_on_cuda ||
            !last_residency.activation_device_storage) {
            throw std::runtime_error("residency assert failed mid train_step");
        }

        Tensor x_ln_in = tcuda(x.shape);
        cuda_rt::copy_d2d(x_ln_in.device_ptr(), x.device_ptr(), x.numel() * sizeof(float));
        x = ln_f.forward(x);
        Tensor logits = lm_head.forward(x);
        if (logits.device != Device::Cuda || !logits.device_data)
            throw std::runtime_error("logits left CUDA");

        int* dt = static_cast<int*>(cuda_rt::device_alloc(sizeof(int) * static_cast<std::size_t>(T)));
        cuda_rt::copy_h2d(dt, target.data(), sizeof(int) * static_cast<std::size_t>(T));
        // intentional host scalar: loss for logging only
        float loss = cuda_kern::ce_mean_f32(logits.device_ptr(), dt, T, vocab);

        Tensor dlog = tcuda(logits.shape);
        cuda_kern::softmax_ce_bwd_f32(logits.device_ptr(), dt, dlog.device_ptr(), T, vocab);
        cuda_rt::device_free(dt);

        Tensor dx = lm_head.backward(dlog);
        // re-forward ln/head caches already set
        dx = ln_f.backward(dx);
        for (int i = static_cast<int>(blocks.size()) - 1; i >= 0; --i) {
            blocks[static_cast<std::size_t>(i)].forward(bin[static_cast<std::size_t>(i)]);
            dx = blocks[static_cast<std::size_t>(i)].backward(dx);
        }
        // emb grads
        ensure_idx(static_cast<std::size_t>(T));
        cuda_rt::copy_h2d(d_idx, input.data(), sizeof(int) * static_cast<std::size_t>(T));
        cuda_kern::embedding_bwd_f32(dx.device_ptr(), d_idx, gwte.device_ptr(), T, n_embd, vocab);
        std::vector<int> pos(static_cast<std::size_t>(T));
        for (int t = 0; t < T; ++t) pos[static_cast<std::size_t>(t)] = t;
        int* dpos = static_cast<int*>(cuda_rt::device_alloc(sizeof(int) * static_cast<std::size_t>(T)));
        cuda_rt::copy_h2d(dpos, pos.data(), sizeof(int) * static_cast<std::size_t>(T));
        cuda_kern::embedding_bwd_f32(dx.device_ptr(), dpos, gwpe.device_ptr(), T, n_embd, block_size);
        cuda_rt::device_free(dpos);

        // optim — weights still on CUDA
        if (!adam_ok) {
            m_wte = tcuda(wte.shape);
            v_wte = tcuda(wte.shape);
            m_wpe = tcuda(wpe.shape);
            v_wpe = tcuda(wpe.shape);
            tzero(m_wte);
            tzero(v_wte);
            tzero(m_wpe);
            tzero(v_wpe);
            adam_ok = true;
        }
        ++adam_t;
        cuda_kern::adamw_step_f32(wte.device_ptr(), m_wte.device_ptr(), v_wte.device_ptr(),
                                  gwte.device_ptr(), wte.numel(), lr, 0.9f, 0.999f, 1e-8f, 0.01f,
                                  adam_t);
        cuda_kern::adamw_step_f32(wpe.device_ptr(), m_wpe.device_ptr(), v_wpe.device_ptr(),
                                  gwpe.device_ptr(), wpe.numel(), lr, 0.9f, 0.999f, 1e-8f, 0.01f,
                                  adam_t);
        for (auto& b : blocks) b.adamw(lr);
        ln_f.sgd(lr);
        lm_head.adamw(lr);
        zero_grad();
        cuda_rt::device_sync();
        if (!weights_on_cuda()) throw std::runtime_error("weights left CUDA during train_step");
        return loss;
    }

    int greedy_next(const std::vector<int>& ctx) {
        Tensor logits = forward(ctx).to(Device::Cpu);
        const std::size_t V = static_cast<std::size_t>(vocab);
        const std::size_t last = ctx.size() - 1;
        int best = 0;
        float bv = logits.data[last * V];
        for (std::size_t j = 1; j < V; ++j) {
            float v = logits.data[last * V + j];
            if (v > bv) {
                bv = v;
                best = static_cast<int>(j);
            }
        }
        return best;
    }
};

#else

struct DeviceGPT {
    static DeviceGPT make(int, int, int, int, int, int = 42) {
        throw std::runtime_error("DeviceGPT requires CUDA build");
    }
    bool weights_on_cuda() const { return false; }
};

struct ResidentLinear {
    static ResidentLinear make(std::size_t, std::size_t, bool, std::mt19937&) {
        throw std::runtime_error("CUDA required");
    }
    bool on_cuda() const { return false; }
};

#endif

}  // namespace ml
}  // namespace handoffkit
