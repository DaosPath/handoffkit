#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

/// Multi-stage text pipeline used by fusion scoring/reporting (demo layer).

struct TextPipelineStats {
    std::size_t raw_chars = 0;
    std::size_t sanitized_chars = 0;
    std::size_t tokens = 0;
    std::size_t sentences = 0;
    std::size_t bullets = 0;
    int digit_tokens = 0;
    int upper_runs = 0;
    nlohmann::json to_json() const;
};

[[nodiscard]] std::vector<std::string> split_sentences(std::string_view text);
[[nodiscard]] std::vector<std::string> split_paragraphs(std::string_view text);
[[nodiscard]] std::string collapse_whitespace(std::string_view text);
[[nodiscard]] std::string strip_markdown_emphasis(std::string_view text);
[[nodiscard]] int count_digit_tokens(const std::vector<std::string>& tokens);
[[nodiscard]] int count_uppercase_runs(std::string_view text);
[[nodiscard]] TextPipelineStats analyze_text_pipeline(std::string_view text, bool ascii_sanitize = true);

/// Extract "primary diagnosis"-like first line heuristics for diagnostic profiles.
[[nodiscard]] std::string guess_primary_label(std::string_view model_output);

/// Detect if text looks like a shipping/product plan (Goals/Architecture/CLI sections).
[[nodiscard]] bool looks_like_shipping_plan(std::string_view text);

/// Detect task-faithful merge instructions present in a prompt.
[[nodiscard]] bool prompt_has_task_faithful_rules(std::string_view merge_prompt);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
