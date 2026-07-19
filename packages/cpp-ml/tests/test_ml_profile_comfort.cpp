// Comfort / QLoRA profile application + one-shot sft_train via apply_sft_profile.

#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/model_profile.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;

    ModelProfile mp;
    if (!parse_profile_name("qlora", mp) || mp != ModelProfile::ComfortQlora) {
        std::cerr << "parse qlora profile failed\n";
        return 1;
    }
    if (!parse_profile_name("comfort", mp) || mp != ModelProfile::Comfort) {
        std::cerr << "parse comfort profile failed\n";
        return 1;
    }

    SftConfig cfg;
    apply_sft_profile(cfg, ModelProfile::ComfortQlora);
    if (!cfg.use_qlora || !cfg.allow_tiny || cfg.n_embd != 64 || cfg.n_layer != 2 ||
        cfg.tokenizer != TokenizerKind::Byte || cfg.lora_rank != 8 || cfg.profile != "qlora") {
        std::cerr << "apply ComfortQlora wrong: embd=" << cfg.n_embd << " qlora=" << cfg.use_qlora
                  << " profile=" << cfg.profile << "\n";
        return 1;
    }
    std::cout << "profile qlora applied n_embd=" << cfg.n_embd << " epochs=" << cfg.epochs
              << " lr=" << cfg.lr << " log_every=" << cfg.log_every << "\n";

    const auto dir = fs::current_path() / "test_artifacts_profile_comfort";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "data.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", " MARK42"}, {"P:", " MARK42"}})) {
        std::cerr << "write_sft_jsonl failed\n";
        return 1;
    }

    cfg.log_every = 0;  // quiet in CI
    auto r = sft_train(ds, (dir / "out").string(), cfg);
    std::cout << "profile_qlora_sft initial=" << r.initial_loss << " final=" << r.final_loss
              << " success=" << (r.success ? "true" : "false") << "\n";
    if (!r.success || !(r.final_loss < r.initial_loss)) {
        std::cerr << "comfort qlora train failed: " << r.error << "\n";
        return 1;
    }
    if (!fs::exists(r.ckpt_path) || fs::file_size(r.ckpt_path) == 0) {
        std::cerr << "missing ckpt\n";
        return 1;
    }
    auto cfg_path = dir / "out" / "sft_config.json";
    if (!fs::exists(cfg_path)) {
        std::cerr << "missing sft_config.json\n";
        return 1;
    }
    std::ifstream cj(cfg_path.string());
    std::string body((std::istreambuf_iterator<char>(cj)), std::istreambuf_iterator<char>());
    if (body.find("\"profile\": \"qlora\"") == std::string::npos ||
        body.find("\"use_qlora\": true") == std::string::npos) {
        std::cerr << "sft_config.json missing fields:\n" << body << "\n";
        return 1;
    }

    auto model = load_gpt(r.ckpt_path);
    std::string cont;
    generate_text(model, "P:", 8, 0.f, nullptr, &cont);
    std::cout << "generate cont_len=" << cont.size() << "\n";
    if (cont.empty()) {
        std::cerr << "empty generate\n";
        return 1;
    }
    std::cout << "test_ml_profile_comfort ok\n";
    return 0;
}
