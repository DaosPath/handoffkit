#pragma once

/// Minimal GGUF v3 reader/writer for handoffkit-ml (Phase C).
/// Supports f32 tensors + metadata; allowlisted arches: gpt-mini, gpt2, llama-like.

#include <handoffkit/ml/model_profile.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace handoffkit {
namespace ml {

inline constexpr std::uint32_t kGgufMagic = 0x46554747;  // 'GGUF' LE
inline constexpr std::uint32_t kGgufVersion = 3;

enum class GgufType : std::uint32_t {
    F32 = 0,
    F16 = 1,
    Q4_0 = 2,
    Q8_0 = 8,
    I32 = 24,
    STRING = 8,  // used only in KV — avoid collision; we use dedicated writers
};

struct GgufTensor {
    std::string name;
    std::vector<std::uint64_t> dims;  // row-major shape as stored
    std::uint32_t type = 0;           // 0 = f32
    std::vector<float> data;
};

struct GgufFile {
    std::unordered_map<std::string, std::string> kv_string;
    std::unordered_map<std::string, std::int64_t> kv_i64;
    std::vector<GgufTensor> tensors;
    std::string arch{"gpt2"};
};

inline void write_u32(std::ostream& o, std::uint32_t v) {
    o.write(reinterpret_cast<const char*>(&v), 4);
}
inline void write_u64(std::ostream& o, std::uint64_t v) {
    o.write(reinterpret_cast<const char*>(&v), 8);
}
inline void write_i64(std::ostream& o, std::int64_t v) {
    o.write(reinterpret_cast<const char*>(&v), 8);
}
inline void write_str(std::ostream& o, const std::string& s) {
    write_u64(o, s.size());
    o.write(s.data(), static_cast<std::streamsize>(s.size()));
}
inline std::uint32_t read_u32(std::istream& in) {
    std::uint32_t v = 0;
    in.read(reinterpret_cast<char*>(&v), 4);
    return v;
}
inline std::uint64_t read_u64(std::istream& in) {
    std::uint64_t v = 0;
    in.read(reinterpret_cast<char*>(&v), 8);
    return v;
}
inline std::string read_str(std::istream& in) {
    auto n = read_u64(in);
    std::string s(static_cast<std::size_t>(n), '\0');
    if (n) in.read(s.data(), static_cast<std::streamsize>(n));
    return s;
}

/// Write a simplified GGUF containing GPT weights (f32 only).
inline void export_gpt_gguf(const std::string& path, const GPT& model) {
    if (!is_allowed_arch(model.cfg.arch)) {
        throw std::runtime_error("export_gpt_gguf: arch not allowlisted: " + model.cfg.arch);
    }
    std::ofstream o(path, std::ios::binary);
    if (!o) throw std::runtime_error("cannot write gguf: " + path);

    write_u32(o, kGgufMagic);
    write_u32(o, kGgufVersion);

    // Collect tensors
    std::vector<GgufTensor> ts;
    auto add = [&](const std::string& name, const Tensor& t) {
        GgufTensor g;
        g.name = name;
        g.type = 0;  // f32
        for (auto d : t.shape) g.dims.push_back(d);
        g.data = t.data;
        ts.push_back(std::move(g));
    };
    add("token_embd.weight", model.wte);
    add("position_embd.weight", model.wpe);
    for (std::size_t i = 0; i < model.blocks.size(); ++i) {
        const auto& b = model.blocks[i];
        const std::string p = "blk." + std::to_string(i) + ".";
        add(p + "attn_norm.weight", b.ln1.weight);
        add(p + "attn_qkv.weight", b.attn.qkv.W);
        add(p + "attn_output.weight", b.attn.proj.W);
        add(p + "attn_output.bias", b.attn.proj.b);
        add(p + "ffn_norm.weight", b.ln2.weight);
        add(p + "ffn_up.weight", b.mlp.fc1.W);
        add(p + "ffn_up.bias", b.mlp.fc1.b);
        add(p + "ffn_down.weight", b.mlp.fc2.W);
        add(p + "ffn_down.bias", b.mlp.fc2.b);
    }
    add("output_norm.weight", model.ln_f.weight);
    add("output.weight", model.lm_head.W);

    write_u64(o, ts.size());
    // KV: 4 string/int metadata
    write_u64(o, 6);
    auto kv_str = [&](const std::string& k, const std::string& v) {
        write_str(o, k);
        write_u32(o, 8);  // STRING type id in our simplified scheme
        write_str(o, v);
    };
    auto kv_i = [&](const std::string& k, std::int64_t v) {
        write_str(o, k);
        write_u32(o, 4);  // INT64 simplified
        write_i64(o, v);
    };
    kv_str("general.architecture", model.cfg.arch);
    kv_str("general.name", "handoffkit-ml");
    kv_i("general.vocab_size", model.cfg.vocab_size);
    kv_i("general.n_embd", model.cfg.n_embd);
    kv_i("general.n_layer", model.cfg.n_layer);
    kv_i("general.n_head", model.cfg.n_head);

    // alignment placeholder: tensor infos
    for (const auto& t : ts) {
        write_str(o, t.name);
        write_u32(o, static_cast<std::uint32_t>(t.dims.size()));
        for (auto d : t.dims) write_u64(o, d);
        write_u32(o, t.type);
        write_u64(o, 0);  // offset filled later — simplified: sequential
    }

    // data section
    for (const auto& t : ts) {
        o.write(reinterpret_cast<const char*>(t.data.data()),
                static_cast<std::streamsize>(t.data.size() * sizeof(float)));
    }
}

/// Load simplified GGUF written by export_gpt_gguf (or compatible subset).
inline GPT import_gpt_gguf(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot read gguf: " + path);
    auto magic = read_u32(in);
    auto ver = read_u32(in);
    if (magic != kGgufMagic) throw std::runtime_error("bad gguf magic");
    if (ver != kGgufVersion) throw std::runtime_error("unsupported gguf version");

    auto n_tensors = read_u64(in);
    auto n_kv = read_u64(in);

    GPTConfig cfg;
    cfg.arch = "gpt2";
    for (std::uint64_t i = 0; i < n_kv; ++i) {
        auto key = read_str(in);
        auto typ = read_u32(in);
        if (typ == 8) {
            auto val = read_str(in);
            if (key == "general.architecture") cfg.arch = val;
        } else if (typ == 4) {
            std::int64_t v = 0;
            in.read(reinterpret_cast<char*>(&v), 8);
            if (key == "general.vocab_size") cfg.vocab_size = static_cast<int>(v);
            if (key == "general.n_embd") cfg.n_embd = static_cast<int>(v);
            if (key == "general.n_layer") cfg.n_layer = static_cast<int>(v);
            if (key == "general.n_head") cfg.n_head = static_cast<int>(v);
        } else {
            throw std::runtime_error("unsupported gguf kv type");
        }
    }
    if (!is_allowed_arch(cfg.arch)) {
        throw std::runtime_error("import: arch not allowlisted: " + cfg.arch);
    }

    struct Info {
        std::string name;
        std::vector<std::size_t> dims;
        std::uint32_t type = 0;
    };
    std::vector<Info> infos;
    infos.reserve(static_cast<std::size_t>(n_tensors));
    for (std::uint64_t i = 0; i < n_tensors; ++i) {
        Info info;
        info.name = read_str(in);
        auto nd = read_u32(in);
        info.dims.resize(nd);
        for (std::uint32_t d = 0; d < nd; ++d) info.dims[d] = static_cast<std::size_t>(read_u64(in));
        info.type = read_u32(in);
        (void)read_u64(in);  // offset
        infos.push_back(std::move(info));
    }

    std::unordered_map<std::string, Tensor> weights;
    for (const auto& info : infos) {
        if (info.type != 0) throw std::runtime_error("only f32 tensors supported in import");
        Tensor t(info.dims);
        in.read(reinterpret_cast<char*>(t.data.data()),
                static_cast<std::streamsize>(t.numel() * sizeof(float)));
        weights[info.name] = std::move(t);
    }

    GPT model(cfg);
    auto need = [&](const std::string& n) -> Tensor& {
        auto it = weights.find(n);
        if (it == weights.end()) throw std::runtime_error("missing tensor " + n);
        return it->second;
    };
    model.wte = need("token_embd.weight");
    model.gwte = model.wte.zeros_like();
    model.wpe = need("position_embd.weight");
    model.gwpe = model.wpe.zeros_like();
    for (std::size_t i = 0; i < model.blocks.size(); ++i) {
        auto& b = model.blocks[i];
        const std::string p = "blk." + std::to_string(i) + ".";
        b.ln1.weight = need(p + "attn_norm.weight");
        b.ln1.gweight = b.ln1.weight.zeros_like();
        b.attn.qkv.W = need(p + "attn_qkv.weight");
        b.attn.qkv.gW = b.attn.qkv.W.zeros_like();
        b.attn.proj.W = need(p + "attn_output.weight");
        b.attn.proj.gW = b.attn.proj.W.zeros_like();
        b.attn.proj.b = need(p + "attn_output.bias");
        b.attn.proj.gb = b.attn.proj.b.zeros_like();
        b.ln2.weight = need(p + "ffn_norm.weight");
        b.ln2.gweight = b.ln2.weight.zeros_like();
        b.mlp.fc1.W = need(p + "ffn_up.weight");
        b.mlp.fc1.gW = b.mlp.fc1.W.zeros_like();
        b.mlp.fc1.b = need(p + "ffn_up.bias");
        b.mlp.fc1.gb = b.mlp.fc1.b.zeros_like();
        b.mlp.fc2.W = need(p + "ffn_down.weight");
        b.mlp.fc2.gW = b.mlp.fc2.W.zeros_like();
        b.mlp.fc2.b = need(p + "ffn_down.bias");
        b.mlp.fc2.gb = b.mlp.fc2.b.zeros_like();
    }
    model.ln_f.weight = need("output_norm.weight");
    model.ln_f.gweight = model.ln_f.weight.zeros_like();
    model.lm_head.W = need("output.weight");
    model.lm_head.gW = model.lm_head.W.zeros_like();
    return model;
}

/// Roundtrip: export then import; compare a few weight norms.
inline bool gguf_roundtrip_ok(int seed = 3) {
    GPTConfig cfg;
    cfg.arch = "gpt2";
    cfg.n_embd = 64;
    cfg.n_head = 4;
    cfg.n_layer = 2;
    cfg.block_size = 32;
    cfg.vocab_size = 300;
    cfg.seed = seed;
    GPT a(cfg);
    const std::string path = "test_roundtrip.gguf";
    export_gpt_gguf(path, a);
    GPT b = import_gpt_gguf(path);
    if (b.cfg.n_embd != a.cfg.n_embd || b.cfg.n_layer != a.cfg.n_layer) return false;
    if (b.wte.numel() != a.wte.numel()) return false;
    float err = 0.f;
    for (std::size_t i = 0; i < a.wte.numel(); ++i) err = std::max(err, std::fabs(a.wte.data[i] - b.wte.data[i]));
    return err < 1e-5f;
}

}  // namespace ml
}  // namespace handoffkit
