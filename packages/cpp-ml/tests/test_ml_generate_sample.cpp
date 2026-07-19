// Drives shipped generate_text with top-k / top-p (non-greedy) sampling.

#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cmath>
#include <filesystem>
#include <iostream>
#include <random>
#include <string>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_generate_sample";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "data.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", " MARK42"}, {"P:", " MARK42"}, {"P:", " MARK42"}})) {
        std::cerr << "write failed\n";
        return 1;
    }
    SftConfig cfg;
    apply_sft_profile(cfg, ModelProfile::Comfort);
    cfg.epochs = 40;
    cfg.log_every = 0;
    auto tr = sft_train(ds, (dir / "out").string(), cfg);
    if (!tr.success) {
        std::cerr << "sft failed: " << tr.error << "\n";
        return 1;
    }
    auto model = load_gpt(tr.ckpt_path);

    GenerateOpts go;
    go.max_new_tokens = 12;
    go.temperature = 0.9f;
    go.top_k = 20;
    go.top_p = 0.9f;
    go.tokenizer = TokenizerKind::Byte;
    std::mt19937 rng(123);
    std::string cont_k;
    std::string text_k = generate_text(model, "P:", 12, 0.9f, &rng, &cont_k, &go);
    std::cout << "topk cont='" << cont_k << "' text='" << text_k << "'\n";
    if (cont_k.empty() && text_k.size() <= 2) {
        std::cerr << "top-k generate empty\n";
        return 1;
    }

    GenerateOpts gp;
    gp.max_new_tokens = 12;
    gp.temperature = 0.8f;
    gp.top_k = 0;
    gp.top_p = 0.85f;
    gp.tokenizer = TokenizerKind::Byte;
    std::mt19937 rng2(99);
    std::string cont_p;
    generate_text(model, "P:", 12, 0.8f, &rng2, &cont_p, &gp);
    std::cout << "topp cont='" << cont_p << "'\n";
    if (cont_p.empty()) {
        std::cerr << "top-p generate empty\n";
        return 1;
    }

    // Greedy still works
    GenerateOpts gg;
    gg.max_new_tokens = 8;
    gg.temperature = 0.f;
    gg.tokenizer = TokenizerKind::Byte;
    std::string cont_g;
    generate_text(model, "P:", 8, 0.f, nullptr, &cont_g, &gg);
    std::cout << "greedy cont='" << cont_g << "'\n";
    if (cont_g.empty()) {
        std::cerr << "greedy empty\n";
        return 1;
    }
    std::cout << "test_ml_generate_sample ok\n";
    return 0;
}
