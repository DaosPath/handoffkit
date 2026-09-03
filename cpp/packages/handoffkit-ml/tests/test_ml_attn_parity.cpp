#include <handoffkit/ml/attn_parity.hpp>
#include <handoffkit/ml/model_profile.hpp>

#include <cassert>
#include <cmath>
#include <iostream>

int main() {
    using namespace handoffkit::ml;

    // Floors
    auto stdp = profile_spec(ModelProfile::Standard);
    assert(stdp.n_embd >= ModelFloors::kMinEmb);
    assert(stdp.n_layer >= ModelFloors::kMinLayer);
    assert(stdp.n_head >= ModelFloors::kMinHead);
    assert(stdp.block_size >= ModelFloors::kMinBlock);
    assert(is_allowed_arch(stdp.arch));
    assert(is_allowed_arch("llama-like"));
    assert(!is_allowed_arch("unknown-arch"));

    bool threw = false;
    try {
        enforce_non_tiny(32, 2, 4, 64, false);
    } catch (...) {
        threw = true;
    }
    assert(threw);
    enforce_non_tiny(32, 2, 4, 64, true);  // allow tiny for tests

    float err_x = attention_input_grad_parity(1, 6, 32, 4, 1e-3f, 11);
    std::cout << "attn input grad max_err=" << err_x << "\n";
    assert(err_x < 5e-2f);

    float err_w = attention_weight_grad_parity(1e-3f, 13);
    std::cout << "attn weight grad max_err=" << err_w << "\n";
    assert(err_w < 8e-2f);

    // GPTConfig defaults meet non-tiny floors
    GPTConfig cfg;
    assert(cfg.n_embd >= ModelFloors::kMinEmb);
    assert(cfg.n_layer >= ModelFloors::kMinLayer);
    std::cout << "gpt defaults emb=" << cfg.n_embd << " layer=" << cfg.n_layer
              << " arch=" << cfg.arch << "\n";

    std::cout << "test_ml_attn_parity ok\n";
    return 0;
}
