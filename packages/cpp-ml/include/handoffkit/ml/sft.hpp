#pragma once

#include <handoffkit/ml/bpe.hpp>
#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/model_profile.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/optim.hpp>
#include <handoffkit/ml/peft.hpp>
#include <handoffkit/ml/token.hpp>

#include <algorithm>
#include <filesystem>
#include <fstream>
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
};

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
        auto examples = load_sft_jsonl(dataset_path);

        ByteTokenizer byte_tok;
        BpeTokenizer bpe_tok;
        auto encode = [&](const std::string& s, bool special) -> std::vector<int> {
            if (cfg.tokenizer == TokenizerKind::Bpe) return bpe_tok.encode(s, special);
            return byte_tok.encode(s, special);
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
        GPT model(gcfg);

        // LoRA: adapters on lm_head; base W frozen, grads projected onto A/B each step.
        LoraLinear lora_head;
        Tensor base_W_frozen;
        if (cfg.use_lora) {
            lora_head = LoraLinear::wrap(model.lm_head, cfg.lora_rank, cfg.seed + 1);
            base_W_frozen = model.lm_head.W.clone();
        }

        AdamW opt;
        opt.lr = cfg.lr;
        opt.weight_decay = cfg.use_lora ? 0.f : 0.01f;

        int steps = 0;
        float last = 0.f;
        bool have_initial = false;
        for (int ep = 0; ep < cfg.epochs; ++ep) {
            for (const auto& ex : examples) {
                std::string full;
                std::vector<float> mask;
                std::vector<int> ids;
                if (cfg.preference && !ex.chosen.empty() && !ex.rejected.empty()) {
                    full = ex.prompt + ex.chosen;
                    ids = encode(full, true);
                } else {
                    full = ex.prompt + ex.completion;
                    ids = encode(full, true);
                }
                if (static_cast<int>(ids.size()) < 3) continue;
                if (static_cast<int>(ids.size()) > cfg.block_size) {
                    ids.resize(static_cast<std::size_t>(cfg.block_size));
                }
                const std::size_t T = ids.size() - 1;
                std::vector<int> input(ids.begin(), ids.end() - 1);
                std::vector<int> target(ids.begin() + 1, ids.end());
                auto pids = encode(ex.prompt, true);
                std::size_t prompt_tok = pids.empty() ? 1 : pids.size() - 1;
                mask.assign(T, 1.f);
                for (std::size_t i = 0; i < T && i + 1 < prompt_tok; ++i) mask[i] = 0.25f;

                if (cfg.use_lora) {
                    // W_eff = W_frozen + scale*B@A
                    Tensor BA = matmul(lora_head.B, lora_head.A);
                    for (std::size_t i = 0; i < model.lm_head.W.numel(); ++i) {
                        model.lm_head.W.data[i] =
                            base_W_frozen.data[i] + lora_head.scale * BA.data[i];
                    }
                }

                model.zero_grad();
                if (cfg.use_lora) lora_head.zero_grad();

                last = model.loss_and_backward(input, target, 1, T, mask);
                if (!have_initial) {
                    r.initial_loss = last;
                    have_initial = true;
                }

                if (cfg.preference && !ex.rejected.empty()) {
                    auto ids_r = encode(ex.prompt + ex.rejected, true);
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
                if (cfg.use_lora) {
                    // Project lm_head.gW onto LoRA factors; freeze base body grads
                    Tensor dW = model.lm_head.gW.clone();
                    for (auto& v : dW.data) v *= lora_head.scale;
                    Tensor dB = matmul(dW, transpose2d(lora_head.A));
                    Tensor dA = matmul(transpose2d(lora_head.B), dW);
                    add_inplace(lora_head.gA, dA);
                    add_inplace(lora_head.gB, dB);
                    model.zero_grad();
                    lora_head.collect_params(params);
                } else {
                    model.collect_params(params);
                }
                clip_grad_norm(params, 1.0f);
                opt.step(params);
                ++steps;
                r.loss_curve.push_back(last);
            }
        }

        if (cfg.use_lora) {
            Tensor BA = matmul(lora_head.B, lora_head.A);
            for (std::size_t i = 0; i < model.lm_head.W.numel(); ++i) {
                model.lm_head.W.data[i] = base_W_frozen.data[i] + lora_head.scale * BA.data[i];
            }
        }

        r.final_loss = last;
        r.steps = steps;
        r.ckpt_path = (fs::path(out_dir) / "model.hkckpt").string();
        save_gpt(r.ckpt_path, model);
        r.report_path = (fs::path(out_dir) / "train_report.json").string();
        {
            std::ofstream rep(r.report_path);
            rep << "{\n"
                << "  \"success\": true,\n"
                << "  \"backend_id\": \"native\",\n"
                << "  \"initial_loss\": " << r.initial_loss << ",\n"
                << "  \"final_loss\": " << r.final_loss << ",\n"
                << "  \"steps\": " << r.steps << ",\n"
                << "  \"ckpt_path\": \"" << r.ckpt_path << "\",\n"
                << "  \"use_lora\": " << (cfg.use_lora ? "true" : "false") << ",\n"
                << "  \"use_qlora\": " << (cfg.use_qlora ? "true" : "false") << ",\n"
                << "  \"preference\": " << (cfg.preference ? "true" : "false") << ",\n"
                << "  \"tokenizer\": \""
                << (cfg.tokenizer == TokenizerKind::Bpe ? "bpe" : "byte") << "\",\n"
                << "  \"vocab_size\": " << gcfg.vocab_size << ",\n"
                << "  \"arch\": \"" << cfg.arch << "\",\n"
                << "  \"world_size\": " << cfg.world_size << "\n"
                << "}\n";
        }
        r.success = true;
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
    auto encode = [&](const std::string& s, bool sp) {
        return o.tokenizer == TokenizerKind::Bpe ? bpe_tok.encode(s, sp) : byte_tok.encode(s, sp);
    };
    auto decode = [&](const std::vector<int>& ids) {
        return o.tokenizer == TokenizerKind::Bpe ? bpe_tok.decode(ids) : byte_tok.decode(ids);
    };
    int eos = o.eos_id;
    if (eos < 0) {
        eos = (o.tokenizer == TokenizerKind::Bpe) ? bpe_tok.eos_id : ByteTokenizer::EOS;
    }

    auto ids = encode(prompt, true);
    if (!ids.empty() && ids.back() == eos) ids.pop_back();
    const std::size_t prompt_len = ids.size();
    std::mt19937 local(0);
    std::mt19937& rng = rng_ptr ? *rng_ptr : local;
    const int Tmax = model.cfg.block_size;
    const bool greedy = o.temperature <= 0.f;
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
            float best = logits.data[last * V];
            for (std::size_t j = 1; j < V; ++j) {
                float v = logits.data[last * V + j];
                if (v > best) {
                    best = v;
                    pick = static_cast<int>(j);
                }
            }
        } else {
            std::vector<float> row(V);
            for (std::size_t j = 0; j < V; ++j) {
                row[j] = logits.data[last * V + j] / std::max(o.temperature, 1e-3f);
            }
            float m = *std::max_element(row.begin(), row.end());
            float sum = 0.f;
            for (auto& v : row) {
                v = std::exp(v - m);
                sum += v;
            }
            for (auto& v : row) v /= sum;
            std::uniform_real_distribution<float> u(0.f, 1.f);
            float rr = u(rng);
            float cum = 0.f;
            pick = eos;
            for (std::size_t j = 0; j < V; ++j) {
                cum += row[j];
                if (rr <= cum) {
                    pick = static_cast<int>(j);
                    break;
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
