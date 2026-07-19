#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/gguf.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cassert>
#include <cmath>
#include <filesystem>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_base_load";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);

    // Train a small base, export GGUF, then SFT from that base
    auto ds0 = (dir / "pre.jsonl").string();
    if (!write_sft_jsonl(ds0, {{"P:", "MARK42"}, {"P:", "MARK42"}})) {
        std::cerr << "write pre.jsonl failed\n";
        return 1;
    }
    SftConfig pre;
    pre.allow_tiny = true;
    pre.tokenizer = TokenizerKind::Byte;
    pre.arch = "gpt2";
    pre.n_embd = 64;
    pre.n_head = 4;
    pre.n_layer = 2;
    pre.block_size = 48;
    pre.epochs = 15;
    pre.lr = 1e-2f;
    auto r0 = sft_train(ds0, (dir / "pre_out").string(), pre);
    if (!r0.success) {
        std::cerr << "pre sft failed: " << r0.error << "\n";
        return 1;
    }
    auto model = load_gpt(r0.ckpt_path);
    auto gguf = (dir / "base.gguf").string();
    export_gpt_gguf(gguf, model);
    assert(fs::exists(gguf));

    auto ds1 = (dir / "finetune.jsonl").string();
    if (!write_sft_jsonl(ds1, {{"P:", "MARK42"}, {"P:", "MARK42"}})) {
        std::cerr << "write finetune.jsonl failed\n";
        return 1;
    }
    SftConfig ft;
    ft.allow_tiny = true;
    ft.tokenizer = TokenizerKind::Byte;
    ft.arch = "gpt2";
    ft.n_embd = 64;
    ft.n_head = 4;
    ft.n_layer = 2;
    ft.block_size = 48;
    ft.epochs = 10;
    ft.lr = 5e-3f;
    ft.base_gguf = gguf;  // AC2: load external base
    auto r1 = sft_train(ds1, (dir / "ft_out").string(), ft);
    if (!r1.success) {
        std::cerr << "ft from gguf failed: " << r1.error << "\n";
        return 1;
    }
    assert(r1.final_loss < r1.initial_loss || r1.final_loss < 1.0f);
    assert(fs::exists(r1.ckpt_path));

    auto m2 = load_gpt(r1.ckpt_path);
    std::string cont;
    generate_text(m2, "P:", 12, 0.f, nullptr, &cont);
    std::cout << "base_gguf sft initial=" << r1.initial_loss << " final=" << r1.final_loss
              << " cont='" << cont << "'\n";
    assert(!cont.empty());

    // also base_ckpt path
    SftConfig ft2 = ft;
    ft2.base_gguf.clear();
    ft2.base_ckpt = r0.ckpt_path;
    ft2.epochs = 5;
    auto r2 = sft_train(ds1, (dir / "ft2_out").string(), ft2);
    assert(r2.success);

    std::cout << "test_ml_base_load ok\n";
    return 0;
}
