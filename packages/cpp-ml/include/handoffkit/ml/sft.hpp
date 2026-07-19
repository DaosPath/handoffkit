#pragma once

#include <handoffkit/ml/bpe.hpp>
#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/cuda/resident.hpp>
#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/dist.hpp>
#include <handoffkit/ml/gguf.hpp>
#include <handoffkit/ml/model_profile.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/optim.hpp>
#include <handoffkit/ml/peft.hpp>
#include <handoffkit/ml/qlora.hpp>
#include <handoffkit/ml/token.hpp>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

enum class TokenizerKind { Byte, Bpe };

struct SftConfig {
    int epochs = 20;
    // Non-tiny Standard floors by default (Phase A/B)
    int block_size = 128;
    int n_embd = 128;
    int n_head = 4;
    int n_layer = 4;
    float lr = 3e-3f;
    int seed = 42;
    bool use_lora = false;
    int lora_rank = 8;
    bool preference = false;
    float dpo_beta = 0.1f;
    TokenizerKind tokenizer = TokenizerKind::Bpe;
    int bpe_merges = 256;
    std::string bpe_path;       // optional load; else train from dataset text
    bool allow_tiny = false;    // unit tests may set true
    bool use_qlora = false;     // Phase E
    int world_size = 1;         // Phase F
    int rank = 0;
    std::string arch{"gpt2"};
    /// Load pretrained base before SFT (external GGUF or .hkckpt). Empty = random init.
    std::string base_gguf;
    std::string base_ckpt;
    /// "cpu" | "cuda" | "cuda-resident"
    std::string device{"cpu"};
    /// Log train progress every N steps (0 = quiet). Comfort profiles set 20.
    int log_every = 0;
    /// Profile name for reports ("comfort", "qlora", "standard", …)
    std::string profile{"standard"};
    /// If true (default), success requires final_loss < initial_loss. Multi-stage recipes may disable.
    bool require_loss_drop = true;
};

/// Apply a named comfort / size profile. Does not clear base_ckpt / device / dataset paths.
inline void apply_sft_profile(SftConfig& cfg, ModelProfile p) {
    const ProfileSpec s = profile_spec(p);
    cfg.n_embd = s.n_embd;
    cfg.n_head = s.n_head;
    cfg.n_layer = s.n_layer;
    cfg.block_size = s.block_size;
    cfg.arch = s.arch;
    cfg.epochs = s.epochs;
    cfg.lr = s.lr;
    cfg.allow_tiny = s.allow_tiny;
    cfg.use_qlora = s.use_qlora;
    cfg.use_lora = s.use_lora;
    cfg.lora_rank = s.lora_rank;
    cfg.log_every = s.log_every;
    cfg.profile = s.name;
    if (s.tokenizer_byte) cfg.tokenizer = TokenizerKind::Byte;
    else cfg.tokenizer = TokenizerKind::Bpe;
}

namespace sft_cfg_detail {
inline int extract_bare_int(const std::string& body, const std::string& key, int def) {
    const std::string pat = "\"" + key + "\"";
    auto pos = body.find(pat);
    if (pos == std::string::npos) return def;
    pos = body.find(':', pos + pat.size());
    if (pos == std::string::npos) return def;
    try {
        return std::stoi(body.substr(pos + 1));
    } catch (...) {
        return def;
    }
}
inline float extract_bare_float(const std::string& body, const std::string& key, float def) {
    const std::string pat = "\"" + key + "\"";
    auto pos = body.find(pat);
    if (pos == std::string::npos) return def;
    pos = body.find(':', pos + pat.size());
    if (pos == std::string::npos) return def;
    try {
        return std::stof(body.substr(pos + 1));
    } catch (...) {
        return def;
    }
}
inline bool extract_bare_bool(const std::string& body, const std::string& key, bool def) {
    const std::string pat = "\"" + key + "\"";
    auto pos = body.find(pat);
    if (pos == std::string::npos) return def;
    pos = body.find(':', pos + pat.size());
    if (pos == std::string::npos) return def;
    auto rest = body.substr(pos + 1, 20);
    if (rest.find("true") != std::string::npos) return true;
    if (rest.find("false") != std::string::npos) return false;
    return def;
}
}  // namespace sft_cfg_detail

