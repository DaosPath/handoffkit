#pragma once

#include <handoffkit/explore/html_extract.hpp>
#include <handoffkit/explore/transport.hpp>
#include <handoffkit/explore/web_types.hpp>

#include <memory>
#include <string>

namespace handoffkit {
namespace explore {

/// Controllable web explorer: fetch + extract + bounded multi-step crawl.
/// All behavior driven by ExplorePolicy + injectable WebTransport.
class WebExplorer {
public:
    WebExplorer() = default;
    explicit WebExplorer(TransportPtr transport);

    void set_transport(TransportPtr transport);
    void set_policy(ExplorePolicy policy);
    [[nodiscard]] TransportPtr transport() const { return transport_; }
    [[nodiscard]] const ExplorePolicy& policy() const { return policy_; }

    /// Single-page fetch + extract (depth 0 semantics, still honors host policy).
    Result<ExploreResult> fetch(std::string_view url) const;

    /// Bounded multi-step explore (BFS by default) under policy budgets.
    Result<ExploreResult> explore(std::string_view start_url) const;

    /// Fetch/explore with an explicit policy override (does not mutate member policy).
    Result<ExploreResult> fetch(std::string_view url, const ExplorePolicy& policy) const;
    Result<ExploreResult> explore(std::string_view start_url, const ExplorePolicy& policy) const;

private:
    TransportPtr transport_{std::make_shared<MapTransport>()};
    ExplorePolicy policy_{};

    Result<ExploreStep> fetch_one(std::string_view url, int depth, const ExplorePolicy& policy) const;
    TransportRequest make_request(std::string_view url, const ExplorePolicy& policy) const;
};

/// Convenience free functions (fork-friendly).
[[nodiscard]] Result<ExploreResult> web_fetch(std::string_view url, TransportPtr transport,
                                              ExplorePolicy policy = {});
[[nodiscard]] Result<ExploreResult> web_explore(std::string_view start_url, TransportPtr transport,
                                                ExplorePolicy policy = {});

}  // namespace explore
}  // namespace handoffkit
