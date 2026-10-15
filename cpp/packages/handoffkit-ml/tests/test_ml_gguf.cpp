#include <handoffkit/ml/gguf.hpp>
#include <handoffkit/ml/model_profile.hpp>

#include <cassert>
#include <cmath>
#include <filesystem>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;

    assert(is_allowed_arch("gpt2"));
    assert(is_allowed_arch("llama-like"));
    assert(is_allowed_arch("gpt-mini"));
    assert(!is_allowed_arch("bert"));

    const auto dir = fs::current_path() / "test_artifacts_gguf";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);

    GPTConfig cfg;
    cfg.arch = "llama-like";
    cfg.n_embd = 64;
    cfg.n_head = 4;
    cfg.n_layer = 2;
    cfg.block_size = 32;
    cfg.vocab_size = 400;
    cfg.seed = 9;
    GPT model(cfg);

    // forward smoke before export
    std::vector<int> ids = {1, 2, 3, 4, 5};
    auto logits = model.forward(ids, 1, ids.size());
    assert(logits.numel() == ids.size() * static_cast<std::size_t>(cfg.vocab_size));

    auto path = (dir / "model.gguf").string();
    export_gpt_gguf(path, model);
    assert(fs::exists(path));
    assert(fs::file_size(path) > 1000);

    GPT loaded = import_gpt_gguf(path);
    assert(loaded.cfg.arch == "llama-like");
    assert(loaded.cfg.n_embd == 64);
    assert(loaded.cfg.n_layer == 2);
    float err = 0.f;
    for (std::size_t i = 0; i < model.wte.numel(); ++i) {
        err = std::max(err, std::fabs(model.wte.data[i] - loaded.wte.data[i]));
    }
    std::cout << "gguf wte max_err=" << err << " size=" << fs::file_size(path) << "\n";
    assert(err < 1e-5f);

    auto logits2 = loaded.forward(ids, 1, ids.size());
    float lerr = 0.f;
    for (std::size_t i = 0; i < logits.numel(); ++i) {
        lerr = std::max(lerr, std::fabs(logits.data[i] - logits2.data[i]));
    }
    std::cout << "gguf forward max_err=" << lerr << "\n";
    assert(lerr < 1e-4f);

    // gpt2 allowlist
    cfg.arch = "gpt2";
    GPT g2(cfg);
    export_gpt_gguf((dir / "gpt2.gguf").string(), g2);
    auto g2b = import_gpt_gguf((dir / "gpt2.gguf").string());
    assert(g2b.cfg.arch == "gpt2");

    std::cout << "test_ml_gguf ok\n";
    return 0;
}
