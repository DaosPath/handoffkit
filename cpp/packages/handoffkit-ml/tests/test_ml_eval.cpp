#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/eval.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_eval";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "data.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", " MARK42"}, {"P:", " MARK42"}, {"Hi ", "YES"}})) {
        std::cerr << "write failed\n";
        return 1;
    }
    SftConfig cfg;
    apply_sft_profile(cfg, ModelProfile::Comfort);
    cfg.epochs = 30;
    cfg.log_every = 0;
    auto tr = sft_train(ds, (dir / "out").string(), cfg);
    if (!tr.success) {
        std::cerr << "sft failed " << tr.error << "\n";
        return 1;
    }
    EvalConfig ecfg;
    ecfg.tokenizer = TokenizerKind::Byte;
    ecfg.block_size = cfg.block_size;
    ecfg.out_dir = (dir / "eval_out").string();
    auto ev = eval_ckpt_on_jsonl(tr.ckpt_path, ds, ecfg);
    std::cout << "eval mean_loss=" << ev.mean_loss << " ppl=" << ev.perplexity
              << " tokens=" << ev.tokens << " report=" << ev.report_path << "\n";
    if (!ev.success) {
        std::cerr << "eval failed: " << ev.error << "\n";
        return 1;
    }
    if (ev.tokens < 1 || !std::isfinite(ev.mean_loss) || !std::isfinite(ev.perplexity)) {
        std::cerr << "bad metrics\n";
        return 1;
    }
    if (ev.mean_loss > 20.f) {
        std::cerr << "eval loss too high\n";
        return 1;
    }
    if (ev.report_path.empty() || !fs::exists(ev.report_path)) {
        std::cerr << "missing eval_report.json\n";
        return 1;
    }
    std::ifstream rep(ev.report_path);
    std::string body((std::istreambuf_iterator<char>(rep)), std::istreambuf_iterator<char>());
    if (body.find("\"mean_loss\"") == std::string::npos ||
        body.find("\"perplexity\"") == std::string::npos ||
        body.find("\"tokens\"") == std::string::npos) {
        std::cerr << "report missing keys:\n" << body << "\n";
        return 1;
    }
    std::cout << "test_ml_eval ok\n";
    return 0;
}
