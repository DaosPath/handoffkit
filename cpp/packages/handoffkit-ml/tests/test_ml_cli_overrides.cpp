// Regression: resume-config then --epochs / --profile qlora must honor CLI last.

#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/sft.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_cli_overrides";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "data.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", " A"}, {"P:", " A"}})) return 1;

    SftConfig c1;
    apply_sft_profile(c1, ModelProfile::Comfort);
    c1.epochs = 12;
    c1.log_every = 0;
    auto r1 = sft_train(ds, (dir / "s1").string(), c1);
    if (!r1.success) {
        std::cerr << "s1 failed " << r1.error << "\n";
        return 1;
    }
    const auto cfgj = (dir / "s1" / "sft_config.json").string();

    // Case A: resume + explicit epochs=3 must yield epochs=3 (not file's 12/20)
    SftConfig ca;
    SftCliOverrides oa;
    oa.resume_config = cfgj;
    oa.epochs = 3;
    apply_sft_cli_overrides(ca, oa);
    std::cout << "caseA epochs=" << ca.epochs << " n_embd=" << ca.n_embd
              << " base=" << (ca.base_ckpt.empty() ? "empty" : "set")
              << " qlora=" << ca.use_qlora << "\n";
    if (ca.epochs != 3) {
        std::cerr << "epochs override lost: " << ca.epochs << "\n";
        return 1;
    }
    if (ca.n_embd != 64 || ca.base_ckpt.empty()) {
        std::cerr << "resume dims/base lost\n";
        return 1;
    }
    if (ca.use_qlora) {
        std::cerr << "unexpected qlora from comfort resume alone\n";
        return 1;
    }

    // Case B: resume + profile qlora → keep dims/base, set use_qlora
    SftConfig cb;
    SftCliOverrides ob;
    ob.resume_config = cfgj;
    ob.profile = "qlora";
    ob.epochs = 5;
    apply_sft_cli_overrides(cb, ob);
    std::cout << "caseB epochs=" << cb.epochs << " n_embd=" << cb.n_embd
              << " qlora=" << cb.use_qlora << " profile=" << cb.profile << "\n";
    if (cb.epochs != 5 || !cb.use_qlora || cb.n_embd != 64 || cb.base_ckpt.empty()) {
        std::cerr << "resume+profile qlora merge wrong\n";
        return 1;
    }

    // Case C: end-to-end train with merged config (short)
    cb.log_every = 0;
    cb.require_loss_drop = false;
    auto r2 = sft_train(ds, (dir / "s2").string(), cb);
    if (!r2.success) {
        std::cerr << "s2 failed " << r2.error << "\n";
        return 1;
    }
    std::ifstream rep(r2.report_path);
    std::string body((std::istreambuf_iterator<char>(rep)), std::istreambuf_iterator<char>());
    if (body.find("\"use_qlora\": true") == std::string::npos) {
        std::cerr << "s2 report not qlora\n" << body << "\n";
        return 1;
    }
    std::cout << "test_ml_cli_overrides ok\n";
    return 0;
}
