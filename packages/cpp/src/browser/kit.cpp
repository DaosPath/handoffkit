#include <handoffkit/browser/kit.hpp>

namespace handoffkit {
namespace browser {

BrowserAgentKit create_browser_agent_kit(const BrowserAgentKitOptions& options) {
    BrowserAgentKit kit;
    if (options.fixture) {
        kit.transport = make_fixture_map_transport();
    } else if (options.transport) {
        kit.transport = options.transport;
    } else {
        kit.transport = default_transport(true);
    }

    kit.policy = options.policy;
    kit.max_pages = options.max_pages;
    kit.max_results = options.max_results;
    kit.timeout_ms = options.timeout_ms;
    kit.allow_hosts = options.allow_hosts;
    kit.deny_hosts = options.deny_hosts;
    kit.format = options.format;

    if (options.use_cache) {
        kit.cache = std::make_shared<BrowserCache>(
            options.cache_root.empty() ? default_cache_root() : options.cache_root);
    }

    register_browser_tools(kit.registry, kit.transport);
    return kit;
}

nlohmann::json BrowserAgentKit::search(std::string_view query, int max_results_override) const {
    const int max_results = max_results_override >= 0 ? max_results_override : this->max_results;
    return web_search(query, transport, max_results, timeout_ms, allow_hosts, deny_hosts);
}

WebResearchResult BrowserAgentKit::gather(const WebResearchConfig& config) const {
    WebResearchConfig cfg = config;
    if (cfg.max_pages <= 0) cfg.max_pages = max_pages;
    if (cfg.timeout_ms <= 0) cfg.timeout_ms = timeout_ms;
    if (cfg.allow_hosts.empty()) cfg.allow_hosts = allow_hosts;
    if (cfg.deny_hosts.empty()) cfg.deny_hosts = deny_hosts;
    if (cfg.format.empty()) cfg.format = format;
    if (!cfg.cache && cache) cfg.cache = cache.get();
    return gather_web_research(cfg, transport);
}

}  // namespace browser
}  // namespace handoffkit
