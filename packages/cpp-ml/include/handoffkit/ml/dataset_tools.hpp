#pragma once

/// Native dataset hygiene: stats, shuffle, train/val split (SFT JSONL wire).

#include <handoffkit/ml/data.hpp>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

struct DatasetStats {
    int lines = 0;
    int examples = 0;
    std::size_t total_prompt_chars = 0;
    std::size_t total_completion_chars = 0;
    std::size_t max_prompt_chars = 0;
    std::size_t max_completion_chars = 0;
    int empty_completion = 0;
};

inline DatasetStats dataset_stats(const std::string& path) {
    auto ex = load_sft_jsonl(path);
    DatasetStats s;
    s.examples = static_cast<int>(ex.size());
    s.lines = s.examples;
    for (const auto& e : ex) {
        s.total_prompt_chars += e.prompt.size();
        s.total_completion_chars += e.completion.size();
        s.max_prompt_chars = std::max(s.max_prompt_chars, e.prompt.size());
        s.max_completion_chars = std::max(s.max_completion_chars, e.completion.size());
        if (e.completion.empty()) ++s.empty_completion;
    }
    return s;
}

inline void dataset_shuffle(std::vector<SftExample>& ex, int seed = 42) {
    std::mt19937 rng(static_cast<unsigned>(seed));
    std::shuffle(ex.begin(), ex.end(), rng);
}

/// Split into train/val JSONL under out_dir. val_ratio in (0,1).
struct DatasetSplitResult {
    std::string train_path;
    std::string val_path;
    int train_n = 0;
    int val_n = 0;
};

inline DatasetSplitResult dataset_split(const std::string& in_path, const std::string& out_dir,
                                        float val_ratio = 0.2f, int seed = 42, bool shuffle = true) {
    if (val_ratio <= 0.f || val_ratio >= 1.f)
        throw std::runtime_error("val_ratio must be in (0,1)");
    auto ex = load_sft_jsonl(in_path);
    if (ex.size() < 2) throw std::runtime_error("need at least 2 examples to split");
    if (shuffle) dataset_shuffle(ex, seed);
    const int n = static_cast<int>(ex.size());
    int n_val = std::max(1, static_cast<int>(std::lround(static_cast<double>(n) * val_ratio)));
    if (n_val >= n) n_val = n - 1;
    const int n_train = n - n_val;

    namespace fs = std::filesystem;
    fs::create_directories(out_dir);
    DatasetSplitResult r;
    r.train_path = (fs::path(out_dir) / "train.jsonl").string();
    r.val_path = (fs::path(out_dir) / "val.jsonl").string();
    std::vector<SftExample> tr(ex.begin(), ex.begin() + n_train);
    std::vector<SftExample> va(ex.begin() + n_train, ex.end());
    if (!write_sft_jsonl(r.train_path, tr) || !write_sft_jsonl(r.val_path, va))
        throw std::runtime_error("failed writing split jsonl");
    r.train_n = static_cast<int>(tr.size());
    r.val_n = static_cast<int>(va.size());
    return r;
}

}  // namespace ml
}  // namespace handoffkit
