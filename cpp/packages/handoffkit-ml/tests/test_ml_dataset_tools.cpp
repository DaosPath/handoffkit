#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/dataset_tools.hpp>

#include <filesystem>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;
    const auto dir = fs::current_path() / "test_artifacts_dataset_tools";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    const auto ds = (dir / "all.jsonl").string();
    std::vector<SftExample> ex = {
        {"a", "1"}, {"b", "2"}, {"c", "3"}, {"d", "4"}, {"e", "5"},
    };
    if (!write_sft_jsonl(ds, ex)) return 1;
    auto st = dataset_stats(ds);
    if (st.examples != 5) {
        std::cerr << "stats examples=" << st.examples << "\n";
        return 1;
    }
    auto sp = dataset_split(ds, (dir / "split").string(), 0.4f, 7, true);
    std::cout << "split train_n=" << sp.train_n << " val_n=" << sp.val_n << "\n";
    if (sp.train_n + sp.val_n != 5 || sp.val_n < 1 || sp.train_n < 1) {
        std::cerr << "bad split sizes\n";
        return 1;
    }
    auto tr = load_sft_jsonl(sp.train_path);
    auto va = load_sft_jsonl(sp.val_path);
    if (static_cast<int>(tr.size()) != sp.train_n || static_cast<int>(va.size()) != sp.val_n) {
        std::cerr << "reload mismatch\n";
        return 1;
    }
    std::cout << "test_ml_dataset_tools ok\n";
    return 0;
}
