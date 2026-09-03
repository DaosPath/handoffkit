#include <handoffkit/ml/ckpt.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/dataset_tools.hpp>
#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/dist.hpp>
#include <handoffkit/ml/eval.hpp>
#include <handoffkit/ml/gguf.hpp>
#include <handoffkit/ml/kernels.hpp>
#include <handoffkit/ml/ml.hpp>
#include <handoffkit/ml/model_profile.hpp>
#include <handoffkit/ml/quant.hpp>
#include <handoffkit/ml/recipe.hpp>
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
        << "      --profile comfort|qlora|standard|large|tiny\n"
        << "      --epochs N --lr F --n-embd N --n-layer N --n-head N --block-size N\n"
        << "      --arch gpt2|llama-like|gpt-mini --tokenizer bpe|byte\n"
        << "      --lora | --qlora | --lora-rank N | --preference [--dpo-beta F]\n"
        << "      --world-size N --allow-tiny\n"
        << "         preference JSONL: prompt + chosen + rejected (completion optional)\n"
        << "      --log-every N\n"
        << "      --gguf BASE.gguf | --base-ckpt model.hkckpt | --resume-config sft_config.json\n"
        << "      --device cpu|cuda|cuda-resident\n"
        << "         cuda = GPU GEMM; cuda-resident = full-weight GPU (not LoRA/QLoRA)\n"
        << "  handoffkit-ml generate --ckpt PATH --prompt TEXT [--max-new N] [--temperature F]\n"
        << "      [--top-k N] [--top-p F] [--bpe PATH]\n"
        << "  handoffkit-ml eval --ckpt PATH --dataset PATH [--out DIR] [--report PATH]\n"
        << "      [--block-size N] [--tokenizer byte|bpe]\n"
        << "  handoffkit-ml dataset stats --dataset PATH\n"
        << "  handoffkit-ml dataset split --dataset PATH --out DIR [--val-ratio 0.2] [--seed N]\n"
        << "  handoffkit-ml recipe --file recipe.jsonl [--dataset PATH] [--out DIR]\n"
        << "  handoffkit-ml gguf-export --ckpt PATH --out model.gguf\n"
        << "  handoffkit-ml gguf-import --gguf PATH --out DIR\n"
        << "  handoffkit-ml quant-demo\n\n"
        << "Native train toolkit (ecosystem — pure C++):\n"
        << "  handoffkit-ml sft --dataset d.jsonl --out runs/sft --profile comfort\n"
        << "  handoffkit-ml sft --dataset d.jsonl --out runs/qlora --profile qlora\n"
        << "  handoffkit-ml dataset split --dataset all.jsonl --out data/ --val-ratio 0.2\n"
        << "  handoffkit-ml eval --ckpt runs/qlora/model.hkckpt --dataset data/val.jsonl\n"
        << "  handoffkit-ml recipe --file my.recipe.jsonl\n"
        << "  handoffkit-ml generate --ckpt runs/qlora/model.hkckpt --prompt \"P:\" --max-new 16\n\n"
        << "Profiles: comfort|qlora|standard|large|tiny. Flags after --profile override.\n"
        << "Native best-in-ecosystem ≠ Unsloth/HF 1B+ SOTA (see NONGOALS.md / NATIVE_TRAIN.md).\n"
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
              << "cap.qlora=true\n"
              << "cap.cuda=" << (cap.cuda ? "true" : "false") << "\n"
              << "cap.preference=" << (cap.preference ? "true" : "false") << "\n"
              << "kernel.backend=" << ker.name << "\n"
              << "kernel.cpu_threads=" << ker.cpu_threads << "\n"
              << "kernel.cuda_runtime=" << (ker.cuda_runtime ? "true" : "false") << "\n"
              << "cuda.policy=own_kernels_cudart_only\n"
              << "cuda.no_cublas=true\n"
              << "cuda.resident=weights+activations (sft --device cuda-resident)\n"
              << "profile.list=comfort,qlora,standard,large,tiny\n"
              << "profile.standard.n_embd=" << stdp.n_embd << "\n"
              << "profile.standard.n_layer=" << stdp.n_layer << "\n"
              << "profile.comfort.n_embd=64\n"
              << "profile.qlora.n_embd=64\n"
              << "scale.native=small_student_only\n"
              << "scale.not=4B_or_Unsloth_HF_SOTA\n"
              << "features.top_k_top_p=true\n"
              << "features.resume_config=true\n"
              << "features.eval_report=true\n"
              << "features.preference=true\n"
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
    handoffkit::ml::SftCliOverrides ov;
    // Precedence (shipped): resume dims/base → profile knobs → explicit CLI last.
    ov.resume_config = flag_val(args, "--resume-config");
    ov.profile = flag_val(args, "--profile");
    if (auto e = flag_val(args, "--epochs"); !e.empty()) ov.epochs = std::stoi(e);
    if (auto lr = flag_val(args, "--lr"); !lr.empty()) ov.lr = std::stof(lr);
    if (auto b = flag_val(args, "--block-size"); !b.empty()) ov.block_size = std::stoi(b);
    if (auto n = flag_val(args, "--n-embd"); !n.empty()) ov.n_embd = std::stoi(n);
    if (auto n = flag_val(args, "--n-layer"); !n.empty()) ov.n_layer = std::stoi(n);
    if (auto n = flag_val(args, "--n-head"); !n.empty()) ov.n_head = std::stoi(n);
    ov.arch = flag_val(args, "--arch");
    ov.tokenizer = flag_val(args, "--tokenizer");
    ov.device = flag_val(args, "--device");
    ov.base_ckpt = flag_val(args, "--base-ckpt");
    if (ov.base_ckpt.empty()) ov.base_ckpt = flag_val(args, "--ckpt");
    ov.base_gguf = flag_val(args, "--gguf");
    if (auto le = flag_val(args, "--log-every"); !le.empty()) ov.log_every = std::stoi(le);
    if (auto rk = flag_val(args, "--lora-rank"); !rk.empty()) ov.lora_rank = std::stoi(rk);
    ov.use_lora = has_flag(args, "--lora");
    ov.use_qlora = has_flag(args, "--qlora");
    ov.preference = has_flag(args, "--preference");
    if (auto db = flag_val(args, "--dpo-beta"); !db.empty()) ov.dpo_beta = std::stof(db);
    ov.allow_tiny = has_flag(args, "--allow-tiny");
    ov.bare_qlora_profile = has_flag(args, "--qlora") && ov.profile.empty() &&
                            ov.resume_config.empty() && ov.n_embd < 0 && ov.n_layer < 0 &&
                            !has_flag(args, "--allow-tiny");
    ov.force_require_loss_drop = has_flag(args, "--require-loss-drop");
    if (auto b = flag_val(args, "--bpe"); !b.empty()) cfg.bpe_path = b;
    if (auto w = flag_val(args, "--world-size"); !w.empty()) cfg.world_size = std::stoi(w);

    try {
        handoffkit::ml::apply_sft_cli_overrides(cfg, ov);
    } catch (const std::exception& ex) {
        std::cerr << "sft config error: " << ex.what() << "\n";
        return 2;
    }

    std::cout << "sft start profile=" << cfg.profile
              << " qlora=" << (cfg.use_qlora ? "true" : "false")
              << " n_embd=" << cfg.n_embd << " n_layer=" << cfg.n_layer
              << " epochs=" << cfg.epochs << " lr=" << cfg.lr
              << " device=" << cfg.device << "\n"
              << std::flush;

    auto r = handoffkit::ml::sft_train(ds, out, cfg);
    if (!r.success) {
        std::cerr << "sft failed: " << r.error << "\n";
        return 1;
    }
    std::cout << "sft ok\n"
              << "profile=" << cfg.profile << "\n"
              << "initial_loss=" << r.initial_loss << "\n"
              << "final_loss=" << r.final_loss << "\n"
              << "steps=" << r.steps << "\n"
              << "loss_dropped=" << (r.final_loss < r.initial_loss ? "true" : "false") << "\n"
              << "use_qlora=" << (cfg.use_qlora ? "true" : "false") << "\n"
              << "use_lora=" << (cfg.use_lora ? "true" : "false") << "\n"
              << "preference=" << (cfg.preference ? "true" : "false") << "\n"
              << "lora_rank=" << cfg.lora_rank << "\n"
              << "device=" << cfg.device << "\n"
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
        if (auto k = flag_val(args, "--top-k"); !k.empty()) go.top_k = std::stoi(k);
        if (auto pp = flag_val(args, "--top-p"); !pp.empty()) go.top_p = std::stof(pp);
        if (auto b = flag_val(args, "--bpe"); !b.empty()) {
            go.bpe_path = b;
            go.tokenizer = handoffkit::ml::TokenizerKind::Bpe;
        } else if (model.cfg.vocab_size <= 300) {
            go.tokenizer = handoffkit::ml::TokenizerKind::Byte;
        }
        std::mt19937 rng(42);
        if (auto s = flag_val(args, "--seed"); !s.empty())
            rng.seed(static_cast<unsigned>(std::stoul(s)));
        std::string cont;
        std::string text =
            handoffkit::ml::generate_text(model, p, max_new, temp, &rng, &cont, &go);
        std::cout << "generate ok\n"
                  << "prompt=" << p << "\n"
                  << "temperature=" << go.temperature << "\n"
                  << "top_k=" << go.top_k << "\n"
                  << "top_p=" << go.top_p << "\n"
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