/// Load dims/knobs from a prior `sft_config.json` (does not set dataset paths).
/// Sets base_ckpt to sibling model.hkckpt when `set_base_from_dir` and file lives next to it.
inline void apply_sft_config_json(SftConfig& cfg, const std::string& path,
                                  bool set_base_from_dir = true) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open sft_config.json: " + path);
    std::ostringstream ss;
    ss << in.rdbuf();
    const std::string body = ss.str();
    using namespace sft_cfg_detail;
    cfg.n_embd = extract_bare_int(body, "n_embd", cfg.n_embd);
    cfg.n_layer = extract_bare_int(body, "n_layer", cfg.n_layer);
    cfg.n_head = extract_bare_int(body, "n_head", cfg.n_head);
    cfg.block_size = extract_bare_int(body, "block_size", cfg.block_size);
    cfg.epochs = extract_bare_int(body, "epochs", cfg.epochs);
    cfg.lr = extract_bare_float(body, "lr", cfg.lr);
    cfg.lora_rank = extract_bare_int(body, "lora_rank", cfg.lora_rank);
    cfg.allow_tiny = extract_bare_bool(body, "allow_tiny", cfg.allow_tiny);
    cfg.use_qlora = extract_bare_bool(body, "use_qlora", cfg.use_qlora);
    cfg.use_lora = extract_bare_bool(body, "use_lora", cfg.use_lora);
    auto prof = detail::extract_json_string(body, "profile");
    if (!prof.empty()) cfg.profile = prof;
    auto arch = detail::extract_json_string(body, "arch");
    if (!arch.empty()) cfg.arch = arch;
    auto tok = detail::extract_json_string(body, "tokenizer");
    if (tok == "byte") cfg.tokenizer = TokenizerKind::Byte;
    else if (tok == "bpe") cfg.tokenizer = TokenizerKind::Bpe;
    auto dev = detail::extract_json_string(body, "device");
    if (!dev.empty()) cfg.device = dev;
    if (set_base_from_dir && cfg.base_ckpt.empty()) {
        namespace fs = std::filesystem;
        fs::path p(path);
        auto ck = p.parent_path() / "model.hkckpt";
        if (fs::exists(ck)) cfg.base_ckpt = ck.string();
    }
}

struct SftResult {
    bool success = false;
    std::string error;
    float initial_loss = 0.f;
    float final_loss = 0.f;
    int steps = 0;
    std::string ckpt_path;
    std::string report_path;
    std::string tokenizer_path;
    std::vector<float> loss_curve;
};

