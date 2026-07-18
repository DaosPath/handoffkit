#include <handoffkit/explore/explorer.hpp>

#include <queue>
#include <set>
#include <utility>

namespace handoffkit {
namespace explore {

WebExplorer::WebExplorer(TransportPtr transport) : transport_(std::move(transport)) {
    if (!transport_) transport_ = std::make_shared<MapTransport>();
}

void WebExplorer::set_transport(TransportPtr transport) {
    transport_ = transport ? std::move(transport) : std::make_shared<MapTransport>();
}

void WebExplorer::set_policy(ExplorePolicy policy) { policy_ = std::move(policy); }

TransportRequest WebExplorer::make_request(std::string_view url, const ExplorePolicy& policy) const {
    TransportRequest req;
    req.url = std::string(url);
    req.timeout_ms = policy.timeout_ms;
    req.max_body_bytes = policy.max_body_bytes;
    req.follow_redirects = policy.follow_redirects;
    req.max_redirects = policy.max_redirects;
    req.headers["User-Agent"] = policy.user_agent;
    req.headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    for (const auto& [k, v] : policy.extra_headers) {
        req.headers[k] = v;
    }
    return req;
}

Result<ExploreStep> WebExplorer::fetch_one(std::string_view url, int depth,
                                           const ExplorePolicy& policy) const {
    ExploreStep step;
    step.depth = depth;
    step.url = std::string(url);

    auto parts = parse_url(url);
    if (!parts.valid || parts.host.empty()) {
        step.success = false;
        step.error = "invalid url";
        return Result<ExploreStep>::success(std::move(step));
    }
    if (!host_allowed(parts.host, policy)) {
        step.success = false;
        step.error = "host denied by policy: " + parts.host;
        return Result<ExploreStep>::success(std::move(step));
    }
    if (!transport_) {
        step.success = false;
        step.error = "no transport configured";
        return Result<ExploreStep>::success(std::move(step));
    }

    auto resp = transport_->get(make_request(url, policy));
    step.status = resp.status;
    step.final_url = resp.final_url.empty() ? step.url : resp.final_url;
    step.raw_body_bytes = resp.body.size();
    if (!resp.error.empty()) {
        step.success = false;
        step.error = resp.error;
        return Result<ExploreStep>::success(std::move(step));
    }
    if (resp.status < 200 || resp.status >= 400) {
        step.success = false;
        step.error = "HTTP status " + std::to_string(resp.status);
        // still try extract if body present
    }
    auto page = extract_page(step.final_url, resp.body, policy);
    step.title = std::move(page.title);
    step.text = std::move(page.text);
    step.markdown = std::move(page.markdown);
    step.links = std::move(page.links);

    // classify blocked outbound links
    const std::string origin = normalize_host(parts.host);
    for (const auto& link : step.links) {
        if (link.absolute.empty()) continue;
        if (!url_allowed(link.absolute, policy, origin)) {
            step.blocked_links.push_back(link.absolute);
        }
    }
    if (step.error.empty()) step.success = true;
    return Result<ExploreStep>::success(std::move(step));
}

Result<ExploreResult> WebExplorer::fetch(std::string_view url) const {
    return fetch(url, policy_);
}

Result<ExploreResult> WebExplorer::fetch(std::string_view url, const ExplorePolicy& policy) const {
    ExploreResult result;
    result.start_url = std::string(url);
    result.policy = policy;
    result.metadata["transport"] = transport_ ? transport_->name() : "none";
    result.metadata["mode"] = "fetch";

    auto step_r = fetch_one(url, 0, policy);
    if (!step_r) return step_r.error();
    auto step = step_r.value();
    step.step_index = 0;
    result.steps.push_back(step);
    if (step.success) {
        result.success = true;
        result.pages_fetched = 1;
        result.max_depth_reached = 0;
        result.final_url = step.final_url;
        result.title = step.title;
        result.text = step.text;
        result.markdown = step.markdown;
        result.links = step.links;
    } else {
        result.success = false;
        result.error = step.error;
        result.final_url = step.final_url;
    }
    return result;
}

Result<ExploreResult> WebExplorer::explore(std::string_view start_url) const {
    return explore(start_url, policy_);
}

Result<ExploreResult> WebExplorer::explore(std::string_view start_url, const ExplorePolicy& policy) const {
    ExploreResult result;
    result.start_url = std::string(start_url);
    result.policy = policy;
    result.metadata["transport"] = transport_ ? transport_->name() : "none";
    result.metadata["mode"] = "explore";

    auto start_parts = parse_url(start_url);
    if (!start_parts.valid || start_parts.host.empty()) {
        result.success = false;
        result.error = "invalid start_url";
        return result;
    }
    if (!host_allowed(start_parts.host, policy)) {
        result.success = false;
        result.error = "start host denied by policy: " + start_parts.host;
        return result;
    }

    const std::string origin_host = normalize_host(start_parts.host);
    std::set<std::string> visited;
    // BFS: (url, depth)
    std::queue<std::pair<std::string, int>> q;
    q.push({std::string(start_url), 0});

    int step_index = 0;
    while (!q.empty() && result.pages_fetched < policy.max_pages) {
        auto [url, depth] = q.front();
        q.pop();
        if (visited.count(url)) continue;
        if (depth > policy.max_depth) continue;
        visited.insert(url);

        auto step_r = fetch_one(url, depth, policy);
        if (!step_r) return step_r.error();
        auto step = step_r.value();
        step.step_index = step_index++;
        result.steps.push_back(step);
        result.max_depth_reached = std::max(result.max_depth_reached, depth);

        if (!step.success) {
            // count failed attempts toward page budget only if we got a response body attempt
            // still continue exploring other queued URLs
            continue;
        }
        ++result.pages_fetched;
        if (result.final_url.empty()) {
            result.final_url = step.final_url;
            result.title = step.title;
            result.text = step.text;
            result.markdown = step.markdown;
        } else {
            // append text / markdown excerpts for multi-page
            if (!step.text.empty() && static_cast<int>(result.text.size()) < policy.max_text_chars) {
                if (!result.text.empty()) result.text += "\n\n";
                result.text += step.text;
                if (static_cast<int>(result.text.size()) > policy.max_text_chars) {
                    result.text.resize(static_cast<std::size_t>(policy.max_text_chars));
                    result.text += "...[truncated]";
                }
            }
            if (!step.markdown.empty()) {
                const int md_cap = policy.max_markdown_chars > 0 ? policy.max_markdown_chars
                                                                : policy.max_text_chars;
                if (static_cast<int>(result.markdown.size()) < md_cap) {
                    if (!result.markdown.empty()) result.markdown += "\n\n---\n\n";
                    result.markdown += step.markdown;
                    if (static_cast<int>(result.markdown.size()) > md_cap) {
                        result.markdown.resize(static_cast<std::size_t>(md_cap));
                        result.markdown += "\n\n...[truncated]\n";
                    }
                }
            }
        }
        for (const auto& link : step.links) {
            result.links.push_back(link);
        }

        if (depth >= policy.max_depth) continue;
        if (result.pages_fetched >= policy.max_pages) break;

        for (const auto& link : step.links) {
            if (link.absolute.empty()) continue;
            if (visited.count(link.absolute)) continue;
            if (!url_allowed(link.absolute, policy, origin_host)) continue;
            if (static_cast<int>(visited.size()) + static_cast<int>(q.size()) > policy.max_pages * 4) {
                break;  // avoid unbounded queue
            }
            q.push({link.absolute, depth + 1});
        }
    }

    result.success = result.pages_fetched > 0;
    if (!result.success && result.error.empty()) {
        if (!result.steps.empty()) {
            result.error = result.steps.front().error.empty()
                ? "no pages fetched successfully"
                : result.steps.front().error;
        } else {
            result.error = "explore produced no steps";
        }
    }
    result.metadata["visited"] = static_cast<int>(visited.size());
    return result;
}

Result<ExploreResult> web_fetch(std::string_view url, TransportPtr transport, ExplorePolicy policy) {
    WebExplorer ex(std::move(transport));
    return ex.fetch(url, policy);
}

Result<ExploreResult> web_explore(std::string_view start_url, TransportPtr transport, ExplorePolicy policy) {
    WebExplorer ex(std::move(transport));
    return ex.explore(start_url, policy);
}

}  // namespace explore
}  // namespace handoffkit