int cmd_eval(const std::vector<std::string>& args) {
    const std::string ckpt = flag_val(args, "--ckpt");
    const std::string ds = flag_val(args, "--dataset");
    if (ckpt.empty() || ds.empty()) {
        std::cerr << "eval requires --ckpt PATH and --dataset PATH\n";
        return 2;
    }
    handoffkit::ml::EvalConfig cfg;
    if (auto b = flag_val(args, "--block-size"); !b.empty()) cfg.block_size = std::stoi(b);
    if (auto t = flag_val(args, "--tokenizer"); !t.empty()) {
        cfg.tokenizer = (t == "byte") ? handoffkit::ml::TokenizerKind::Byte
                                      : handoffkit::ml::TokenizerKind::Bpe;
    } else {
        cfg.tokenizer = handoffkit::ml::TokenizerKind::Byte;
    }
    if (auto b = flag_val(args, "--bpe"); !b.empty()) cfg.bpe_path = b;
    if (auto o = flag_val(args, "--out"); !o.empty()) cfg.out_dir = o;
    if (auto rp = flag_val(args, "--report"); !rp.empty()) cfg.report_path = rp;
    // Default durable report next to ckpt or under --out
    if (cfg.report_path.empty() && cfg.out_dir.empty()) {
        namespace fs = std::filesystem;
        cfg.out_dir = (fs::path(ckpt).parent_path() / "eval").string();
    }
    auto r = handoffkit::ml::eval_ckpt_on_jsonl(ckpt, ds, cfg);
    if (!r.success) {
        std::cerr << "eval failed: " << r.error << "\n";
        return 1;
    }
    std::cout << "eval ok\n"
              << "mean_loss=" << r.mean_loss << "\n"
              << "perplexity=" << r.perplexity << "\n"
              << "examples=" << r.examples << "\n"
              << "tokens=" << r.tokens << "\n"
              << "ckpt_path=" << r.ckpt_path << "\n"
              << "dataset_path=" << r.dataset_path << "\n"
              << "report_path=" << r.report_path << "\n"
              << "success=true\n";
    return 0;
}

