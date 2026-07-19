#pragma once

/// Held-out evaluation for native GPT students (CE mean / perplexity).

#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/sft.hpp>
#include <handoffkit/ml/token.hpp>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

struct EvalConfig {
    int block_size = 128;
    TokenizerKind tokenizer = TokenizerKind::Byte;
    std::string bpe_path;
    bool allow_empty = false;
    /// If non-empty, write eval_report.json (or this path) after success.
    std::string report_path;
    /// If set and report_path empty, write report_path = out_dir/eval_report.json
    std::string out_dir;
};

struct EvalResult {
    bool success = false;
    std::string error;
    float mean_loss = 0.f;
    float perplexity = 0.f;
    int examples = 0;
    int tokens = 0;
    std::string ckpt_path;
    std::string dataset_path;
    std::string report_path;
};

inline void write_eval_report(const EvalResult& r, const std::string& path) {
    namespace fs = std::filesystem;
    fs::path p(path);
    if (p.has_parent_path()) {
        std::error_code ec;
        fs::create_directories(p.parent_path(), ec);
    }
    std::ofstream o(path);
    if (!o) throw std::runtime_error("cannot write eval report: " + path);
    o << "{\n"
      << "  \"success\": " << (r.success ? "true" : "false") << ",\n"
      << "  \"mean_loss\": " << r.mean_loss << ",\n"
      << "  \"perplexity\": " << r.perplexity << ",\n"
      << "  \"examples\": " << r.examples << ",\n"
      << "  \"tokens\": " << r.tokens << ",\n"
      << "  \"ckpt_path\": \"" << r.ckpt_path << "\",\n"
      << "  \"dataset_path\": \"" << r.dataset_path << "\"\n"
      << "}\n";
}

/// Mean token CE on prompt+completion sequences (same encode path spirit as SFT).
inline EvalResult eval_ckpt_on_jsonl(const std::string& ckpt_path, const std::string& dataset_path,
                                     EvalConfig cfg = {}) {
    EvalResult r;
    r.ckpt_path = ckpt_path;
    r.dataset_path = dataset_path;
    try {
        GPT model = load_gpt(ckpt_path);
        auto examples = load_sft_jsonl(dataset_path);
        ByteTokenizer byte_tok;
        BpeTokenizer bpe_tok;
        if (cfg.tokenizer == TokenizerKind::Bpe) {
            if (!cfg.bpe_path.empty()) bpe_tok = BpeTokenizer::load(cfg.bpe_path);
            else {
                std::string corpus;
                for (const auto& ex : examples) corpus += ex.prompt + ex.completion + " ";
                bpe_tok.train(corpus, 256);
            }
        }
        auto encode_pair = [&](const std::string& p, const std::string& c) {
            if (cfg.tokenizer == TokenizerKind::Bpe) return bpe_tok.encode_sft(p, c, true);
            return byte_tok.encode(p + c, true);
        };

        double loss_sum = 0.0;
        int tok_n = 0;
        int n_ex = 0;
        for (const auto& ex : examples) {
            auto ids = encode_pair(ex.prompt, ex.completion);
            if (static_cast<int>(ids.size()) < 3) continue;
            if (static_cast<int>(ids.size()) > cfg.block_size)
                ids.resize(static_cast<std::size_t>(cfg.block_size));
            const std::size_t T = ids.size() - 1;
            std::vector<int> input(ids.begin(), ids.end() - 1);
            std::vector<int> target(ids.begin() + 1, ids.end());
            std::vector<float> mask(T, 1.f);
            // Forward-only CE using loss_and_backward then zero (no optim) — use pure forward path
            Tensor logits = model.forward(input, 1, T);
            auto logp = log_softmax_rows(logits);
            const std::size_t V = static_cast<std::size_t>(model.cfg.vocab_size);
            for (std::size_t i = 0; i < T; ++i) {
                int t = target[i];
                if (t < 0 || t >= model.cfg.vocab_size) continue;
                float lp = logp.data[i * V + static_cast<std::size_t>(t)];
                loss_sum += static_cast<double>(-lp);
                ++tok_n;
            }
            ++n_ex;
        }
        if (n_ex == 0 || tok_n == 0) {
            if (cfg.allow_empty) {
                r.success = true;
                return r;
            }
            throw std::runtime_error("eval: no usable examples/tokens");
        }
        r.examples = n_ex;
        r.tokens = tok_n;
        r.mean_loss = static_cast<float>(loss_sum / static_cast<double>(tok_n));
        r.perplexity = std::exp(r.mean_loss);
        r.success = true;
        std::string rep = cfg.report_path;
        if (rep.empty() && !cfg.out_dir.empty()) {
            namespace fs = std::filesystem;
            rep = (fs::path(cfg.out_dir) / "eval_report.json").string();
        }
        if (!rep.empty()) {
            write_eval_report(r, rep);
            r.report_path = rep;
        }
    } catch (const std::exception& ex) {
        r.success = false;
        r.error = ex.what();
    }
    return r;
}

}  // namespace ml
}  // namespace handoffkit
