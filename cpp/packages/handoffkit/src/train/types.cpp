#include <handoffkit/train/types.hpp>

namespace handoffkit {
namespace train {

std::string example_format_to_string(ExampleFormat f) {
    switch (f) {
        case ExampleFormat::PromptCompletion: return "prompt_completion";
        case ExampleFormat::Messages: return "messages";
        case ExampleFormat::Preference: return "preference";
    }
    return "prompt_completion";
}

Result<ExampleFormat> example_format_from_string(std::string_view s) {
    if (s == "prompt_completion" || s == "sft") return ExampleFormat::PromptCompletion;
    if (s == "messages") return ExampleFormat::Messages;
    if (s == "preference" || s == "dpo") return ExampleFormat::Preference;
    return Error::invalid_argument("unknown example format: " + std::string(s), "format");
}

bool TrainExample::empty() const {
    switch (format) {
        case ExampleFormat::PromptCompletion:
            return prompt.empty() && completion.empty();
        case ExampleFormat::Messages:
            return messages.empty() || !messages.is_array();
        case ExampleFormat::Preference:
            return prompt.empty() || chosen.empty();
    }
    return true;
}

nlohmann::json TrainExample::to_json() const {
    nlohmann::json j{{"format", example_format_to_string(format)}, {"meta", meta}};
    switch (format) {
        case ExampleFormat::PromptCompletion:
            j["prompt"] = prompt;
            j["completion"] = completion;
            break;
        case ExampleFormat::Messages:
            j["messages"] = messages;
            break;
        case ExampleFormat::Preference:
            j["prompt"] = prompt;
            j["chosen"] = chosen;
            j["rejected"] = rejected;
            break;
    }
    return j;
}

Result<TrainExample> TrainExample::from_json(const nlohmann::json& j) {
    TrainExample ex;
    if (j.contains("format") && j["format"].is_string()) {
        auto f = example_format_from_string(j["format"].get<std::string>());
        if (!f) return f.error();
        ex.format = f.value();
    } else if (j.contains("messages")) {
        ex.format = ExampleFormat::Messages;
    } else if (j.contains("chosen")) {
        ex.format = ExampleFormat::Preference;
    } else {
        ex.format = ExampleFormat::PromptCompletion;
    }
    if (j.contains("prompt") && j["prompt"].is_string()) ex.prompt = j["prompt"].get<std::string>();
    if (j.contains("completion") && j["completion"].is_string())
        ex.completion = j["completion"].get<std::string>();
    if (j.contains("messages")) ex.messages = j["messages"];
    if (j.contains("chosen") && j["chosen"].is_string()) ex.chosen = j["chosen"].get<std::string>();
    if (j.contains("rejected") && j["rejected"].is_string())
        ex.rejected = j["rejected"].get<std::string>();
    if (j.contains("meta") && j["meta"].is_object()) ex.meta = j["meta"];
    return ex;
}

nlohmann::json Dataset::to_json() const {
    return nlohmann::json{
        {"id", id},
        {"path", path.string()},
        {"format", example_format_to_string(format)},
        {"count", count},
        {"content_hash", content_hash},
        {"meta", meta},
    };
}

Result<Dataset> Dataset::from_json(const nlohmann::json& j) {
    Dataset d;
    if (j.contains("id") && j["id"].is_string()) d.id = j["id"].get<std::string>();
    if (j.contains("path") && j["path"].is_string()) d.path = j["path"].get<std::string>();
    if (j.contains("format") && j["format"].is_string()) {
        auto f = example_format_from_string(j["format"].get<std::string>());
        if (!f) return f.error();
        d.format = f.value();
    }
    if (j.contains("count")) d.count = j["count"].get<std::size_t>();
    if (j.contains("content_hash") && j["content_hash"].is_string())
        d.content_hash = j["content_hash"].get<std::string>();
    if (j.contains("meta") && j["meta"].is_object()) d.meta = j["meta"];
    return d;
}

nlohmann::json TrainConfig::to_json() const {
    return nlohmann::json{
        {"base_model", base_model},
        {"epochs", epochs},
        {"learning_rate", learning_rate},
        {"max_steps", max_steps},
        {"seed", seed},
        {"output_dir", output_dir.string()},
        {"backend_id", backend_id},
        {"extra_args", extra_args},
        {"meta", meta},
    };
}

Result<TrainConfig> TrainConfig::from_json(const nlohmann::json& j) {
    TrainConfig c;
    if (j.contains("base_model") && j["base_model"].is_string())
        c.base_model = j["base_model"].get<std::string>();
    if (j.contains("epochs")) c.epochs = j["epochs"].get<int>();
    if (j.contains("learning_rate")) c.learning_rate = j["learning_rate"].get<double>();
    if (j.contains("max_steps")) c.max_steps = j["max_steps"].get<int>();
    if (j.contains("seed")) c.seed = j["seed"].get<int>();
    if (j.contains("output_dir") && j["output_dir"].is_string())
        c.output_dir = j["output_dir"].get<std::string>();
    if (j.contains("backend_id") && j["backend_id"].is_string())
        c.backend_id = j["backend_id"].get<std::string>();
    if (j.contains("extra_args") && j["extra_args"].is_array()) {
        for (const auto& a : j["extra_args"]) {
            if (a.is_string()) c.extra_args.push_back(a.get<std::string>());
        }
    }
    if (j.contains("meta") && j["meta"].is_object()) c.meta = j["meta"];
    return c;
}

nlohmann::json TrainMetrics::to_json() const {
    return nlohmann::json{
        {"loss_per_epoch", loss_per_epoch},
        {"final_loss", final_loss},
        {"steps", steps},
        {"examples_seen", examples_seen},
    };
}

nlohmann::json TrainReport::to_json() const {
    return nlohmann::json{
        {"success", success},
        {"job_id", job_id},
        {"backend_id", backend_id},
        {"error", error},
        {"wall_ms", wall_ms},
        {"metrics", metrics.to_json()},
        {"log_path", log_path.string()},
        {"artifact_paths", artifact_paths},
        {"meta", meta},
    };
}

std::string train_job_kind_to_string(TrainJobKind k) {
    switch (k) {
        case TrainJobKind::Sft: return "sft";
        case TrainJobKind::DistillSft: return "distill_sft";
        case TrainJobKind::PreferenceStore: return "preference_store";
    }
    return "sft";
}

Result<TrainJobKind> train_job_kind_from_string(std::string_view s) {
    if (s == "sft") return TrainJobKind::Sft;
    if (s == "distill_sft" || s == "distill") return TrainJobKind::DistillSft;
    if (s == "preference_store" || s == "preference") return TrainJobKind::PreferenceStore;
    return Error::invalid_argument("unknown train job kind: " + std::string(s), "kind");
}

nlohmann::json TrainJobSpec::to_json() const {
    return nlohmann::json{
        {"job_id", job_id},
        {"kind", train_job_kind_to_string(kind)},
        {"dataset", dataset.to_json()},
        {"config", config.to_json()},
        {"meta", meta},
    };
}

Result<TrainJobSpec> TrainJobSpec::from_json(const nlohmann::json& j) {
    TrainJobSpec s;
    if (j.contains("job_id") && j["job_id"].is_string()) s.job_id = j["job_id"].get<std::string>();
    if (j.contains("kind") && j["kind"].is_string()) {
        auto k = train_job_kind_from_string(j["kind"].get<std::string>());
        if (!k) return k.error();
        s.kind = k.value();
    }
    if (j.contains("dataset")) {
        auto d = Dataset::from_json(j["dataset"]);
        if (!d) return d.error();
        s.dataset = d.value();
    }
    if (j.contains("config")) {
        auto c = TrainConfig::from_json(j["config"]);
        if (!c) return c.error();
        s.config = c.value();
    }
    if (j.contains("meta") && j["meta"].is_object()) s.meta = j["meta"];
    return s;
}

}  // namespace train
}  // namespace handoffkit
