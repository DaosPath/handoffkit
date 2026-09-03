#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/recipe.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_recipe";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "data.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", " MARK42"}, {"P:", " MARK42"}, {"Hi ", "YES"}})) return 1;
    const auto recipe = (dir / "r.jsonl").string();
    {
        std::ofstream o(recipe);
        o << "{\"dataset\":\"" << ds << "\",\"out_dir\":\"" << (dir / "run").string()
          << "\",\"val_dataset\":\"" << ds << "\"}\n";
        o << "{\"stage\":\"warm\",\"profile\":\"comfort\",\"epochs\":15}\n";
        o << "{\"stage\":\"adapt\",\"profile\":\"qlora\",\"epochs\":15}\n";
    }
    // Fix path escaping for Windows backslashes in JSON — write with forward slashes
    {
        auto esc = [](std::string p) {
            for (char& c : p)
                if (c == '\\') c = '/';
            return p;
        };
        std::ofstream o(recipe);
        o << "{\"dataset\":\"" << esc(ds) << "\",\"out_dir\":\"" << esc((dir / "run").string())
          << "\",\"val_dataset\":\"" << esc(ds) << "\"}\n";
        o << "{\"stage\":\"warm\",\"profile\":\"comfort\",\"epochs\":12}\n";
        o << "{\"stage\":\"adapt\",\"profile\":\"qlora\",\"epochs\":12}\n";
    }

    auto cfg = load_recipe_file(recipe);
    if (cfg.stages.size() != 2) {
        std::cerr << "stages=" << cfg.stages.size() << "\n";
        return 1;
    }
    auto r = run_recipe(cfg);
    std::cout << "recipe success=" << (r.success ? "true" : "false") << " err=" << r.error
              << " stages=" << r.stages.size() << "\n";
    if (!r.success) {
        std::cerr << "recipe failed: " << r.error << "\n";
        return 1;
    }
    if (r.stages.size() != 2 || r.final_ckpt.empty()) return 1;
    if (!r.stages[0].sft.success || !r.stages[1].sft.success) return 1;
    if (!r.stages[0].eval.success) {
        std::cerr << "eval missing on stage0\n";
        return 1;
    }
    std::cout << "stage0 loss=" << r.stages[0].sft.final_loss
              << " eval=" << r.stages[0].eval.mean_loss << "\n";
    std::cout << "stage1 loss=" << r.stages[1].sft.final_loss << "\n";
    std::cout << "test_ml_recipe ok\n";
    return 0;
}
