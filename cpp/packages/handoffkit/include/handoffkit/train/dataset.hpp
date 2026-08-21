#pragma once

#include <handoffkit/train/types.hpp>
#include <handoffkit/runtime/trace.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace train {

/// Load JSONL file (one JSON object per line). Skips blank lines.
[[nodiscard]] Result<std::vector<TrainExample>> load_jsonl(const std::filesystem::path& path);

/// Write examples as JSONL. Creates parent directories.
[[nodiscard]] Result<Dataset> save_jsonl(
    const std::filesystem::path& path,
    const std::vector<TrainExample>& examples,
    std::string dataset_id = {}
);

[[nodiscard]] Result<void> validate_example(const TrainExample& ex);
[[nodiscard]] Result<void> validate_dataset_examples(const std::vector<TrainExample>& examples);

/// Build SFT examples from free-form prompts + fixed completion template (offline helpers).
[[nodiscard]] std::vector<TrainExample> examples_from_prompts(
    const std::vector<std::string>& prompts,
    std::string_view completion_prefix = "Answer: "
);

/// Map run trace steps/handoffs into prompt/completion pairs (best-effort).
[[nodiscard]] std::vector<TrainExample> examples_from_run_trace(const RunTrace& trace);

/// Content hash of concatenated example JSON (stable, not cryptographic).
[[nodiscard]] std::string examples_content_hash(const std::vector<TrainExample>& examples);

}  // namespace train
}  // namespace handoffkit
