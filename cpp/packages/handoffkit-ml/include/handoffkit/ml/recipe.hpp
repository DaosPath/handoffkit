#pragma once

/// Multi-stage native train recipes (JSON lines of stages). Pure C++ — no Python.

#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/eval.hpp>
#include <handoffkit/ml/model_profile.hpp>
#include <handoffkit/ml/sft.hpp>

#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

struct RecipeStage {
    std::string name{"stage"};
    std::string profile{"comfort"};  // comfort|qlora|standard|…
    int epochs = -1;                 // -1 = profile default
    float lr = -1.f;
    std::string device;  // empty = keep previous / cpu
    bool use_qlora = false;
    bool use_lora = false;
    bool force_qlora = false;  // if true set use_qlora regardless of profile
};

struct RecipeConfig {
    std::string dataset;
    std::string out_dir;
    std::string base_ckpt;  // optional warm-start first stage
    std::string val_dataset;  // optional eval after each stage
    std::vector<RecipeStage> stages;
};

struct RecipeStageResult {
    std::string name;
    SftResult sft;
    EvalResult eval;
    std::string ckpt_path;
};

struct RecipeResult {
    bool success = false;
    std::string error;
    std::vector<RecipeStageResult> stages;
    std::string final_ckpt;
    std::string report_path;
};

namespace recipe_detail {

inline std::string extract_str(const std::string& line, const std::string& key) {
    return detail::extract_json_string(line, key);
}

inline int extract_int(const std::string& line, const std::string& key, int def) {
    auto s = extract_str(line, key);
    if (s.empty()) {
        // bare number without quotes: "epochs": 40
        const std::string pat = "\"" + key + "\"";
        auto pos = line.find(pat);
        if (pos == std::string::npos) return def;
        pos = line.find(':', pos + pat.size());
        if (pos == std::string::npos) return def;
        try {
            return std::stoi(line.substr(pos + 1));
        } catch (...) {
            return def;
        }
    }
    try {
        return std::stoi(s);
    } catch (...) {
        return def;
    }
}

inline float extract_float(const std::string& line, const std::string& key, float def) {
    auto s = extract_str(line, key);
    if (s.empty()) {
        const std::string pat = "\"" + key + "\"";
        auto pos = line.find(pat);
        if (pos == std::string::npos) return def;
        pos = line.find(':', pos + pat.size());
        if (pos == std::string::npos) return def;
        try {
            return std::stof(line.substr(pos + 1));
        } catch (...) {
            return def;
        }
    }
    try {
        return std::stof(s);
    } catch (...) {
        return def;
    }
}

inline bool extract_bool(const std::string& line, const std::string& key, bool def) {
    const std::string pat = "\"" + key + "\"";
    auto pos = line.find(pat);
    if (pos == std::string::npos) return def;
    pos = line.find(':', pos + pat.size());
    if (pos == std::string::npos) return def;
    auto rest = line.substr(pos + 1);
    if (rest.find("true") != std::string::npos) return true;
    if (rest.find("false") != std::string::npos) return false;
    return def;
}

}  // namespace recipe_detail

/// Minimal recipe file format (JSON object per line after header object):
/// {"dataset":"d.jsonl","out_dir":"runs/r","val_dataset":"val.jsonl"}
/// {"stage":"warm","profile":"comfort","epochs":20}
/// {"stage":"adapt","profile":"qlora","epochs":30,"device":"cpu"}
inline RecipeConfig load_recipe_file(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open recipe: " + path);
    RecipeConfig cfg;
    std::string line;
    bool header = true;
    while (std::getline(in, line)) {
        if (line.find_first_not_of(" \t\r\n") == std::string::npos) continue;
        if (header) {
            cfg.dataset = recipe_detail::extract_str(line, "dataset");
            cfg.out_dir = recipe_detail::extract_str(line, "out_dir");
            if (cfg.out_dir.empty()) cfg.out_dir = recipe_detail::extract_str(line, "out");
            cfg.base_ckpt = recipe_detail::extract_str(line, "base_ckpt");
            cfg.val_dataset = recipe_detail::extract_str(line, "val_dataset");
            header = false;
            // Allow single-line recipes that are only a stage if dataset set via CLI
            if (line.find("\"stage\"") != std::string::npos ||
                line.find("\"profile\"") != std::string::npos) {
                RecipeStage st;
                st.name = recipe_detail::extract_str(line, "stage");
                if (st.name.empty()) st.name = recipe_detail::extract_str(line, "name");
                if (st.name.empty()) st.name = "stage0";
                st.profile = recipe_detail::extract_str(line, "profile");
                if (st.profile.empty()) st.profile = "comfort";
                st.epochs = recipe_detail::extract_int(line, "epochs", -1);
                st.lr = recipe_detail::extract_float(line, "lr", -1.f);
                st.device = recipe_detail::extract_str(line, "device");
                st.force_qlora = recipe_detail::extract_bool(line, "qlora", false);
                cfg.stages.push_back(st);
            }
            continue;
        }
        RecipeStage st;
        st.name = recipe_detail::extract_str(line, "stage");
        if (st.name.empty()) st.name = recipe_detail::extract_str(line, "name");
        if (st.name.empty()) st.name = "stage" + std::to_string(cfg.stages.size());
        st.profile = recipe_detail::extract_str(line, "profile");
        if (st.profile.empty()) st.profile = "comfort";
        st.epochs = recipe_detail::extract_int(line, "epochs", -1);
        st.lr = recipe_detail::extract_float(line, "lr", -1.f);
        st.device = recipe_detail::extract_str(line, "device");
        st.force_qlora = recipe_detail::extract_bool(line, "qlora", false) ||
                         recipe_detail::extract_bool(line, "use_qlora", false);
        cfg.stages.push_back(st);
    }
    if (cfg.stages.empty()) throw std::runtime_error("recipe has no stages");
    return cfg;
}

