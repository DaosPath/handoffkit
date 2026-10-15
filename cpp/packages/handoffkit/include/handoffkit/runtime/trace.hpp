#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>
#include <handoffkit/runtime/team.hpp>

#include <string>
#include <string_view>

namespace handoffkit {

/// Build a RunTrace from a completed team run (wire-compatible snake_case).
[[nodiscard]] RunTrace build_run_trace(
    std::string_view run_id,
    std::string_view name,
    const TeamRunResult& team_result
);

/// Attach protocol mode string onto each handoff metadata for timeline context.
[[nodiscard]] RunTrace build_run_trace(
    std::string_view run_id,
    std::string_view name,
    const TeamRunResult& team_result,
    std::string_view protocol_mode
);

}  // namespace handoffkit