int cmd_dataset(const std::vector<std::string>& args) {
    // dataset stats|split ...
    std::string sub = (args.size() >= 2) ? args[1] : "stats";
    if (sub == "stats") {
        const std::string ds = flag_val(args, "--dataset");
        if (ds.empty()) {
            std::cerr << "dataset stats requires --dataset PATH\n";
            return 2;
        }
        try {
            auto s = handoffkit::ml::dataset_stats(ds);
            const double ap =
                s.examples ? static_cast<double>(s.total_prompt_chars) / s.examples : 0.0;
            const double ac =
                s.examples ? static_cast<double>(s.total_completion_chars) / s.examples : 0.0;
            std::cout << "dataset stats ok\n"
                      << "examples=" << s.examples << "\n"
                      << "avg_prompt_chars=" << ap << "\n"
                      << "avg_completion_chars=" << ac << "\n"
                      << "max_prompt_chars=" << s.max_prompt_chars << "\n"
                      << "max_completion_chars=" << s.max_completion_chars << "\n"
                      << "empty_completion=" << s.empty_completion << "\n"
                      << "preference_pairs=" << s.preference_pairs << "\n"
                      << "success=true\n";
            return 0;
        } catch (const std::exception& ex) {
            std::cerr << "dataset stats failed: " << ex.what() << "\n";
            return 1;
        }
    }
    if (sub == "split") {
        const std::string ds = flag_val(args, "--dataset");
        const std::string out = flag_val(args, "--out");
        if (ds.empty() || out.empty()) {
            std::cerr << "dataset split requires --dataset PATH and --out DIR\n";
            return 2;
        }
        float vr = 0.2f;
        if (auto v = flag_val(args, "--val-ratio"); !v.empty()) vr = std::stof(v);
        int seed = 42;
        if (auto s = flag_val(args, "--seed"); !s.empty()) seed = std::stoi(s);
        try {
            auto r = handoffkit::ml::dataset_split(ds, out, vr, seed, true);
            std::cout << "dataset split ok\n"
                      << "train_path=" << r.train_path << "\n"
                      << "val_path=" << r.val_path << "\n"
                      << "train_n=" << r.train_n << "\n"
                      << "val_n=" << r.val_n << "\n"
                      << "success=true\n";
            return 0;
        } catch (const std::exception& ex) {
            std::cerr << "dataset split failed: " << ex.what() << "\n";
            return 1;
        }
    }
    std::cerr << "dataset subcommand must be stats|split\n";
    return 2;
}

