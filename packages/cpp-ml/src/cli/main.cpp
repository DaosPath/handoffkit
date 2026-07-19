#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/ml.hpp>
#include <handoffkit/ml/quant.hpp>
#include <handoffkit/ml/sft.hpp>
#include <handoffkit/ml/version.hpp>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <random>
#include <string>
#include <string_view>
#include <vector>

namespace {

std::string flag_val(const std::vector<std::string>& args, const std::string& flag) {
    for (std::size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == flag) return args[i + 1];
    }
    return {};
}

bool has_flag(const std::vector<std::string>& args, const std::string& flag) {
    for (const auto& a : args)
        if (a == flag) return true;
    return false;
}

void print_help() {
    std::cout
        << "handoffkit-ml " << handoffkit::ml::version()
        << " (" << handoffkit::ml::phase() << ")\n"
        << "Optional C++ weight-training complement — NOT handoffkit_core.\n\n"
        << "Usage:\n"
        << "  handoffkit-ml help | version | doctor\n"
        << "  handoffkit-ml sft --dataset PATH --out DIR [--epochs N] [--lr F]\n"
        << "                  [--lora] [--preference] [--block-size N]\n"
        << "  handoffkit-ml generate --ckpt PATH --prompt TEXT [--max-new N]\n"
        << "  handoffkit-ml quant-demo   (F6 int8 stub roundtrip)\n\n"
        << "Core distill (jobs) stays in handoffkit-cli train; this binary trains weights.\n"
        << "No Python. Zero link into handoffkit_core.\n";
}

int cmd_doctor() {
    const auto cap = handoffkit::ml::capabilities();
    const auto dev = handoffkit::ml::query_devices();
    std::cout << handoffkit::ml::status_message() << "\n"
              << "version=" << handoffkit::ml::version() << "\n"
              << "phase=" << handoffkit::ml::phase() << "\n"
              << "cap.tensor_cpu=" << (cap.tensor_cpu ? "true" : "false") << "\n"
              << "cap.mini_transformer=" << (cap.mini_transformer ? "true" : "false") << "\n"
              << "cap.lora=" << (cap.lora ? "true" : "false") << "\n"
              << "cap.cuda=" << (cap.cuda ? "true" : "false") << "\n"
              << "cap.preference=" << (cap.preference ? "true" : "false") << "\n"
              << "cap.quant_stub=" << (cap.quant_stub ? "true" : "false") << "\n"
              << "device.cpu=true\n"
              << "device.cuda_compiled=" << (dev.cuda_compiled ? "true" : "false") << "\n"
              << "device.cuda_note=" << dev.cuda_note << "\n"
              << "dist=" << handoffkit::ml::dist_status() << "\n"
              << "success=true\n";
    return 0;
}

int cmd_sft(const std::vector<std::string>& args) {
    const std::string ds = flag_val(args, "--dataset");
    const std::string out = flag_val(args, "--out");
    if (ds.empty() || out.empty()) {
        std::cerr << "sft requires --dataset PATH and --out DIR\n";
        return 2;
    }
    handoffkit::ml::SftConfig cfg;
    if (auto e = flag_val(args, "--epochs"); !e.empty()) cfg.epochs = std::stoi(e);
    if (auto lr = flag_val(args, "--lr"); !lr.empty()) cfg.lr = std::stof(lr);
    if (auto b = flag_val(args, "--block-size"); !b.empty()) cfg.block_size = std::stoi(b);
    if (auto n = flag_val(args, "--n-embd"); !n.empty()) cfg.n_embd = std::stoi(n);
    if (auto n = flag_val(args, "--n-layer"); !n.empty()) cfg.n_layer = std::stoi(n);
    if (auto n = flag_val(args, "--n-head"); !n.empty()) cfg.n_head = std::stoi(n);
    cfg.use_lora = has_flag(args, "--lora");
    cfg.preference = has_flag(args, "--preference");
    auto r = handoffkit::ml::sft_train(ds, out, cfg);
    if (!r.success) {
        std::cerr << "sft failed: " << r.error << "\n";
        return 1;
    }
    std::cout << "sft ok\n"
              << "initial_loss=" << r.initial_loss << "\n"
              << "final_loss=" << r.final_loss << "\n"
              << "steps=" << r.steps << "\n"
              << "loss_dropped=" << (r.final_loss < r.initial_loss ? "true" : "false") << "\n"
              << "ckpt_path=" << r.ckpt_path << "\n"
              << "report_path=" << r.report_path << "\n"
              << "success=true\n";
    return 0;
}

int cmd_generate(const std::vector<std::string>& args) {
    const std::string ckpt = flag_val(args, "--ckpt");
    const std::string prompt = flag_val(args, "--prompt");
    if (ckpt.empty()) {
        std::cerr << "generate requires --ckpt PATH\n";
        return 2;
    }
    int max_new = 32;
    if (auto m = flag_val(args, "--max-new"); !m.empty()) max_new = std::stoi(m);
    try {
        auto model = handoffkit::ml::load_gpt(ckpt);
        const std::string p = prompt.empty() ? "Hi " : prompt;
        float temp = 0.f;
        if (auto t = flag_val(args, "--temperature"); !t.empty()) temp = std::stof(t);
        std::string cont;
        std::string text = handoffkit::ml::generate_text(model, p, max_new, temp, nullptr, &cont);
        std::cout << "generate ok\n"
                  << "prompt=" << p << "\n"
                  << "continuation=" << cont << "\n"
                  << "text=" << text << "\n"
                  << "success=true\n";
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "generate failed: " << ex.what() << "\n";
        return 1;
    }
}

int cmd_quant_demo() {
    handoffkit::ml::Tensor t({4, 4});
    std::mt19937 rng(0);
    t.uniform(1.f, rng);
    auto q = handoffkit::ml::quantize_int8(t);
    auto d = handoffkit::ml::dequantize_int8(q);
    float err = 0.f;
    for (std::size_t i = 0; i < t.numel(); ++i) err = std::max(err, std::fabs(t.data[i] - d.data[i]));
    std::cout << "quant-demo ok scheme=" << q.cfg.scheme << " max_abs_err=" << err
              << "\nsuccess=true\n";
    return err < 0.1f ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
    std::vector<std::string> args;
    for (int i = 1; i < argc; ++i) args.emplace_back(argv[i]);

    if (args.empty() || args[0] == "help" || args[0] == "-h" || args[0] == "--help") {
        print_help();
        return 0;
    }
    if (args[0] == "version" || args[0] == "--version" || args[0] == "-V") {
        std::cout << "handoffkit-ml " << handoffkit::ml::version() << "\n";
        return 0;
    }
    if (args[0] == "doctor") return cmd_doctor();
    if (args[0] == "sft" || args[0] == "train") return cmd_sft(args);
    if (args[0] == "generate") return cmd_generate(args);
    if (args[0] == "quant-demo") return cmd_quant_demo();

    std::cerr << "handoffkit-ml: unknown command '" << args[0] << "'\n";
    print_help();
    return 2;
}
