#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace demos {

struct DemoCase {
    std::string id;
    std::string domain;       // support | coding | research | clinical | product | ops
    std::string title;
    std::string task;
    std::string context;
    std::vector<std::string> constraints;
    std::vector<std::string> success_criteria;
    std::vector<std::string> seed_decisions;
    std::vector<std::string> seed_files;
    int difficulty = 1;       // 1-5
};

/// Offline case corpus used by multi-case and showcase demos (real scenario text).
[[nodiscard]] const std::vector<DemoCase>& case_corpus();
[[nodiscard]] const DemoCase* find_case(std::string_view id);
[[nodiscard]] std::vector<const DemoCase*> cases_for_domain(std::string_view domain);
[[nodiscard]] std::size_t case_corpus_size();

}  // namespace demos
}  // namespace handoffkit