int cmd_recipe(const std::vector<std::string>& args) {
    const std::string file = flag_val(args, "--file");
    if (file.empty()) {
        std::cerr << "recipe requires --file PATH\n";
        return 2;
    }
    try {
        auto cfg = handoffkit::ml::load_recipe_file(file);
        if (auto d = flag_val(args, "--dataset"); !d.empty()) cfg.dataset = d;
        if (auto o = flag_val(args, "--out"); !o.empty()) cfg.out_dir = o;
        if (auto v = flag_val(args, "--val-dataset"); !v.empty()) cfg.val_dataset = v;
        if (auto b = flag_val(args, "--base-ckpt"); !b.empty()) cfg.base_ckpt = b;
        auto r = handoffkit::ml::run_recipe(cfg);
        if (!r.success) {
            std::cerr << "recipe failed: " << r.error << "\n";
            return 1;
        }
        std::cout << "recipe ok\n"
                  << "stages=" << r.stages.size() << "\n"
                  << "final_ckpt=" << r.final_ckpt << "\n"
                  << "report_path=" << r.report_path << "\n";
        for (const auto& s : r.stages) {
            std::cout << "stage name=" << s.name << " final_loss=" << s.sft.final_loss
                      << " ckpt=" << s.ckpt_path;
            if (s.eval.success) std::cout << " eval_loss=" << s.eval.mean_loss;
            std::cout << "\n";
        }
        std::cout << "success=true\n";
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "recipe failed: " << ex.what() << "\n";
        return 1;
    }
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
    if (args[0] == "eval") return cmd_eval(args);
    if (args[0] == "dataset") return cmd_dataset(args);
    if (args[0] == "recipe") return cmd_recipe(args);
    if (args[0] == "gguf-export") return cmd_gguf_export(args);
    if (args[0] == "gguf-import") return cmd_gguf_import(args);
    if (args[0] == "quant-demo") return cmd_quant_demo();

    std::cerr << "handoffkit-ml: unknown command '" << args[0] << "'\n";
    print_help();
    return 2;
}
