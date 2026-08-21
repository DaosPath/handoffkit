#include <handoffkit/train/dataset.hpp>

#include <fstream>
#include <sstream>

namespace handoffkit {
namespace train {
namespace {

std::uint64_t fnv1a64(std::string_view data) {
    std::uint64_t h = 14695981039346656037ull;
    for (unsigned char c : data) {
        h ^= c;
        h *= 1099511628211ull;
    }
    return h;
}

std::string hex64(std::uint64_t v) {
    static const char* k = "0123456789abcdef";
    std::string s(16, '0');
    for (int i = 15; i >= 0; --i) {
        s[static_cast<std::size_t>(i)] = k[v & 0xf];
        v >>= 4;
    }
    return s;
}

}  // namespace

Result<void> validate_example(const TrainExample& ex) {
    if (ex.empty()) {
        return Result<void>::failure(Error::validation_failed("train example is empty", "example"));
    }
    switch (ex.format) {
        case ExampleFormat::PromptCompletion:
            if (ex.prompt.empty())
                return Result<void>::failure(Error::validation_failed("prompt required", "prompt"));
            if (ex.completion.empty())
                return Result<void>::failure(
                    Error::validation_failed("completion required", "completion")
                );
            break;
        case ExampleFormat::Messages:
            if (!ex.messages.is_array() || ex.messages.empty())
                return Result<void>::failure(
                    Error::validation_failed("messages array required", "messages")
                );
            break;
        case ExampleFormat::Preference:
            if (ex.prompt.empty() || ex.chosen.empty())
                return Result<void>::failure(
                    Error::validation_failed("preference needs prompt+chosen", "preference")
                );
            break;
    }
    return Result<void>::success();
}

Result<void> validate_dataset_examples(const std::vector<TrainExample>& examples) {
    if (examples.empty()) {
        return Result<void>::failure(
            Error::validation_failed("dataset has no examples", "examples")
        );
    }
    for (std::size_t i = 0; i < examples.size(); ++i) {
        auto v = validate_example(examples[i]);
        if (!v) {
            return Result<void>::failure(Error::validation_failed(
                "example[" + std::to_string(i) + "]: " + v.error().message, "examples"
            ));
        }
    }
    return Result<void>::success();
}

Result<std::vector<TrainExample>> load_jsonl(const std::filesystem::path& path) {
    std::ifstream in(path);
    if (!in) {
        return Error::invalid_argument("cannot open dataset: " + path.string(), "path");
    }
    std::vector<TrainExample> out;
    std::string line;
    std::size_t line_no = 0;
    while (std::getline(in, line)) {
        ++line_no;
        if (line.empty() || line.find_first_not_of(" \t\r\n") == std::string::npos) continue;
        nlohmann::json j;
        try {
            j = nlohmann::json::parse(line);
        } catch (const std::exception& e) {
            return Error::parse_error(
                "jsonl line " + std::to_string(line_no) + ": " + e.what(), "jsonl"
            );
        }
        auto ex = TrainExample::from_json(j);
        if (!ex) return ex.error();
        out.push_back(std::move(ex.value()));
    }
    return out;
}

Result<Dataset> save_jsonl(
    const std::filesystem::path& path,
    const std::vector<TrainExample>& examples,
    std::string dataset_id
) {
    auto v = validate_dataset_examples(examples);
    if (!v) return v.error();

    std::error_code ec;
    if (path.has_parent_path()) {
        std::filesystem::create_directories(path.parent_path(), ec);
    }
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return Error::invalid_argument("cannot write dataset: " + path.string(), "path");
    }
    ExampleFormat fmt = examples.front().format;
    for (const auto& ex : examples) {
        out << ex.to_json().dump() << "\n";
    }
    Dataset d;
    d.id = dataset_id.empty() ? path.stem().string() : std::move(dataset_id);
    d.path = path;
    d.format = fmt;
    d.count = examples.size();
    d.content_hash = examples_content_hash(examples);
    d.meta = {{"format", example_format_to_string(fmt)}};
    return d;
}

std::vector<TrainExample> examples_from_prompts(
    const std::vector<std::string>& prompts,
    std::string_view completion_prefix
) {
    std::vector<TrainExample> out;
    out.reserve(prompts.size());
    for (const auto& p : prompts) {
        TrainExample ex;
        ex.format = ExampleFormat::PromptCompletion;
        ex.prompt = p;
        ex.completion = std::string(completion_prefix) + p;
        ex.meta = {{"source", "prompts"}};
        out.push_back(std::move(ex));
    }
    return out;
}

std::vector<TrainExample> examples_from_run_trace(const RunTrace& trace) {
    std::vector<TrainExample> out;
    for (const auto& step : trace.steps) {
        if (step.task.empty() || step.output.empty()) continue;
        TrainExample ex;
        ex.format = ExampleFormat::PromptCompletion;
        ex.prompt = step.task;
        ex.completion = step.output;
        ex.meta = {
            {"source", "run_trace"},
            {"run_id", trace.run_id},
            {"agent", step.agent},
            {"step", step.name},
        };
        out.push_back(std::move(ex));
    }
    if (out.empty() && !trace.final_output.empty()) {
        TrainExample ex;
        ex.format = ExampleFormat::PromptCompletion;
        ex.prompt = trace.name.empty() ? std::string("task") : trace.name;
        ex.completion = trace.final_output;
        ex.meta = {{"source", "run_trace_final"}, {"run_id", trace.run_id}};
        out.push_back(std::move(ex));
    }
    for (const auto& h : trace.handoffs) {
        if (h.task.empty() || h.summary.empty()) continue;
        TrainExample ex;
        ex.format = ExampleFormat::PromptCompletion;
        ex.prompt = h.task;
        ex.completion = h.summary;
        ex.meta = {
            {"source", "handoff"},
            {"from_agent", h.from_agent},
            {"to_agent", h.to_agent},
        };
        out.push_back(std::move(ex));
    }
    return out;
}

std::string examples_content_hash(const std::vector<TrainExample>& examples) {
    std::ostringstream oss;
    for (const auto& ex : examples) {
        oss << ex.to_json().dump() << "\n";
    }
    return hex64(fnv1a64(oss.str()));
}

}  // namespace train
}  // namespace handoffkit
