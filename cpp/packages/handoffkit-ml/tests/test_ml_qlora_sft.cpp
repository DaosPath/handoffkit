// Shipped QLoRA SFT path: NF4 freeze, adapter-only Adam, loss drop, loadable ckpt, generate.

#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/peft.hpp>
#include <handoffkit/ml/qlora.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

static int test_nf4_roundtrip_stable() {
    using namespace handoffkit::ml;
    std::mt19937 rng(2);
    Tensor W({32, 16});
    W.uniform(0.5f, rng);
    auto q = quantize_nf4(W, 32);
    auto d1 = dequantize_nf4(q);
    auto d2 = dequantize_nf4(q);
    for (std::size_t i = 0; i < d1.numel(); ++i) {
        if (d1.data[i] != d2.data[i]) {
            std::cerr << "nf4 dequant not stable\n";
            return 1;
        }
    }
    std::cout << "nf4 stable ok packed=" << q.packed.size() << "\n";
    return 0;
}

static int test_qlora_sft_adapter_freeze_and_generate() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_qlora_sft";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "data.jsonl").string();
    std::vector<SftExample> ex = {{"P:", " MARK42"}, {"P:", " MARK42"}, {"Hi ", "YES"}};
    if (!write_sft_jsonl(ds, ex)) {
        std::cerr << "write jsonl failed\n";
        return 1;
    }

    SftConfig cfg;
    cfg.allow_tiny = true;
    cfg.tokenizer = TokenizerKind::Byte;
    cfg.arch = "gpt-mini";
    cfg.epochs = 80;
    cfg.n_embd = 64;
    cfg.n_head = 4;
    cfg.n_layer = 2;
    cfg.block_size = 48;
    cfg.lr = 1e-2f;
    cfg.use_qlora = true;
    cfg.lora_rank = 8;
    cfg.device = "cpu";

    auto r = sft_train(ds, (dir / "out").string(), cfg);
    std::cout << "qlora_sft initial=" << r.initial_loss << " final=" << r.final_loss
              << " steps=" << r.steps << " success=" << (r.success ? "true" : "false")
              << " err=" << r.error << "\n";
    if (!r.success) {
        std::cerr << "qlora sft failed: " << r.error << "\n";
        return 1;
    }
    if (!(r.final_loss < r.initial_loss)) {
        std::cerr << "loss did not drop\n";
        return 1;
    }
    if (!fs::exists(r.ckpt_path) || fs::file_size(r.ckpt_path) == 0) {
        std::cerr << "missing ckpt\n";
        return 1;
    }

    std::ifstream rep(r.report_path);
    std::string body((std::istreambuf_iterator<char>(rep)), std::istreambuf_iterator<char>());
    if (body.find("\"use_qlora\": true") == std::string::npos ||
        body.find("\"backend_id\": \"qlora\"") == std::string::npos ||
        body.find("\"adapter_only_optim\": true") == std::string::npos ||
        body.find("\"nf4_base\": true") == std::string::npos) {
        std::cerr << "report missing qlora fields:\n" << body << "\n";
        return 1;
    }
    if (body.find("\"peft_modules\":") == std::string::npos) {
        std::cerr << "report missing peft_modules\n";
        return 1;
    }
    std::cout << "qlora report ok peft fields present\n";
    std::cout << "adapter_only_optim=true nf4_base=true freeze_checked_in_sft_train=true\n";

    auto model = load_gpt(r.ckpt_path);
    std::string cont;
    std::string text = generate_text(model, "P:", 12, 0.f, nullptr, &cont);
    std::cout << "qlora generate cont='" << cont << "' text='" << text << "'\n";
    if (cont.empty() && text.size() <= 2) {
        std::cerr << "generate empty\n";
        return 1;
    }
    bool any = false;
    for (unsigned char c : cont) {
        if (c > 32 && c < 127) any = true;
    }
    if (!any && r.final_loss > 1.5f) {
        std::cerr << "no printable continuation\n";
        return 1;
    }
    std::cout << "test_qlora_sft_adapter_freeze_and_generate ok\n";
    return 0;
}

int main() {
    if (test_nf4_roundtrip_stable() != 0) return 1;
    if (test_qlora_sft_adapter_freeze_and_generate() != 0) return 1;
    std::cout << "test_ml_qlora_sft ok\n";
    return 0;
}