inline RecipeResult run_recipe(RecipeConfig cfg) {
    RecipeResult r;
    namespace fs = std::filesystem;
    try {
        if (cfg.dataset.empty()) throw std::runtime_error("recipe.dataset required");
        if (cfg.out_dir.empty()) throw std::runtime_error("recipe.out_dir required");
        fs::create_directories(cfg.out_dir);
        std::string prev_ckpt = cfg.base_ckpt;
        int i = 0;
        for (const auto& st : cfg.stages) {
            RecipeStageResult sr;
            sr.name = st.name;
            SftConfig sc;
            ModelProfile mp = ModelProfile::Comfort;
            if (!parse_profile_name(st.profile, mp)) {
                throw std::runtime_error("unknown recipe profile: " + st.profile);
            }
            apply_sft_profile(sc, mp);
            if (st.epochs > 0) sc.epochs = st.epochs;
            if (st.lr > 0.f) sc.lr = st.lr;
            if (!st.device.empty()) sc.device = st.device;
            if (st.force_qlora) sc.use_qlora = true;
            if (!prev_ckpt.empty()) {
                sc.base_ckpt = prev_ckpt;
                // Warm-start stages often plateau; still write ckpt if steps ran
                sc.require_loss_drop = false;
            }
            sc.log_every = 0;
            auto stage_out = (fs::path(cfg.out_dir) / ("stage_" + std::to_string(i) + "_" + st.name))
                                 .string();
            sr.sft = sft_train(cfg.dataset, stage_out, sc);
            if (!sr.sft.success) {
                r.error = "stage " + st.name + " failed: " + sr.sft.error;
                r.stages.push_back(sr);
                return r;
            }
            sr.ckpt_path = sr.sft.ckpt_path;
            prev_ckpt = sr.ckpt_path;
            if (!cfg.val_dataset.empty()) {
                EvalConfig ec;
                ec.tokenizer = sc.tokenizer;
                ec.block_size = sc.block_size;
                sr.eval = eval_ckpt_on_jsonl(sr.ckpt_path, cfg.val_dataset, ec);
            }
            r.stages.push_back(sr);
            ++i;
        }
        r.final_ckpt = prev_ckpt;
        r.report_path = (fs::path(cfg.out_dir) / "recipe_report.json").string();
        {
            std::ofstream rep(r.report_path);
            rep << "{\n  \"success\": true,\n  \"final_ckpt\": \"" << r.final_ckpt << "\",\n"
                << "  \"stages\": [\n";
            for (std::size_t si = 0; si < r.stages.size(); ++si) {
                const auto& s = r.stages[si];
                rep << "    {\"name\": \"" << s.name << "\", \"ckpt\": \"" << s.ckpt_path
                    << "\", \"final_loss\": " << s.sft.final_loss
                    << ", \"eval_loss\": " << (s.eval.success ? s.eval.mean_loss : -1.f) << "}";
                if (si + 1 < r.stages.size()) rep << ",";
                rep << "\n";
            }
            rep << "  ]\n}\n";
        }
        r.success = true;
    } catch (const std::exception& ex) {
        r.success = false;
        r.error = ex.what();
    }
    return r;
}

}  // namespace ml
}  // namespace handoffkit
