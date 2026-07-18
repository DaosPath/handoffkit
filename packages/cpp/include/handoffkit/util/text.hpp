#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace handoffkit {
namespace text {

[[nodiscard]] std::string trim(std::string_view s);
[[nodiscard]] std::string to_lower(std::string s);
[[nodiscard]] std::vector<std::string> split_words(std::string_view s);
[[nodiscard]] std::vector<std::string> split_lines(std::string_view s);
[[nodiscard]] std::size_t word_count(std::string_view s);
[[nodiscard]] std::size_t line_count(std::string_view s);
[[nodiscard]] bool starts_with(std::string_view s, std::string_view prefix);
[[nodiscard]] bool ends_with(std::string_view s, std::string_view suffix);
[[nodiscard]] bool contains_ci(std::string_view hay, std::string_view needle);
[[nodiscard]] std::string replace_all(std::string s, std::string_view from, std::string_view to);
[[nodiscard]] std::string truncate(std::string_view s, std::size_t max_chars, std::string_view ellipsis = "...");
[[nodiscard]] std::string join(const std::vector<std::string>& parts, std::string_view sep);
[[nodiscard]] std::string slugify(std::string_view s);
[[nodiscard]] double jaccard_words(std::string_view a, std::string_view b);
[[nodiscard]] int levenshtein(std::string_view a, std::string_view b);
[[nodiscard]] std::unordered_map<std::string, int> term_frequencies(std::string_view s);
[[nodiscard]] std::vector<std::pair<std::string, int>> top_terms(std::string_view s, std::size_t k = 10);
[[nodiscard]] std::string bulletize(const std::vector<std::string>& items);
[[nodiscard]] bool looks_like_action(std::string_view step);
[[nodiscard]] std::string ensure_trailing_newline(std::string s);
[[nodiscard]] std::string indent_block(std::string_view s, std::size_t spaces = 2);
[[nodiscard]] std::string wrap_paragraph(std::string_view s, std::size_t width = 80);
[[nodiscard]] std::string common_prefix(std::string_view a, std::string_view b);
[[nodiscard]] std::vector<std::string> unique_sorted(std::vector<std::string> items);
[[nodiscard]] std::string percent(double num, double den, int digits = 1);
[[nodiscard]] bool is_blank(std::string_view s);
[[nodiscard]] std::string repeat(std::string_view unit, std::size_t n);
[[nodiscard]] std::string pad_right(std::string s, std::size_t width, char ch = ' ');
[[nodiscard]] std::string pad_left(std::string s, std::size_t width, char ch = ' ');
[[nodiscard]] std::size_t count_substring(std::string_view hay, std::string_view needle);
[[nodiscard]] std::string strip_prefix(std::string s, std::string_view prefix);
[[nodiscard]] std::string strip_suffix(std::string s, std::string_view suffix);
[[nodiscard]] std::vector<std::string> filter_nonempty(std::vector<std::string> items);
[[nodiscard]] std::string format_kv_list(const std::vector<std::pair<std::string, std::string>>& kvs);

}  // namespace text
}  // namespace handoffkit
