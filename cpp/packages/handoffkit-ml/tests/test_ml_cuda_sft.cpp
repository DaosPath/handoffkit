#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/cuda/sft_cuda.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cmath>
#include <filesystem>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    auto info = query_devices();

#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_cuda_sft SKIP (not CUDA build)\n";
    return 0;
#else
    if (!info.cuda_available) {
        std::cout << "test_ml_cuda_sft SKIP (no GPU)\n";
        return 0;
    }

    float ol = cuda_linear_overfit(120);
    std::cout << "cuda_linear_overfit final=" << ol << "\n";
    if (ol > 0.4f) {
        std::cerr << "linear overfit too high\n";
        return 1;
    }

    const auto dir = fs::current_path() / "test_artifacts_cuda_sft";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    auto ds = (dir / "d.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", "MARK42"}, {"P:", "MARK42"}, {"P:", "MARK42"}})) {
        std::cerr << "write failed\n";
        return 1;
    }

    SftConfig cfg;
    cfg.allow_tiny = true;
    cfg.tokenizer = TokenizerKind::Byte;
    cfg.arch = "gpt-mini";
    cfg.n_embd = 64;
    cfg.n_head = 4;
    cfg.n_layer = 2;
    cfg.block_size = 48;
    cfg.epochs = 20;
    cfg.lr = 1e-2f;
    cfg.device = "cuda";
    auto r = sft_train(ds, (dir / "out").string(), cfg);
    if (!r.success) {
        std::cerr << "cuda sft failed: " << r.error << "\n";
        return 1;
    }
    std::cout << "cuda sft initial=" << r.initial_loss << " final=" << r.final_loss
              << " steps=" << r.steps << "\n";
    if (!(r.final_loss < r.initial_loss)) {
        std::cerr << "loss did not drop\n";
        return 1;
    }

    auto model = load_gpt(r.ckpt_path);
    std::string cont;
    generate_text(model, "P:", 12, 0.f, nullptr, &cont);
    std::cout << "cuda sft generate cont='" << cont << "'\n";
    if (cont.empty()) {
        std::cerr << "empty generate\n";
        return 1;
    }

    std::cout << "test_ml_cuda_sft ok\n";
    return 0;
#endif
}
