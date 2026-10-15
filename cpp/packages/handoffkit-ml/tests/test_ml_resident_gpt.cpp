#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/cuda/resident.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/sft.hpp>
#include <handoffkit/ml/token.hpp>

#include <filesystem>
#include <iostream>
#include <vector>

int main() {
    using namespace handoffkit::ml;
#if !defined(HANDOFFKIT_ML_WITH_CUDA) || !HANDOFFKIT_ML_WITH_CUDA
    std::cout << "test_ml_resident_gpt SKIP\n";
    return 0;
#else
    if (!query_devices().cuda_available) {
        std::cout << "test_ml_resident_gpt SKIP no GPU\n";
        return 0;
    }
    auto gpt = DeviceGPT::make(ByteTokenizer::VOCAB, 64, 4, 2, 48, 7);
    if (!gpt.weights_on_cuda()) {
        std::cerr << "gpt weights not on cuda\n";
        return 1;
    }
    // short SFT-like sequence
    std::vector<int> full = {256, 80, 58, 77, 65, 82, 75, 52, 50, 257};  // BOS P: MARK42 EOS-ish
    std::vector<int> input(full.begin(), full.end() - 1);
    std::vector<int> target(full.begin() + 1, full.end());
    float loss0 = 0.f, last = 0.f;
    for (int s = 0; s < 40; ++s) {
        last = gpt.train_step(input, target, 5e-3f);
        if (s == 0) loss0 = last;
        if (!gpt.weights_on_cuda()) {
            std::cerr << "weights left cuda at step " << s << "\n";
            return 1;
        }
        if (!gpt.last_residency.weights_on_cuda || !gpt.last_residency.activation_on_cuda ||
            !gpt.last_residency.activation_device_storage) {
            std::cerr << "residency snapshot failed at step " << s << "\n";
            return 1;
        }
    }
    std::cout << "resident_gpt loss0=" << loss0 << " final=" << last
              << " weights_cuda=" << (gpt.weights_on_cuda() ? "true" : "false") << "\n";
    std::cout << "residency mid_step weights="
              << (gpt.last_residency.weights_on_cuda ? "cuda" : "host")
              << " act=" << (gpt.last_residency.activation_on_cuda ? "cuda" : "host")
              << " act_storage="
              << (gpt.last_residency.activation_device_storage ? "nonnull" : "null")
              << " note=" << gpt.last_residency.note << "\n";
    if (!(last < loss0 + 1e-3f) && last > loss0 * 0.99f && last > 2.f) {
        if (last > loss0) {
            std::cerr << "loss did not improve\n";
            return 1;
        }
    }
    if (last > loss0 && last > 1.0f) return 1;

    // End-only download → loadable ckpt
    namespace fs = std::filesystem;
    fs::path out = fs::current_path() / "test_artifacts_resident_gpt";
    fs::create_directories(out);
    auto host = gpt.to_host_gpt();
    if (!gpt.weights_on_cuda()) {
        std::cerr << "weights left CUDA after to_host_gpt (device copy must not free)\n";
        return 1;
    }
    std::string ckpt = (out / "model.hkckpt").string();
    save_gpt(ckpt, host);
    auto loaded = load_gpt(ckpt);
    GenerateOpts go;
    go.max_new_tokens = 8;
    go.temperature = 0.f;
    go.tokenizer = TokenizerKind::Byte;
    std::string cont;
    std::string text = generate_text(loaded, "P:", 8, 0.f, nullptr, &cont, &go);
    std::cout << "ckpt=" << ckpt << " cont_len=" << cont.size() << " cont=" << cont << "\n";
    if (cont.empty() && text.empty()) {
        std::cerr << "generate empty after resident ckpt\n";
        return 1;
    }

    // generate a few tokens on device path too
    std::vector<int> ctx = {256, 80, 58};  // BOS P:
    for (int i = 0; i < 6; ++i) {
        int n = gpt.greedy_next(ctx);
        ctx.push_back(n);
        if (n == 257) break;
    }
    std::cout << "greedy len=" << ctx.size() << "\n";
    std::cout << "test_ml_resident_gpt ok\n";
    return 0;
#endif
}