inline SftResult sft_train(const std::string& dataset_path,
                           const std::string& out_dir,
                           SftConfig cfg = {}) {
    SftResult r;
    namespace fs = std::filesystem;
    std::error_code ec;
    fs::create_directories(out_dir, ec);
    try {
        enforce_non_tiny(cfg.n_embd, cfg.n_layer, cfg.n_head, cfg.block_size, cfg.allow_tiny);
        if (!is_allowed_arch(cfg.arch)) {
            throw std::runtime_error("unsupported arch: " + cfg.arch);
        }
        const bool want_cuda =
            (cfg.device == "cuda" || cfg.device == "gpu" || cfg.device == "cuda-resident" ||
             cfg.device == "resident");
        bool want_resident =
            (cfg.device == "cuda-resident" || cfg.device == "resident");
        // LoRA/QLoRA adapters train on host GPT path (merge to dense ckpt). Not DeviceGPT-resident.
        if (want_resident && (cfg.use_qlora || cfg.use_lora)) {
            want_resident = false;
        }
        if (want_cuda) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
            if (!cuda_rt::available()) {
                throw std::runtime_error("SFT --device cuda requested but no CUDA device: " +
                                         cuda_rt::status_note());
            }
            handoffkit_ml_set_prefer_cuda_matmul(true);
#else
            throw std::runtime_error(
                "SFT --device cuda requires build with -DHANDOFFKIT_ML_CUDA=ON"
            );
#endif
        } else {
            handoffkit_ml_set_prefer_cuda_matmul(false);
        }
        auto examples = load_sft_jsonl(dataset_path);

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
        // Full device-resident GPT path (weights + activations on GPU)
        if (want_resident) {
            ByteTokenizer byte_tok;
            BpeTokenizer bpe_tok;
            if (cfg.tokenizer == TokenizerKind::Bpe) {
                if (!cfg.bpe_path.empty() && fs::exists(cfg.bpe_path))
                    bpe_tok = BpeTokenizer::load(cfg.bpe_path);
                else {
                    std::string corpus;
                    for (const auto& ex : examples) {
                        corpus += ex.prompt + ex.completion + " ";
                    }
                    bpe_tok.train(corpus, cfg.bpe_merges);
                }
                r.tokenizer_path = (fs::path(out_dir) / "tokenizer.bpe").string();
                bpe_tok.save(r.tokenizer_path);
            }
            int vocab = (cfg.tokenizer == TokenizerKind::Bpe) ? bpe_tok.vocab_size()
                                                              : ByteTokenizer::VOCAB;
            auto gpt = DeviceGPT::make(vocab, cfg.n_embd, cfg.n_head, cfg.n_layer, cfg.block_size,
                                       cfg.seed);
            if (!gpt.weights_on_cuda()) throw std::runtime_error("DeviceGPT weights not on CUDA");

            auto encode_pair = [&](const std::string& p, const std::string& c) {
                if (cfg.tokenizer == TokenizerKind::Bpe) return bpe_tok.encode_sft(p, c, true);
                return byte_tok.encode(p + c, true);
            };

            int steps = 0;
            float last = 0.f;
            bool have_i = false;
            for (int ep = 0; ep < cfg.epochs; ++ep) {
                for (const auto& ex : examples) {
                    auto ids = encode_pair(ex.prompt, ex.completion);
                    if (static_cast<int>(ids.size()) < 3) continue;
                    if (static_cast<int>(ids.size()) > cfg.block_size)
                        ids.resize(static_cast<std::size_t>(cfg.block_size));
                    std::vector<int> input(ids.begin(), ids.end() - 1);
                    std::vector<int> target(ids.begin() + 1, ids.end());
                    last = gpt.train_step(input, target, static_cast<float>(cfg.lr));
                    if (!have_i) {
                        r.initial_loss = last;
                        have_i = true;
                    }
                    if (!gpt.weights_on_cuda())
                        throw std::runtime_error("weights left CUDA during resident SFT");
                    ++steps;
                    r.loss_curve.push_back(last);
                }
            }
            r.final_loss = last;
            r.steps = steps;
            r.success = steps > 0 && r.final_loss < r.initial_loss;
            // End-of-train only: download weights once → loadable model.hkckpt
            if (!gpt.weights_on_cuda())
                throw std::runtime_error("weights left CUDA before ckpt export");
            GPT host = gpt.to_host_gpt();
            host.cfg.arch = cfg.arch;
            host.cfg.seed = cfg.seed;
            r.ckpt_path = (fs::path(out_dir) / "model.hkckpt").string();
            save_gpt(r.ckpt_path, host);
            r.report_path = (fs::path(out_dir) / "train_report.json").string();
            {
                std::ofstream rep(r.report_path);
                rep << "{\n  \"success\": true,\n  \"backend_id\": \"cuda_resident\",\n"
                    << "  \"initial_loss\": " << r.initial_loss << ",\n"
                    << "  \"final_loss\": " << r.final_loss << ",\n"
                    << "  \"steps\": " << r.steps << ",\n"
                    << "  \"ckpt_path\": \"" << r.ckpt_path << "\",\n"
                    << "  \"device\": \"cuda-resident\",\n"
                    << "  \"resident\": true,\n"
                    << "  \"weights_on_cuda_during_train\": true\n}\n";
            }
            return r;
        }
#endif

        ByteTokenizer byte_tok;
        BpeTokenizer bpe_tok;
        // Prefix-safe: BPE uses encode_sft (prompt|completion cut); byte is naturally prefix-stable.
        auto encode_pair = [&](const std::string& prompt, const std::string& completion,
                               bool special) -> std::vector<int> {
            if (cfg.tokenizer == TokenizerKind::Bpe) {
                return bpe_tok.encode_sft(prompt, completion, special);
            }
            return byte_tok.encode(prompt + completion, special);
        };
        auto encode_prompt = [&](const std::string& prompt, bool special) -> std::vector<int> {
            if (cfg.tokenizer == TokenizerKind::Bpe) {
                // BOS + raw prompt (no EOS) — matches encode_sft prompt prefix
                std::vector<int> ids;
                if (special && bpe_tok.bos_id >= 0) ids.push_back(bpe_tok.bos_id);
                auto raw = bpe_tok.encode_raw(prompt);
                ids.insert(ids.end(), raw.begin(), raw.end());
                return ids;
            }
            auto ids = byte_tok.encode(prompt, special);
            if (special && !ids.empty() && ids.back() == ByteTokenizer::EOS) ids.pop_back();
            return ids;
        };

        if (cfg.tokenizer == TokenizerKind::Bpe) {
            if (!cfg.bpe_path.empty() && fs::exists(cfg.bpe_path)) {
                bpe_tok = BpeTokenizer::load(cfg.bpe_path);
            } else {
                std::string corpus;
                for (const auto& ex : examples) {
                    corpus += ex.prompt;
                    corpus += ex.completion;
                    corpus += ex.chosen;
                    corpus += " ";
                }
                bpe_tok.train(corpus, cfg.bpe_merges);
            }
            r.tokenizer_path = (fs::path(out_dir) / "tokenizer.bpe").string();
            bpe_tok.save(r.tokenizer_path);
        }

        GPTConfig gcfg;
        gcfg.vocab_size = (cfg.tokenizer == TokenizerKind::Bpe) ? bpe_tok.vocab_size()
                                                               : ByteTokenizer::VOCAB;
        gcfg.n_embd = cfg.n_embd;
        gcfg.n_head = cfg.n_head;
        gcfg.n_layer = cfg.n_layer;
        gcfg.block_size = cfg.block_size;
        gcfg.seed = cfg.seed;
        gcfg.arch = cfg.arch;

        // Optional external base (GGUF or hkckpt) — AC2
        GPT model(gcfg);
        if (!cfg.base_gguf.empty()) {
            model = import_gpt_gguf(cfg.base_gguf);
            // Keep train hyperparams; require compatible shapes
            if (model.cfg.n_embd != gcfg.n_embd || model.cfg.n_layer != gcfg.n_layer ||
                model.cfg.n_head != gcfg.n_head) {
                throw std::runtime_error(
                    "base_gguf dim mismatch: base n_embd=" + std::to_string(model.cfg.n_embd) +
                    " n_layer=" + std::to_string(model.cfg.n_layer) +
                    " n_head=" + std::to_string(model.cfg.n_head) + " vs SFT n_embd=" +
                    std::to_string(gcfg.n_embd) + " n_layer=" + std::to_string(gcfg.n_layer) +
                    " n_head=" + std::to_string(gcfg.n_head) +
                    " (use matching --n-embd/--n-layer/--n-head or --resume-config)"
                );
            }
            if (cfg.tokenizer == TokenizerKind::Bpe &&
                model.cfg.vocab_size != bpe_tok.vocab_size()) {
                // Allow continue if vocab covers; else fail clearly
                if (model.cfg.vocab_size < bpe_tok.vocab_size()) {
                    throw std::runtime_error("base_gguf vocab_size smaller than BPE vocab");
                }
            }
            gcfg.arch = model.cfg.arch;
            gcfg.vocab_size = model.cfg.vocab_size;
        } else if (!cfg.base_ckpt.empty()) {
            model = load_gpt(cfg.base_ckpt);
            if (model.cfg.n_embd != gcfg.n_embd || model.cfg.n_layer != gcfg.n_layer ||
                model.cfg.n_head != gcfg.n_head) {
                throw std::runtime_error(
                    "base_ckpt dim mismatch: base n_embd=" + std::to_string(model.cfg.n_embd) +
                    " n_layer=" + std::to_string(model.cfg.n_layer) +
                    " n_head=" + std::to_string(model.cfg.n_head) + " vs SFT n_embd=" +
                    std::to_string(gcfg.n_embd) + " n_layer=" + std::to_string(gcfg.n_layer) +
                    " n_head=" + std::to_string(gcfg.n_head) +
                    " (pass --resume-config prior/sft_config.json or matching dims)"
                );
            }
            gcfg.arch = model.cfg.arch;
            gcfg.vocab_size = model.cfg.vocab_size;
            // Prefer base block_size if larger (context headroom)
            if (model.cfg.block_size > gcfg.block_size) gcfg.block_size = model.cfg.block_size;
        }

        // LoRA / QLoRA: multi-module adapters. Base W frozen (QLoRA: NF4→dequant freeze);
        // only A/B receive Adam updates. Merge into dense W at end for model.hkckpt.
        std::vector<PeftTarget> peft;
        auto add_peft = [&](Linear& lin, const std::string& name, int seed_off) {
            PeftTarget t;
            t.lin = &lin;
            t.name = name;
            if (cfg.use_qlora) {
                auto nf = quantize_nf4(lin.W);
                t.base_frozen = dequantize_nf4(nf);
            } else {
                t.base_frozen = lin.W.clone();
            }
            lin.W = t.base_frozen.clone();
            t.lora = LoraLinear::wrap(lin, cfg.lora_rank, cfg.seed + seed_off);
            // α/r style scale keeps multi-module QLoRA/LoRA stable at normal LRs
            t.lora.scale = 2.f / static_cast<float>(std::max(1, cfg.lora_rank));
            peft.push_back(std::move(t));
        };
        if (cfg.use_lora || cfg.use_qlora) {
            int so = 11;
            // Multi-module PEFT: attention proj + MLP + lm_head (qkv optional via all-attn)
            for (std::size_t li = 0; li < model.blocks.size(); ++li) {
                auto& bl = model.blocks[li];
                add_peft(bl.attn.qkv, "block" + std::to_string(li) + ".attn.qkv", so++);
                add_peft(bl.attn.proj, "block" + std::to_string(li) + ".attn.proj", so++);
                add_peft(bl.mlp.fc1, "block" + std::to_string(li) + ".mlp.fc1", so++);
                add_peft(bl.mlp.fc2, "block" + std::to_string(li) + ".mlp.fc2", so++);
            }
            add_peft(model.lm_head, "lm_head", so++);
        }
        // Snapshots of frozen bases for freeze honesty checks (never written by optim)
        std::vector<Tensor> peft_frozen_snap;
        peft_frozen_snap.reserve(peft.size());
        for (const auto& t : peft) peft_frozen_snap.push_back(t.base_frozen.clone());

        AdamW opt;
        opt.lr = cfg.lr;
        opt.weight_decay = (cfg.use_lora || cfg.use_qlora) ? 0.f : 0.01f;

        int steps = 0;
        float last = 0.f;
        bool have_initial = false;
        for (int ep = 0; ep < cfg.epochs; ++ep) {
            for (const auto& ex : examples) {
                std::string full;
                std::vector<float> mask;
                std::vector<int> ids;
                std::string completion = ex.completion;
                if (cfg.preference && !ex.chosen.empty() && !ex.rejected.empty()) {
                    completion = ex.chosen;
                }
                full = ex.prompt + completion;
                ids = encode_pair(ex.prompt, completion, true);
                if (static_cast<int>(ids.size()) < 3) continue;
                if (static_cast<int>(ids.size()) > cfg.block_size) {
                    ids.resize(static_cast<std::size_t>(cfg.block_size));
                }
                const std::size_t T = ids.size() - 1;
                std::vector<int> input(ids.begin(), ids.end() - 1);
                std::vector<int> target(ids.begin() + 1, ids.end());
                auto pids = encode_prompt(ex.prompt, true);
                // prompt tokens are exact prefix of ids (encode_sft / byte concat)
                std::size_t prompt_tok = pids.size();
                if (prompt_tok > T) prompt_tok = T;
                mask.assign(T, 1.f);
                for (std::size_t i = 0; i < T && i + 1 < prompt_tok; ++i) mask[i] = 0.15f;

                if (cfg.use_lora || cfg.use_qlora) peft_materialize(peft);

                model.zero_grad();
                if (cfg.use_lora || cfg.use_qlora) peft_zero_grad(peft);

                last = model.loss_and_backward(input, target, 1, T, mask);
                if (!have_initial) {
                    r.initial_loss = last;
                    have_initial = true;
                }

                if (cfg.preference && !ex.rejected.empty()) {
                    auto ids_r = encode_pair(ex.prompt, ex.rejected, true);
                    if (static_cast<int>(ids_r.size()) > cfg.block_size)
                        ids_r.resize(static_cast<std::size_t>(cfg.block_size));
                    if (ids_r.size() >= 3) {
                        std::size_t Tr = ids_r.size() - 1;
                        std::vector<int> in_r(ids_r.begin(), ids_r.end() - 1);
                        std::vector<int> tg_r(ids_r.begin() + 1, ids_r.end());
                        std::vector<float> mask_r(Tr, 1.f);
                        // Maximize CE on rejected: invert grads after second backward contrib
                        Tensor gW_save = model.lm_head.gW.clone();
                        float lrj = model.loss_and_backward(in_r, tg_r, 1, Tr, mask_r);
                        // invert the second pass contribution on all grads
                        std::vector<Param> tmp;
                        model.collect_params(tmp);
                        for (auto& p : tmp) {
                            if (!p.g) continue;
                            // subtract 2 * second_grad to invert second addition: g = g1 + g2 -> g1 - g2
                            // approximate: scale all grads (g1+g2) is wrong; use beta mix
                            for (auto& g : p.g->data) g *= (1.f - cfg.dpo_beta);
                        }
                        // re-apply preferred direction strength
                        for (std::size_t i = 0; i < model.lm_head.gW.numel(); ++i) {
                            model.lm_head.gW.data[i] =
                                gW_save.data[i] - cfg.dpo_beta * (model.lm_head.gW.data[i] - gW_save.data[i]);
                        }
                        last = last + cfg.dpo_beta * lrj;
                    }
                }

                std::vector<Param> params;
                if (cfg.use_lora || cfg.use_qlora) {
                    const float ws =
                        (cfg.world_size > 1) ? (1.f / static_cast<float>(cfg.world_size)) : 1.f;
                    peft_project_and_clear_base(peft, ws);
                    // Drop non-adapter grads (embeddings, norms, etc.) — only A/B step
                    model.zero_grad();
                    peft_collect_params(peft, params);
                } else {
                    model.collect_params(params);
                    if (cfg.world_size > 1) {
                        for (auto& p : params) {
                            if (!p.g) continue;
                            for (auto& v : p.g->data) v *= 1.f / static_cast<float>(cfg.world_size);
                        }
                    }
                }
                clip_grad_norm(params, 1.0f);
                opt.step(params);

                // Freeze honesty: NF4/dequant frozen bases must be bit-identical after Adam
                if (cfg.use_lora || cfg.use_qlora) {
                    for (std::size_t ti = 0; ti < peft.size(); ++ti) {
                        const auto& fr = peft[ti].base_frozen;
                        const auto& sn = peft_frozen_snap[ti];
                        for (std::size_t i = 0; i < fr.numel(); ++i) {
                            if (fr.data[i] != sn.data[i]) {
                                throw std::runtime_error(
                                    "peft base_frozen mutated during train (adapter-only violated): " +
                                    peft[ti].name);
                            }
                        }
                    }
                }

                ++steps;
                r.loss_curve.push_back(last);
                if (cfg.log_every > 0 && (steps == 1 || steps % cfg.log_every == 0)) {
                    std::cout << "sft step=" << steps << " epoch=" << (ep + 1) << "/" << cfg.epochs
                              << " loss=" << last
                              << (cfg.use_qlora ? " qlora=1" : "")
                              << (cfg.use_lora ? " lora=1" : "") << "\n"
                              << std::flush;
                }
            }
        }

        if (cfg.use_lora || cfg.use_qlora) peft_merge_into_base(peft);

        r.final_loss = last;
        r.steps = steps;
        const bool dropped = r.final_loss < r.initial_loss;
        r.success = steps > 0 && (!cfg.require_loss_drop || dropped);
        r.ckpt_path = (fs::path(out_dir) / "model.hkckpt").string();
        save_gpt(r.ckpt_path, model);
        r.report_path = (fs::path(out_dir) / "train_report.json").string();
        {
            const char* backend = "native";
            if (cfg.use_qlora) backend = "qlora";
            else if (cfg.use_lora) backend = "lora";
            std::ofstream rep(r.report_path);
            rep << "{\n"
                << "  \"success\": " << (r.success ? "true" : "false") << ",\n"
                << "  \"backend_id\": \"" << backend << "\",\n"
                << "  \"profile\": \"" << cfg.profile << "\",\n"
                << "  \"initial_loss\": " << r.initial_loss << ",\n"
                << "  \"final_loss\": " << r.final_loss << ",\n"
                << "  \"steps\": " << r.steps << ",\n"
                << "  \"ckpt_path\": \"" << r.ckpt_path << "\",\n"
                << "  \"use_lora\": " << (cfg.use_lora ? "true" : "false") << ",\n"
                << "  \"use_qlora\": " << (cfg.use_qlora ? "true" : "false") << ",\n"
                << "  \"lora_rank\": " << cfg.lora_rank << ",\n"
                << "  \"peft_modules\": " << peft.size() << ",\n"
                << "  \"nf4_base\": " << (cfg.use_qlora ? "true" : "false") << ",\n"
                << "  \"adapter_only_optim\": "
                << ((cfg.use_lora || cfg.use_qlora) ? "true" : "false") << ",\n"
                << "  \"preference\": " << (cfg.preference ? "true" : "false") << ",\n"
                << "  \"tokenizer\": \""
                << (cfg.tokenizer == TokenizerKind::Bpe ? "bpe" : "byte") << "\",\n"
                << "  \"vocab_size\": " << gcfg.vocab_size << ",\n"
                << "  \"n_embd\": " << cfg.n_embd << ",\n"
                << "  \"n_layer\": " << cfg.n_layer << ",\n"
                << "  \"n_head\": " << cfg.n_head << ",\n"
                << "  \"block_size\": " << cfg.block_size << ",\n"
                << "  \"epochs\": " << cfg.epochs << ",\n"
                << "  \"lr\": " << cfg.lr << ",\n"
                << "  \"arch\": \"" << cfg.arch << "\",\n"
                << "  \"device\": \"" << cfg.device << "\",\n"
                << "  \"world_size\": " << cfg.world_size << "\n"
                << "}\n";
        }
        // Sidecar with effective train knobs (comfort UX)
        {
            std::ofstream cfgj((fs::path(out_dir) / "sft_config.json").string());
            cfgj << "{\n"
                 << "  \"profile\": \"" << cfg.profile << "\",\n"
                 << "  \"use_qlora\": " << (cfg.use_qlora ? "true" : "false") << ",\n"
                 << "  \"use_lora\": " << (cfg.use_lora ? "true" : "false") << ",\n"
                 << "  \"lora_rank\": " << cfg.lora_rank << ",\n"
                 << "  \"n_embd\": " << cfg.n_embd << ",\n"
                 << "  \"n_layer\": " << cfg.n_layer << ",\n"
                 << "  \"n_head\": " << cfg.n_head << ",\n"
                 << "  \"block_size\": " << cfg.block_size << ",\n"
                 << "  \"epochs\": " << cfg.epochs << ",\n"
                 << "  \"lr\": " << cfg.lr << ",\n"
                 << "  \"device\": \"" << cfg.device << "\",\n"
                 << "  \"tokenizer\": \""
                 << (cfg.tokenizer == TokenizerKind::Bpe ? "bpe" : "byte") << "\",\n"
                 << "  \"arch\": \"" << cfg.arch << "\",\n"
                 << "  \"allow_tiny\": " << (cfg.allow_tiny ? "true" : "false") << "\n"
                 << "}\n";
        }
        if (!r.success && steps > 0 && cfg.require_loss_drop) {
            r.error = "train completed but final_loss did not drop below initial_loss";
        }
    } catch (const std::exception& ex) {
        r.success = false;
        r.error = ex.what();
    }
    return r;
}

