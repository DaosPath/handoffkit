#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/dist.hpp>
#include <handoffkit/ml/gguf.hpp>
#include <handoffkit/ml/kernels.hpp>
#include <handoffkit/ml/ml.hpp>
#include <handoffkit/ml/model_profile.hpp>
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
        << "  handoffkit-ml sft --dataset PATH --out DIR [options]\n"
        << "      --epochs N --lr F --n-embd N --n-layer N --n-head N --block-size N\n"
        << "      --arch gpt2|llama-like|gpt-mini --tokenizer bpe|byte\n"
        << "      --lora | --qlora | --preference --world-size N --allow-tiny\n"
        << "      --gguf BASE.gguf | --base-ckpt model.hkckpt   (load external base)\n"
        << "      --device cpu|cuda|cuda-resident\n"
        << "         cuda = GPU GEMM; cuda-resident = weights+activations on GPU\n"
        << "  handoffkit-ml generate --ckpt PATH --prompt TEXT [--max-new N] [--bpe PATH]\n"
        << "  handoffkit-ml gguf-export --ckpt PATH --out model.gguf\n"
        << "  handoffkit-ml gguf-import --gguf PATH --out DIR\n"
        << "  handoffkit-ml quant-demo\n\n"
        << "Default profile is non-tiny (n_embd>=128, n_layer>=4) unless --allow-tiny.\n"
        << "No Python. Core never links this library.\n";
}

int cmd_doctor() {
    const auto cap = handoffkit::ml::capabilities();
    const auto dev = handoffkit::ml::query_devices();
    const auto ker = handoffkit::ml::query_kernel_backend();
    const auto stdp = handoffkit::ml::profile_spec(handoffkit::ml::ModelProfile::Standard);
    std::cout << handoffkit::ml::status_message() << "\n"
              << "version=" << handoffkit::ml::version() << "\n"
              << "phase=" << handoffkit::ml::phase() << "\n"
              << "cap.tensor_cpu=" << (cap.tensor_cpu ? "true" : "false") << "\n"
              << "cap.mini_transformer=" << (cap.mini_transformer ? "true" : "false") << "\n"
              << "cap.lora=" << (cap.lora ? "true" : "false") << "\n"
              << "cap.cuda=" << (cap.cuda ? "true" : "false") << "\n"
              << "cap.preference=" << (cap.preference ? "true" : "false") << "\n"
              << "kernel.backend=" << ker.name << "\n"
              << "kernel.cpu_threads=" << ker.cpu_threads << "\n"
              << "kernel.cuda_runtime=" << (ker.cuda_runtime ? "true" : "false") << "\n"
              << "cuda.policy=own_kernels_cudart_only\n"
              << "cuda.no_cublas=true\n"
              << "cuda.resident=weights+activations (sft --device cuda-resident)\n"
              << "profile.standard.n_embd=" << stdp.n_embd << "\n"
              << "profile.standard.n_layer=" << stdp.n_layer << "\n"
              << "arch.allowlist=gpt-mini,gpt2,llama-like\n"
              << "device.cpu=true\n"
              << "device.cuda_compiled=" << (dev.cuda_compiled ? "true" : "false") << "\n"
              << "device.cuda_available=" << (dev.cuda_available ? "true" : "false") << "\n"
              << "device.cuda_devices=" << dev.cuda_devices << "\n"
              << "device.cuda_name=" << dev.device0_name << "\n"
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
    if (auto a = flag_val(args, "--arch"); !a.empty()) cfg.arch = a;
    if (auto t = flag_val(args, "--tokenizer"); !t.empty()) {
        cfg.tokenizer = (t == "byte") ? handoffkit::ml::TokenizerKind::Byte
                                      : handoffkit::ml::TokenizerKind::Bpe;
    }
    if (auto w = flag_val(args, "--world-size"); !w.empty()) cfg.world_size = std::stoi(w);
    if (auto b = flag_val(args, "--bpe"); !b.empty()) cfg.bpe_path = b;
    if (auto g = flag_val(args, "--gguf"); !g.empty()) cfg.base_gguf = g;
    if (auto c = flag_val(args, "--base-ckpt"); !c.empty()) cfg.base_ckpt = c;
    if (auto c = flag_val(args, "--ckpt"); !c.empty() && cfg.base_ckpt.empty()) cfg.base_ckpt = c;
    if (auto d = flag_val(args, "--device"); !d.empty()) cfg.device = d;
    cfg.use_lora = has_flag(args, "--lora");
    cfg.use_qlora = has_flag(args, "--qlora");
    cfg.preference = has_flag(args, "--preference");
    cfg.allow_tiny = has_flag(args, "--allow-tiny");
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
              << "tokenizer_path=" << r.tokenizer_path << "\n"
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
        handoffkit::ml::GenerateOpts go;
        go.max_new_tokens = max_new;
        go.temperature = temp;
        if (auto b = flag_val(args, "--bpe"); !b.empty()) {
            go.bpe_path = b;
            go.tokenizer = handoffkit::ml::TokenizerKind::Bpe;
        } else if (model.cfg.vocab_size <= 300) {
            go.tokenizer = handoffkit::ml::TokenizerKind::Byte;
        }
        std::string cont;
        std::string text =
            handoffkit::ml::generate_text(model, p, max_new, temp, nullptr, &cont, &go);
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

int cmd_gguf_export(const std::vector<std::string>& args) {
    const std::string ckpt = flag_val(args, "--ckpt");
    const std::string out = flag_val(args, "--out");
    if (ckpt.empty() || out.empty()) {
        std::cerr << "gguf-export requires --ckpt and --out\n";
        return 2;
    }
    try {
        auto model = handoffkit::ml::load_gpt(ckpt);
        handoffkit::ml::export_gpt_gguf(out, model);
        std::cout << "gguf-export ok\npath=" << out << "\nsuccess=true\n";
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "gguf-export failed: " << ex.what() << "\n";
        return 1;
    }
}

int cmd_gguf_import(const std::vector<std::string>& args) {
    const std::string gguf = flag_val(args, "--gguf");
    const std::string out = flag_val(args, "--out");
    if (gguf.empty() || out.empty()) {
        std::cerr << "gguf-import requires --gguf and --out\n";
        return 2;
    }
    try {
        auto model = handoffkit::ml::import_gpt_gguf(gguf);
        std::filesystem::create_directories(out);
        auto path = (std::filesystem::path(out) / "model.hkckpt").string();
        handoffkit::ml::save_gpt(path, model);
        std::cout << "gguf-import ok\narch=" << model.cfg.arch << "\nckpt=" << path
                  << "\nsuccess=true\n";
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "gguf-import failed: " << ex.what() << "\n";
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
    if (args[0] == "gguf-export") return cmd_gguf_export(args);
    if (args[0] == "gguf-import") return cmd_gguf_import(args);
    if (args[0] == "quant-demo") return cmd_quant_demo();

    std::cerr << "handoffkit-ml: unknown command '" << args[0] << "'\n";
    print_help();
    return 2;
}
