#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_pref";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    if (ec) {
        std::cerr << "mkdir failed: " << ec.message() << "\n";
        return 1;
    }
    const auto ds = (dir / "pref.jsonl").string();
    std::vector<SftExample> ex = {
        {"Prefer: ", "", "yes", "no"},
        {"Pick: ", "", "good", "bad"},
    };
    if (!write_sft_jsonl(ds, ex)) {
        std::cerr << "write failed " << ds << "\n";
        return 1;
    }
    SftConfig cfg;
    cfg.epochs = 15;
    cfg.n_layer = 1;
    cfg.n_embd = 32;
    cfg.n_head = 4;
    cfg.preference = true;
    cfg.dpo_beta = 0.2f;
    cfg.lr = 4e-3f;
    auto r = sft_train(ds, (dir / "out").string(), cfg);
    if (!r.success) {
        std::cerr << r.error << "\n";
        return 1;
    }
    assert(r.steps > 0);
    assert(fs::exists(r.ckpt_path));
    std::cout << "preference final_loss=" << r.final_loss << "\n";
    std::cout << "test_ml_preference ok\n";
    return 0;
}
