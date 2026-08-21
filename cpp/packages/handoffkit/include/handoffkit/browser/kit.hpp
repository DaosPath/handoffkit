#pragma once

#include <handoffkit/browser/cache.hpp>
#include <handoffkit/browser/explorer.hpp>
#include <handoffkit/browser/research.hpp>
#include <handoffkit/browser/tools.hpp>
#include <handoffkit/browser/transport.hpp>
#include <handoffkit/browser/web_types.hpp>
#include <handoffkit/runtime/tool.hpp>

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace handoffkit {
namespace browser {

struct BrowserAgentKit {
    TransportPtr transport;
    ExplorePolicy policy;
    ToolRegistry registry;
    std::shared_ptr<BrowserCache> cache;
    int max_pages = 4;
    int max_results = 6;
    int timeout_ms = 20000;
    std::vector<std::string> allow_hosts;
    std::vector<std::string> deny_hosts;
    std::string format{"markdown"};

    [[nodiscard]] nlohmann::json search(std::string_view query, int max_results_override = -1) const;
    [[nodiscard]] WebResearchResult gather(const WebResearchConfig& config) const;
};

struct BrowserAgentKitOptions {
    TransportPtr transport;
    ExplorePolicy policy;
    bool fixture = false;
    bool use_cache = false;
    std::filesystem::path cache_root;
    int max_pages = 4;
    int max_results = 6;
    int timeout_ms = 20000;
    std::vector<std::string> allow_hosts;
    std::vector<std::string> deny_hosts;
    std::string format{"markdown"};
};

[[nodiscard]] BrowserAgentKit create_browser_agent_kit(const BrowserAgentKitOptions& options = {});

}  // namespace browser
}  // namespace handoffkit
