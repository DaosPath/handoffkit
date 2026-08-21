#pragma once

#include <handoffkit/ml/nn.hpp>

#include <cstdint>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

inline constexpr std::uint32_t kHkCkptMagic = 0x484B434B;  // 'HKCK'
inline constexpr std::uint32_t kHkCkptVersion = 1;

inline void write_tensor(std::ostream& o, const Tensor& t) {
    std::uint32_t nd = static_cast<std::uint32_t>(t.ndim());
    o.write(reinterpret_cast<const char*>(&nd), 4);
    for (auto d : t.shape) {
        std::uint32_t dd = static_cast<std::uint32_t>(d);
        o.write(reinterpret_cast<const char*>(&dd), 4);
    }
    std::uint64_t n = t.numel();
    o.write(reinterpret_cast<const char*>(&n), 8);
    if (n) o.write(reinterpret_cast<const char*>(t.data.data()), static_cast<std::streamsize>(n * 4));
}

inline Tensor read_tensor(std::istream& in) {
    std::uint32_t nd = 0;
    in.read(reinterpret_cast<char*>(&nd), 4);
    std::vector<std::size_t> sh(nd);
    for (std::uint32_t i = 0; i < nd; ++i) {
        std::uint32_t dd = 0;
        in.read(reinterpret_cast<char*>(&dd), 4);
        sh[i] = dd;
    }
    std::uint64_t n = 0;
    in.read(reinterpret_cast<char*>(&n), 8);
    Tensor t(sh);
    if (n != t.numel()) throw std::runtime_error("ckpt tensor size mismatch");
    if (n) in.read(reinterpret_cast<char*>(t.data.data()), static_cast<std::streamsize>(n * 4));
    return t;
}

inline void save_gpt(const std::string& path, const GPT& model) {
    std::ofstream o(path, std::ios::binary);
    if (!o) throw std::runtime_error("cannot write ckpt: " + path);
    std::uint32_t magic = kHkCkptMagic, ver = kHkCkptVersion;
    o.write(reinterpret_cast<const char*>(&magic), 4);
    o.write(reinterpret_cast<const char*>(&ver), 4);
    auto wr_i = [&](int v) { o.write(reinterpret_cast<const char*>(&v), 4); };
    wr_i(model.cfg.vocab_size);
    wr_i(model.cfg.n_embd);
    wr_i(model.cfg.n_head);
    wr_i(model.cfg.n_layer);
    wr_i(model.cfg.block_size);
    wr_i(model.cfg.seed);
    write_tensor(o, model.wte);
    write_tensor(o, model.wpe);
    for (const auto& bl : model.blocks) {
        write_tensor(o, bl.ln1.weight);
        write_tensor(o, bl.attn.qkv.W);
        if (bl.attn.qkv.use_bias) write_tensor(o, bl.attn.qkv.b);
        write_tensor(o, bl.attn.proj.W);
        write_tensor(o, bl.attn.proj.b);
        write_tensor(o, bl.ln2.weight);
        write_tensor(o, bl.mlp.fc1.W);
        write_tensor(o, bl.mlp.fc1.b);
        write_tensor(o, bl.mlp.fc2.W);
        write_tensor(o, bl.mlp.fc2.b);
    }
    write_tensor(o, model.ln_f.weight);
    write_tensor(o, model.lm_head.W);
}

inline GPT load_gpt(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot read ckpt: " + path);
    std::uint32_t magic = 0, ver = 0;
    in.read(reinterpret_cast<char*>(&magic), 4);
    in.read(reinterpret_cast<char*>(&ver), 4);
    if (magic != kHkCkptMagic) throw std::runtime_error("bad ckpt magic");
    GPTConfig cfg;
    auto rd_i = [&]() {
        int v = 0;
        in.read(reinterpret_cast<char*>(&v), 4);
        return v;
    };
    cfg.vocab_size = rd_i();
    cfg.n_embd = rd_i();
    cfg.n_head = rd_i();
    cfg.n_layer = rd_i();
    cfg.block_size = rd_i();
    cfg.seed = rd_i();
    GPT model(cfg);
    model.wte = read_tensor(in);
    model.gwte = model.wte.zeros_like();
    model.wpe = read_tensor(in);
    model.gwpe = model.wpe.zeros_like();
    for (auto& bl : model.blocks) {
        bl.ln1.weight = read_tensor(in);
        bl.ln1.gweight = bl.ln1.weight.zeros_like();
        bl.attn.qkv.W = read_tensor(in);
        bl.attn.qkv.gW = bl.attn.qkv.W.zeros_like();
        if (bl.attn.qkv.use_bias) {
            bl.attn.qkv.b = read_tensor(in);
            bl.attn.qkv.gb = bl.attn.qkv.b.zeros_like();
        }
        bl.attn.proj.W = read_tensor(in);
        bl.attn.proj.gW = bl.attn.proj.W.zeros_like();
        bl.attn.proj.b = read_tensor(in);
        bl.attn.proj.gb = bl.attn.proj.b.zeros_like();
        bl.ln2.weight = read_tensor(in);
        bl.ln2.gweight = bl.ln2.weight.zeros_like();
        bl.mlp.fc1.W = read_tensor(in);
        bl.mlp.fc1.gW = bl.mlp.fc1.W.zeros_like();
        bl.mlp.fc1.b = read_tensor(in);
        bl.mlp.fc1.gb = bl.mlp.fc1.b.zeros_like();
        bl.mlp.fc2.W = read_tensor(in);
        bl.mlp.fc2.gW = bl.mlp.fc2.W.zeros_like();
        bl.mlp.fc2.b = read_tensor(in);
        bl.mlp.fc2.gb = bl.mlp.fc2.b.zeros_like();
    }
    model.ln_f.weight = read_tensor(in);
    model.ln_f.gweight = model.ln_f.weight.zeros_like();
    model.lm_head.W = read_tensor(in);
    model.lm_head.gW = model.lm_head.W.zeros_like();
    return model;
}

}  // namespace ml
}  // namespace handoffkit
