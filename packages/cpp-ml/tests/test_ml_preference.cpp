// Preference SFT via shipped sft_train + report fields + dataset stats.

#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/dataset_tools.hpp>
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
    const auto dir = fs::current_path() / "test_artifacts_pref";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "pref.jsonl").string();
    // Preference-shaped JSONL (chosen/rejected); completion optional
    std::vector<SftExample> ex = {
        {"Prefer: ", "", "yes", "no"},
        {"Prefer: ", "", "yes", "no"},
        {"Pick: ", "", "good", "bad"},
        {"Pick: ", "", "good", "bad"},
    };
    if (!write_sft_jsonl(ds, ex)) {
        std::cerr << "write failed " << ds << "\n";
        return 1;
    }
    auto st = dataset_stats(ds);
    if (st.preference_pairs < 4) {
        std::cerr << "stats preference_pairs=" << st.preference_pairs << "\n";
        return 1;
    }
    std::cout << "preference_pairs=" << st.preference_pairs << "\n";

    SftConfig cfg;
    apply_sft_profile(cfg, ModelProfile::Comfort);
    cfg.epochs = 25;
    cfg.preference = true;
    cfg.dpo_beta = 0.2f;
    cfg.lr = 1e-2f;
    cfg.log_every = 0;
    auto r = sft_train(ds, (dir / "out").string(), cfg);
    std::cout << "preference initial=" << r.initial_loss << " final=" << r.final_loss
              << " success=" << (r.success ? "true" : "false") << " err=" << r.error << "\n";
    if (!r.success) {
        std::cerr << r.error << "\n";
        return 1;
    }
    if (!(r.final_loss < r.initial_loss)) {
        std::cerr << "loss did not drop\n";
        return 1;
    }
    if (!fs::exists(r.ckpt_path)) {
        std::cerr << "missing ckpt\n";
        return 1;
    }
    std::ifstream rep(r.report_path);
    std::string body((std::istreambuf_iterator<char>(rep)), std::istreambuf_iterator<char>());
    if (body.find("\"preference\": true") == std::string::npos) {
        std::cerr << "report missing preference true:\n" << body << "\n";
        return 1;
    }
    std::cout << "test_ml_preference ok\n";
    return 0;
}
