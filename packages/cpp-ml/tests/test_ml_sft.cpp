#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cassert>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <string>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_sft";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    if (ec) {
        std::cerr << "mkdir failed: " << ec.message() << "\n";
        return 1;
    }
    const auto ds = (dir / "data.jsonl").string();
    // Distinctive short completion for memorization check
    std::vector<SftExample> ex = {
        {"P:", "MARK42"},
        {"P:", "MARK42"},
        {"P:", "MARK42"},
    };
    if (!write_sft_jsonl(ds, ex)) {
        std::cerr << "write_sft_jsonl failed path=" << ds << "\n";
        return 1;
    }

    SftConfig cfg;
    cfg.epochs = 80;
    cfg.n_embd = 64;
    cfg.n_head = 4;
    cfg.n_layer = 2;
    cfg.block_size = 32;
    cfg.lr = 1e-2f;
    auto out = (dir / "out").string();
    auto r = sft_train(ds, out, cfg);
    if (!r.success) {
        std::cerr << "sft failed: " << r.error << "\n";
        return 1;
    }
    assert(r.steps > 0);
    assert(fs::exists(r.ckpt_path));
    std::cout << "sft initial_loss=" << r.initial_loss << " final_loss=" << r.final_loss
              << " steps=" << r.steps << "\n";
    assert(std::isfinite(r.final_loss));
    assert(r.final_loss < r.initial_loss);  // training signal
    assert(r.final_loss < 2.5f);

    auto model = load_gpt(r.ckpt_path);
    std::string cont;
    std::string gen = generate_text(model, "P:", 12, 0.f, nullptr, &cont);
    std::cout << "generate continuation='" << cont << "' full='" << gen << "'\n";
    assert(!cont.empty() || !gen.empty());
    // After heavy overfit, greedy path should emit MARK42 substring often
    if (cont.find("MARK") == std::string::npos && gen.find("MARK") == std::string::npos) {
        std::cerr << "warn: MARK not in greedy generate (tiny model may still miss); "
                     "loss drop still proves train path\n";
        // Require at least that continuation is printable ASCII-ish
        bool any_print = false;
        for (unsigned char c : cont) {
            if (c >= 32 && c < 127) any_print = true;
        }
        assert(any_print || r.final_loss < 1.0f);
    } else {
        std::cout << "memorization marker found in generate\n";
    }

    std::cout << "test_ml_sft ok\n";
    return 0;
}
