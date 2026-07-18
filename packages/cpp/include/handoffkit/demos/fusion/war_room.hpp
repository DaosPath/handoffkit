#pragma once

// Minimal multi-tier compare (War Room): one process, shared prompt, table + previews.
// No web, no padding — fastest path is provider=echo.

#include <handoffkit/demos/fusion/types.hpp>

#include <string>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

struct WarRoomOptions {
    std::string task;
    std::vector<std::string> tiers{"lite", "medium", "pro", "ultra"};  // product tiers only
    std::string provider{"echo"};
    std::string model;
    FusionProfileId profile = FusionProfileId::Research;
    bool write_files = false;
    bool cache_enabled = false;
    std::size_t preview_chars = 280;
};

struct WarRoomTierRow {
    std::string tier;
    bool success = false;
    int llm_calls = 0;
    int planned_calls = 0;
    int wall_ms = 0;
    int handoff_count = 0;
    std::size_t answer_chars = 0;
    std::string mode;
    std::string pack_id;
    std::string error;
    std::string preview;
    std::string answer;  // full final_output

    nlohmann::json to_json() const;
};

struct WarRoomReport {
    std::string task;
    std::string provider;
    std::string profile;
    std::vector<WarRoomTierRow> rows;
    int total_wall_ms = 0;

    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

/// Run product tiers in-process (native). Fastest with provider=echo.
[[nodiscard]] Result<WarRoomReport> run_fusion_war_room(const WarRoomOptions& opts);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
