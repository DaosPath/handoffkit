#pragma once

#include <handoffkit/train/dataset.hpp>
#include <handoffkit/runtime/provider.hpp>
#include <handoffkit/handoff.hpp>

#include <string>
#include <vector>

namespace handoffkit {
namespace train {

struct DistillConfig {
    std::string teacher_label{"teacher"};
    std::string student_dataset_id{"student_sft"};
    std::filesystem::path output_jsonl{"runs/distill/student.jsonl"};
    bool emit_handoff = true;
};

struct DistillResult {
    Dataset dataset;
    std::vector<TrainExample> examples;
    HandoffState handoff;  // teacher → student_trainer when emit_handoff
    int teacher_calls = 0;
    nlohmann::json meta = nlohmann::json::object();

    [[nodiscard]] nlohmann::json to_json() const;
};

/// Teacher generates a completion per prompt; writes student SFT JSONL.
[[nodiscard]] Result<DistillResult> distill_generate(
    AnyProvider& teacher,
    const std::vector<std::string>& prompts,
    const DistillConfig& config = {}
);

}  // namespace train
}  // namespace handoffkit
