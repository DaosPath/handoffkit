#include <handoffkit/train/distill.hpp>

namespace handoffkit {
namespace train {

nlohmann::json DistillResult::to_json() const {
    return nlohmann::json{
        {"dataset", dataset.to_json()},
        {"example_count", examples.size()},
        {"teacher_calls", teacher_calls},
        {"handoff", handoff.to_json()},
        {"meta", meta},
    };
}

Result<DistillResult> distill_generate(
    AnyProvider& teacher,
    const std::vector<std::string>& prompts,
    const DistillConfig& config
) {
    if (prompts.empty()) {
        return Error::invalid_argument("distill requires at least one prompt", "prompts");
    }
    if (!teacher.valid()) {
        return Error::provider_failed("teacher provider is not configured");
    }

    DistillResult result;
    result.examples.reserve(prompts.size());
    GenerateOptions opt;
    opt.agent_name = config.teacher_label;
    opt.task = "distill";

    for (const auto& prompt : prompts) {
        auto gen = teacher.generate(prompt, opt);
        ++result.teacher_calls;
        if (!gen) {
            return Error::provider_failed(
                "teacher failed on prompt: " + gen.error().message
            );
        }
        TrainExample ex;
        ex.format = ExampleFormat::PromptCompletion;
        ex.prompt = prompt;
        ex.completion = gen.value();
        ex.meta = {
            {"source", "distill"},
            {"teacher", config.teacher_label},
            {"teacher_model", std::string(teacher.model())},
        };
        result.examples.push_back(std::move(ex));
    }

    auto ds = save_jsonl(config.output_jsonl, result.examples, config.student_dataset_id);
    if (!ds) return ds.error();
    result.dataset = std::move(ds.value());
    result.meta = {
        {"teacher_model", std::string(teacher.model())},
        {"prompt_count", prompts.size()},
    };

    if (config.emit_handoff) {
        result.handoff.task = "Train student on distilled SFT dataset";
        result.handoff.from_agent = config.teacher_label;
        result.handoff.to_agent = "student_trainer";
        result.handoff.summary =
            "Distilled " + std::to_string(result.examples.size()) +
            " SFT examples to " + result.dataset.path.string();
        result.handoff.decisions = {
            "Use student SFT JSONL as train dataset",
            "Prefer echo backend for CI; process backend for real trainers",
        };
        result.handoff.next_steps = {
            "Run TrainJobSpec kind=distill_sft on dataset path",
            "Evaluate student outputs on held-out prompts",
        };
        result.handoff.important_files = {result.dataset.path.string()};
        result.handoff.context_refs = {result.dataset.id, result.dataset.content_hash};
        result.handoff.metadata = {
            {"dataset", result.dataset.to_json()},
            {"teacher_calls", result.teacher_calls},
        };
    }
    return result;
}

}  // namespace train
}  // namespace handoffkit
