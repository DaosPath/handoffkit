// Resume from prior sft_config.json + base ckpt; dim mismatch must error clearly.

#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/sft.hpp>

#include <filesystem>
#include <iostream>
#include <string>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_resume";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "data.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", " YES"}, {"P:", " YES"}, {"Hi ", "OK"}})) return 1;

    SftConfig c1;
    apply_sft_profile(c1, ModelProfile::Comfort);
    c1.epochs = 15;
    c1.log_every = 0;
    auto r1 = sft_train(ds, (dir / "run1").string(), c1);
    if (!r1.success) {
        std::cerr << "run1 failed: " << r1.error << "\n";
        return 1;
    }
    auto cfg_path = (dir / "run1" / "sft_config.json").string();
    if (!fs::exists(cfg_path) || !fs::exists(r1.ckpt_path)) {
        std::cerr << "missing sidecar/ckpt\n";
        return 1;
    }

    // Resume: load config → dims + base_ckpt, continue train
    SftConfig c2;
    apply_sft_config_json(c2, cfg_path, true);
    c2.epochs = 10;
    c2.log_every = 0;
    c2.require_loss_drop = false;  // warm-start may plateau
    if (c2.base_ckpt.empty()) {
        std::cerr << "base_ckpt not set from resume config\n";
        return 1;
    }
    if (c2.n_embd != c1.n_embd || c2.n_layer != c1.n_layer) {
        std::cerr << "dims not restored from config\n";
        return 1;
    }
    auto r2 = sft_train(ds, (dir / "run2").string(), c2);
    std::cout << "resume success=" << (r2.success ? "true" : "false") << " ckpt=" << r2.ckpt_path
              << " base=" << c2.base_ckpt << "\n";
    if (!r2.success) {
        std::cerr << "run2 failed: " << r2.error << "\n";
        return 1;
    }
    if (!fs::exists(r2.ckpt_path) || fs::file_size(r2.ckpt_path) == 0) {
        std::cerr << "run2 ckpt missing\n";
        return 1;
    }

    // Dim mismatch must fail clearly
    SftConfig bad;
    apply_sft_profile(bad, ModelProfile::Comfort);
    bad.base_ckpt = r1.ckpt_path;
    bad.n_embd = 128;  // mismatch
    bad.n_layer = 4;
    bad.n_head = 4;
    bad.block_size = 128;
    bad.allow_tiny = true;
    bad.epochs = 2;
    bad.log_every = 0;
    auto rb = sft_train(ds, (dir / "bad").string(), bad);
    if (rb.success) {
        std::cerr << "expected dim mismatch failure\n";
        return 1;
    }
    std::cout << "mismatch_error=" << rb.error << "\n";
    if (rb.error.find("dim mismatch") == std::string::npos &&
        rb.error.find("mismatch") == std::string::npos) {
        std::cerr << "error not clear enough: " << rb.error << "\n";
        return 1;
    }
    std::cout << "test_ml_resume ok\n";
    return 0;
}
