#pragma once

// Optional MedCase fixtures loader (runtime JSON, NOT embedded LOC mass).
// By plan Non-goals: do not embed the full doctor corpus in C++ sources.

#include <handoffkit/demos/fusion/bench.hpp>
#include <handoffkit/error.hpp>

#include <cstddef>
#include <filesystem>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

/// Tiny built-in samples (hand-maintained, not a corpus dump).
[[nodiscard]] std::vector<BenchCase> builtin_sample_bench_cases();

/// Load cases from external JSON array path (doctor_cases_*.json shape). Empty if missing.
Result<std::vector<BenchCase>> load_bench_cases_json(const std::filesystem::path& path);

/// Prefer external path if set via env HANDOFFKIT_MEDCASE_JSON, else builtin samples only.
[[nodiscard]] std::vector<BenchCase> all_medcase_bench_cases();
[[nodiscard]] const BenchCase* find_medcase_bench_case(std::string_view case_id);
[[nodiscard]] std::size_t medcase_bench_case_count();

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