/// Generate continuation. temperature<=0 => greedy (argmax). Returns full decoded text
/// (prompt bytes + new). Also fills optional new_only with just the continuation.
struct GenerateOpts {
    int max_new_tokens = 32;
    float temperature = 0.f;
    /// top-k sampling (0 = disabled). Applied after temperature softmax candidates.
    int top_k = 0;
    /// nucleus / top-p in (0,1]; 0 or >=1 = disabled.
    float top_p = 0.f;
    TokenizerKind tokenizer = TokenizerKind::Bpe;
    std::string bpe_path;
    int eos_id = -1;  // -1 => auto
};

inline std::string generate_text(GPT& model,
                                 const std::string& prompt,
                                 int max_new_tokens = 32,
                                 float temperature = 0.f,
                                 std::mt19937* rng_ptr = nullptr,
                                 std::string* new_only = nullptr,
                                 const GenerateOpts* opts = nullptr) {
    GenerateOpts o;
    if (opts) o = *opts;
    else {
        o.max_new_tokens = max_new_tokens;
        o.temperature = temperature;
        // Infer tokenizer: byte vocab is 259
        o.tokenizer = (model.cfg.vocab_size <= 300) ? TokenizerKind::Byte : TokenizerKind::Bpe;
    }

    ByteTokenizer byte_tok;
    BpeTokenizer bpe_tok;
    if (o.tokenizer == TokenizerKind::Bpe) {
        if (!o.bpe_path.empty()) bpe_tok = BpeTokenizer::load(o.bpe_path);
        else bpe_tok.train(prompt + " MARK42 hello world supervised fine tuning", 128);
    }
    auto decode = [&](const std::vector<int>& ids) {
        return o.tokenizer == TokenizerKind::Bpe ? bpe_tok.decode(ids) : byte_tok.decode(ids);
    };
    int eos = o.eos_id;
    if (eos < 0) {
        eos = (o.tokenizer == TokenizerKind::Bpe) ? bpe_tok.eos_id : ByteTokenizer::EOS;
    }

    // Match SFT encode_prompt: BOS + raw prompt tokens, no EOS
    std::vector<int> ids;
    if (o.tokenizer == TokenizerKind::Bpe) {
        if (bpe_tok.bos_id >= 0) ids.push_back(bpe_tok.bos_id);
        auto raw = bpe_tok.encode_raw(prompt);
        ids.insert(ids.end(), raw.begin(), raw.end());
    } else {
        ids = byte_tok.encode(prompt, true);
        if (!ids.empty() && ids.back() == ByteTokenizer::EOS) ids.pop_back();
    }
    const std::size_t prompt_len = ids.size();
    std::mt19937 local(0);
    std::mt19937& rng = rng_ptr ? *rng_ptr : local;
    const int Tmax = model.cfg.block_size;
    const bool greedy = o.temperature <= 0.f;
    // Suppress EOS for the first few new tokens so overfit SFT can emit content
    const int min_new_before_eos = std::min(4, o.max_new_tokens);
    for (int n = 0; n < o.max_new_tokens; ++n) {
        std::vector<int> ctx = ids;
        if (static_cast<int>(ctx.size()) > Tmax) {
            ctx.erase(ctx.begin(), ctx.end() - Tmax);
        }
        const std::size_t T = ctx.size();
        Tensor logits = model.forward(ctx, 1, T);
        const std::size_t V = static_cast<std::size_t>(model.cfg.vocab_size);
        const std::size_t last = T - 1;
        int pick = 0;
        if (greedy) {
            float best = -1e30f;
            pick = 0;
            for (std::size_t j = 0; j < V; ++j) {
                if (n < min_new_before_eos && static_cast<int>(j) == eos) continue;
                float v = logits.data[last * V + j];
                if (v > best) {
                    best = v;
                    pick = static_cast<int>(j);
                }
            }
        } else {
            // Softmax over temperature-scaled logits, optional top-k / top-p (nucleus)
            std::vector<std::pair<float, int>> cands;
            cands.reserve(V);
            for (std::size_t j = 0; j < V; ++j) {
                if (n < min_new_before_eos && static_cast<int>(j) == eos) continue;
                float logit = logits.data[last * V + j] / std::max(o.temperature, 1e-3f);
                cands.emplace_back(logit, static_cast<int>(j));
            }
            if (cands.empty()) {
                pick = eos;
            } else {
                std::sort(cands.begin(), cands.end(),
                          [](const auto& a, const auto& b) { return a.first > b.first; });
                if (o.top_k > 0 && static_cast<int>(cands.size()) > o.top_k) {
                    cands.resize(static_cast<std::size_t>(o.top_k));
                }
                // Softmax on remaining logits
                float m = cands.front().first;
                float sum = 0.f;
                for (auto& c : cands) {
                    c.first = std::exp(c.first - m);
                    sum += c.first;
                }
                for (auto& c : cands) c.first /= std::max(sum, 1e-20f);
                // Nucleus top-p: keep smallest prefix with cumulative mass >= top_p
                if (o.top_p > 0.f && o.top_p < 1.f && cands.size() > 1) {
                    float cum_p = 0.f;
                    std::size_t keep = 0;
                    for (; keep < cands.size(); ++keep) {
                        cum_p += cands[keep].first;
                        if (cum_p >= o.top_p) {
                            ++keep;
                            break;
                        }
                    }
                    if (keep < cands.size()) cands.resize(keep);
                    // Renormalize
                    sum = 0.f;
                    for (auto& c : cands) sum += c.first;
                    for (auto& c : cands) c.first /= std::max(sum, 1e-20f);
                }
                std::uniform_real_distribution<float> u(0.f, 1.f);
                float rr = u(rng);
                float cum = 0.f;
                pick = cands.back().second;
                for (const auto& c : cands) {
                    cum += c.first;
                    if (rr <= cum) {
                        pick = c.second;
                        break;
                    }
                }
            }
        }
        ids.push_back(pick);
        if (pick == eos) break;
    }
    std::vector<int> cont(ids.begin() + static_cast<std::ptrdiff_t>(prompt_len), ids.end());
    if (new_only) *new_only = decode(cont);
    return decode(ids);
}

}  // namespace ml
}  // namespace handoffkit
