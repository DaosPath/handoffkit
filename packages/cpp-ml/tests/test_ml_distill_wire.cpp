// Ensures core distill JSONL wire (prompt/completion + optional format/meta)
// is consumable by shipped sft_train + generate (no core link).

#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_distill_wire";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);

    // Same shape as handoffkit-cli train distill / EchoProvider save_jsonl
    const auto ds = (dir / "student.jsonl").string();
    {
        std::ofstream o(ds, std::ios::binary);
        o << R"({"completion":" MARK42","format":"prompt_completion","meta":{"source":"distill","teacher":"teacher"},"prompt":"P:"})"
          << "\n";
        o << R"({"completion":" MARK42","format":"prompt_completion","meta":{"source":"distill","teacher":"teacher"},"prompt":"P:"})"
          << "\n";
        o << R"({"completion":"YES","format":"prompt_completion","meta":{"source":"distill"},"prompt":"Hi "})"
          << "\n";
    }

    auto loaded = load_sft_jsonl(ds);
    if (loaded.size() < 2) {
        std::cerr << "distill wire load failed n=" << loaded.size() << "\n";
        return 1;
    }
    if (loaded[0].prompt != "P:" || loaded[0].completion.find("MARK") == std::string::npos) {
        std::cerr << "distill wire fields wrong prompt='" << loaded[0].prompt << "' completion='"
                  << loaded[0].completion << "'\n";
        return 1;
    }

    SftConfig cfg;
    cfg.allow_tiny = true;
    cfg.tokenizer = TokenizerKind::Byte;
    cfg.arch = "gpt-mini";
    cfg.epochs = 40;
    cfg.n_embd = 64;
    cfg.n_head = 4;
    cfg.n_layer = 2;
    cfg.block_size = 48;
    cfg.lr = 5e-2f;
    cfg.device = "cpu";
    auto out = (dir / "out").string();
    auto r = sft_train(ds, out, cfg);
    if (!r.success) {
        std::cerr << "sft failed: " << r.error << "\n";
        return 1;
    }
    if (!(r.final_loss < r.initial_loss)) {
        std::cerr << "loss did not drop initial=" << r.initial_loss << " final=" << r.final_loss
                  << "\n";
        return 1;
    }
    if (!fs::exists(r.ckpt_path) || fs::file_size(r.ckpt_path) == 0) {
        std::cerr << "missing loadable ckpt: " << r.ckpt_path << "\n";
        return 1;
    }

    auto model = load_gpt(r.ckpt_path);
    std::string cont;
    std::string text = generate_text(model, "P:", 12, 0.f, nullptr, &cont);
    std::cout << "distill_wire initial=" << r.initial_loss << " final=" << r.final_loss
              << " ckpt=" << r.ckpt_path << " cont='" << cont << "'\n";
    if (cont.empty() && text.size() <= 2) {
        std::cerr << "generate empty after distill-wire SFT\n";
        return 1;
    }
    bool any_print = false;
    for (unsigned char c : cont) {
        if (c > 32 && c < 127) any_print = true;
    }
    if (!any_print && r.final_loss > 1.0f) {
        std::cerr << "continuation has no printable non-space chars\n";
        return 1;
    }
    std::cout << "test_ml_distill_wire ok\n";
    return 0;
}
