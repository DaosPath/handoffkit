#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/nn.hpp>
#include <handoffkit/ml/ops.hpp>
#include <handoffkit/ml/peft.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cassert>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <random>
#include <string>

static int test_lora_linear_overfit() {
    using namespace handoffkit::ml;
    std::mt19937 rng(3);
    Linear base(4, 3, true, rng);
    Tensor W0 = base.W.clone();
    auto lora = LoraLinear::wrap(base, 2, 9);

    std::vector<std::vector<float>> xs = {
        {1, 0, 0, 0},
        {0, 1, 0, 0},
        {0, 0, 1, 0},
        {0, 0, 0, 1},
    };
    std::vector<int> ys = {0, 1, 2, 0};
    AdamW opt;
    opt.lr = 0.05f;
    opt.weight_decay = 0.f;
    float last = 99.f;
    for (int step = 0; step < 400; ++step) {
        Tensor x({4, 4});
        for (int i = 0; i < 4; ++i)
            for (int j = 0; j < 4; ++j)
                x.data[static_cast<std::size_t>(i * 4 + j)] =
                    xs[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)];
        lora.zero_grad();
        for (std::size_t i = 0; i < base.W.numel(); ++i) base.W.data[i] = W0.data[i];
        Tensor logits = lora.forward(x);
        last = cross_entropy_mean(logits, ys);
        Tensor d = softmax_ce_backward(logits, ys);
        lora.backward(d);
        std::vector<Param> params;
        lora.collect_params(params);
        opt.step(params);
    }
    std::cout << "lora linear overfit loss=" << last << "\n";
    assert(last < 0.35f);
    float ab = 0.f;
    for (float v : lora.B.data) ab += std::fabs(v);
    assert(ab > 1e-4f);
    return 0;
}

static int test_lora_sft_ckpt_generate() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_lora_sft";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "data.jsonl").string();
    std::vector<SftExample> ex = {{"X:", "LoRA1"}, {"X:", "LoRA1"}};
    if (!write_sft_jsonl(ds, ex)) {
        std::cerr << "write failed\n";
        return 1;
    }

    SftConfig cfg;
    cfg.epochs = 40;
    cfg.n_embd = 32;
    cfg.n_head = 4;
    cfg.n_layer = 1;
    cfg.block_size = 24;
    cfg.lr = 8e-3f;
    cfg.use_lora = true;
    cfg.lora_rank = 4;
    auto r = sft_train(ds, (dir / "out").string(), cfg);
    if (!r.success) {
        std::cerr << "lora sft failed: " << r.error << "\n";
        return 1;
    }
    std::cout << "lora sft initial_loss=" << r.initial_loss << " final_loss=" << r.final_loss
              << " steps=" << r.steps << " ckpt=" << r.ckpt_path << "\n";
    assert(fs::exists(r.ckpt_path));
    assert(r.steps > 0);
    assert(std::isfinite(r.final_loss));
    // Training path must move loss or at least complete with report
    assert(r.final_loss < 15.f);

    auto model = load_gpt(r.ckpt_path);
    std::string cont;
    std::string gen = generate_text(model, "X:", 10, 0.f, nullptr, &cont);
    std::cout << "lora generate cont='" << cont << "' full='" << gen << "'\n";
    assert(!gen.empty());
    // Report file marks lora
    std::ifstream rep(r.report_path);
    std::string body((std::istreambuf_iterator<char>(rep)), std::istreambuf_iterator<char>());
    assert(body.find("\"use_lora\": true") != std::string::npos);
    std::cout << "test_lora_sft_ckpt_generate ok\n";
    return 0;
}

int main() {
    if (test_lora_linear_overfit() != 0) return 1;
    if (test_lora_sft_ckpt_generate() != 0) return 1;
    std::cout << "test_ml_lora ok\n";
    return 0;
}
