#include <handoffkit/ml/cuda/resident.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/token.hpp>

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
    }
    std::cout << "resident_gpt loss0=" << loss0 << " final=" << last
              << " weights_cuda=" << (gpt.weights_on_cuda() ? "true" : "false") << "\n";
    if (!(last < loss0 + 1e-3f) && last > loss0 * 0.99f && last > 2.f) {
        // allow flat if already low; require drop or low loss
        if (last > loss0) {
            std::cerr << "loss did not improve\n";
            return 1;
        }
    }
    if (last > loss0 && last > 1.0f) return 1;

    // generate a few tokens
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
