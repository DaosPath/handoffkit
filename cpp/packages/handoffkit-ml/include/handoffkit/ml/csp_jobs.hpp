#pragma once

#include <handoffkit/csp/contracts.hpp>
#include <handoffkit/ml/eval.hpp>
#include <handoffkit/ml/sft.hpp>

#include <string>
#include <string_view>
#include <stdexcept>
#include <utility>

namespace handoffkit::ml {

struct TrainingJobAdapter {
    SftConfig config;
    std::string dataset_path;
    std::string output_dir;
};

struct EvaluationJobAdapter {
    EvalConfig config;
    std::string model_path;
    std::string dataset_path;
};

inline std::string local_uri_path(const std::string& uri) {
    constexpr std::string_view file_prefix = "file://";
    if (uri.starts_with(file_prefix)) {
        auto path = uri.substr(file_prefix.size());
#ifdef _WIN32
        if (path.size() >= 3 && path[0] == '/' && path[2] == ':') path.erase(path.begin());
#endif
        return path;
    }
    return uri;
}

inline std::string artifact_path(const csp::ArtifactRef& artifact) {
    return local_uri_path(artifact.uri);
}

inline TrainingJobAdapter adapt_training_job(const csp::TrainingJob& job) {
    TrainingJobAdapter adapted;
    adapted.dataset_path = artifact_path(job.dataset);
    adapted.output_dir = local_uri_path(job.output);
    const auto& config = job.config;
    adapted.config.epochs = config.value("epochs", adapted.config.epochs);
    adapted.config.block_size = config.value("block_size", adapted.config.block_size);
    adapted.config.n_embd = config.value("n_embd", adapted.config.n_embd);
    adapted.config.n_head = config.value("n_head", adapted.config.n_head);
    adapted.config.n_layer = config.value("n_layer", adapted.config.n_layer);
    adapted.config.lr = config.value("lr", adapted.config.lr);
    adapted.config.seed = config.value("seed", adapted.config.seed);
    adapted.config.device = config.value("device", adapted.config.device);
    adapted.config.profile = config.value("profile", adapted.config.profile);
    adapted.config.use_lora = config.value("use_lora", adapted.config.use_lora);
    adapted.config.use_qlora = config.value("use_qlora", adapted.config.use_qlora);
    adapted.config.allow_tiny = config.value("allow_tiny", adapted.config.allow_tiny);
    adapted.config.require_loss_drop =
        config.value("require_loss_drop", adapted.config.require_loss_drop);
    adapted.config.log_every = config.value("log_every", adapted.config.log_every);
    const auto tokenizer = config.value("tokenizer", std::string{"bpe"});
    if (tokenizer == "byte") adapted.config.tokenizer = TokenizerKind::Byte;
    else if (tokenizer != "bpe") throw std::invalid_argument("unsupported tokenizer: " + tokenizer);
    return adapted;
}

inline EvaluationJobAdapter adapt_evaluation_job(const csp::EvaluationJob& job) {
    EvaluationJobAdapter adapted;
    adapted.model_path = artifact_path(job.model);
    adapted.dataset_path = artifact_path(job.dataset);
    adapted.config.block_size = job.config.value("block_size", adapted.config.block_size);
    adapted.config.allow_empty = job.config.value("allow_empty", adapted.config.allow_empty);
    const auto tokenizer = job.config.value("tokenizer", std::string{"byte"});
    if (tokenizer == "bpe") adapted.config.tokenizer = TokenizerKind::Bpe;
    else if (tokenizer != "byte") throw std::invalid_argument("unsupported tokenizer: " + tokenizer);
    adapted.config.bpe_path = job.config.value("bpe_path", adapted.config.bpe_path);
    adapted.config.out_dir = local_uri_path(job.output);
    return adapted;
}

inline csp::JobProgress make_job_progress(
    std::string job_id,
    std::string phase,
    std::string status,
    std::uint64_t step,
    std::uint64_t total_steps,
    double loss,
    std::string timestamp
) {
    csp::JobProgress progress;
    progress.job_id = std::move(job_id);
    progress.phase = std::move(phase);
    progress.status = std::move(status);
    progress.step = step;
    progress.total_steps = total_steps;
    progress.progress = total_steps == 0 ? 0.0 : static_cast<double>(step) / static_cast<double>(total_steps);
    progress.loss = loss;
    progress.timestamp = std::move(timestamp);
    return progress;
}

}  // namespace handoffkit::ml
