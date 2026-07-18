#pragma once

#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/persist.hpp>
#include <string>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct FusionStepRecord {
    std::string step_id;
    std::string role_id;
    std::string prompt_hash;
    std::string output;
    bool from_cache = false;
    int latency_ms = 0;

    nlohmann::json to_json() const;
    static Result<FusionStepRecord> from_json(const nlohmann::json& j);
};

struct FusionCheckpoint {
    std::string run_id;
    FusionConfig config;
    std::vector<FusionStepRecord> steps;
    bool complete = false;

    nlohmann::json to_json() const;
    static Result<FusionCheckpoint> from_json(const nlohmann::json& j);
};

Result<void> write_checkpoint(const std::filesystem::path& path, const FusionCheckpoint& cp);
Result<FusionCheckpoint> load_checkpoint(const std::filesystem::path& path);

/// Find completed step output by step_id.
[[nodiscard]] const FusionStepRecord* find_step(const FusionCheckpoint& cp, std::string_view step_id);

/// Build checkpoint skeleton from a finished FusionRunResult.
[[nodiscard]] FusionCheckpoint checkpoint_from_run(const FusionRunResult& run);

/// Resume: if checkpoint has all architect steps, only re-run merge (echo/live).
Result<FusionRunResult> resume_merge_only(
    const FusionCheckpoint& cp,
    std::shared_ptr<FusionCache> cache
);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
