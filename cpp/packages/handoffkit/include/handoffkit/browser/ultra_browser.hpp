#pragma once

#include <handoffkit/browser/research.hpp>
#include <handoffkit/browser/transport.hpp>
#include <nlohmann/json.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace browser {

struct UltraBrowserConfig {
    std::string task;
    int max_depth = 30;
    int max_pages_per_hop = 5;
    int max_sub_queries = 30;
    int timeout_ms = 35000;
    int context_max_chars = 256000;
    bool enable_table_extraction = true;
    bool enable_reflection = true;
    BrowserCache* cache = nullptr;
};

class UltraBrowser {
public:
    explicit UltraBrowser(UltraBrowserConfig config, TransportPtr transport = nullptr);

    /// Execute the full multi-hop deep research loop with reflection auditing
    [[nodiscard]] WebResearchResult execute();

    /// Decompose prompt/task into specific targeted sub-queries
    [[nodiscard]] std::vector<std::string> plan_sub_queries(std::string_view task);

    /// Reflection Audit: inspect accumulated evidence and generate missing-fact follow-up queries
    [[nodiscard]] std::vector<std::string> generate_reflection_queries(
        std::string_view task, const std::vector<PageMarkdown>& current_pages);

private:
    UltraBrowserConfig config_;
    TransportPtr transport_;
};

/// High-level entrypoint for UltraProBrowser Deep Research
[[nodiscard]] WebResearchResult gather_ultra_web_research(const UltraBrowserConfig& config,
                                                          TransportPtr transport = nullptr);

}  // namespace browser
}  // namespace handoffkit
