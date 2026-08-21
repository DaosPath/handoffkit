#pragma once

#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace handoffkit {
namespace browser {

struct SoftBlockResult {
    bool blocked = false;
    std::string reason;
};

[[nodiscard]] SoftBlockResult detect_soft_block(std::string_view body, int status);

/// Prefer keeping heading structure when truncating markdown.
[[nodiscard]] std::string smart_truncate(std::string_view markdown, int max_chars);

[[nodiscard]] std::string canonical_url(std::string_view url);

}  // namespace browser
}  // namespace handoffkit
