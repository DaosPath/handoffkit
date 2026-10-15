#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace browser {

struct RankedHit {
    std::string title;
    std::string url;
    int score = 0;
};

[[nodiscard]] int host_score(std::string_view url);

[[nodiscard]] std::vector<RankedHit> rank_search_hits(
    const std::vector<std::pair<std::string, std::string>>& hits,
    const std::vector<std::string>& allow_hosts = {},
    const std::vector<std::string>& deny_hosts = {}
);

}  // namespace browser
}  // namespace handoffkit
