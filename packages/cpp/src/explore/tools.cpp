#include <handoffkit/explore/tools.hpp>
#include <handoffkit/explore/html_extract.hpp>

namespace handoffkit {
namespace explore {
namespace {

TransportPtr resolve_transport(const nlohmann::json& args, TransportPtr default_transport) {
    std::string kind = "map";
    if (args.contains("transport") && args["transport"].is_string()) {
        kind = args["transport"].get<std::string>();
    }
    if (kind == "map" || kind == "stub" || kind == "offline" || kind == "fixture") {
        if (default_transport && default_transport->name() == "map") {
            return default_transport;
        }
        return default_transport ? default_transport : make_transport("map");
    }
    if (kind == "http" || kind == "live") {
        return make_transport("http");
    }
    return default_transport ? default_transport : make_transport(kind);
}

nlohmann::json result_or_error(const Result<ExploreResult>& r) {
    if (!r) {
        return nlohmann::json{
            {"success", false},
            {"error", r.error().message},
            {"error_code", static_cast<int>(r.error().code)},
        };
    }
    return r.value().to_json();
}

nlohmann::json markdown_payload(const ExploreResult& er) {
    return nlohmann::json{
        {"success", er.success},
        {"url", er.final_url.empty() ? er.start_url : er.final_url},
        {"title", er.title},
        {"markdown", er.markdown},
        {"text", er.text},
        {"markdown_chars", er.markdown.size()},
        {"text_chars", er.text.size()},
        {"links", [&] {
             nlohmann::json a = nlohmann::json::array();
             for (const auto& l : er.links) a.push_back(l.to_json());
             return a;
         }()},
        {"error", er.error},
        {"format", "markdown"},
    };
}

}  // namespace

ExplorePolicy policy_from_tool_args(const nlohmann::json& args) {
    ExplorePolicy p;
    if (args.contains("policy") && args["policy"].is_object()) {
        auto pr = ExplorePolicy::from_json(args["policy"]);
        if (pr) return pr.value();
    }
    nlohmann::json flat = nlohmann::json::object();
    for (const char* key : {
             "max_depth", "max_pages", "timeout_ms", "max_body_bytes", "max_text_chars",
             "max_links_per_page", "same_host_only", "follow_redirects", "max_redirects",
             "user_agent", "allow_hosts", "deny_hosts", "extra_headers", "extract_text",
             "extract_links", "extract_title", "strip_scripts_styles", "emit_markdown",
             "max_markdown_chars"}) {
        if (args.contains(key)) flat[key] = args[key];
    }
    if (!flat.empty()) {
        auto pr = ExplorePolicy::from_json(flat);
        if (pr) return pr.value();
    }
    return p;
}

Tool make_web_fetch_tool(TransportPtr default_transport) {
    auto transport = default_transport;
    return Tool(
        "web_fetch",
        "Fetch a single URL via HandoffKit native web explorer. Returns text + markdown.",
        [transport](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("url") || !args["url"].is_string()) {
                return Error::invalid_argument("url is required", "url");
            }
            const std::string url = args["url"].get<std::string>();
            auto pol = policy_from_tool_args(args);
            pol.emit_markdown = true;
            auto t = resolve_transport(args, transport);
            auto r = web_fetch(url, t, pol);
            return result_or_error(r);
        },
        nlohmann::json{
            {"type", "object"},
            {"properties",
             {{"url", {{"type", "string"}}},
              {"transport", {{"type", "string"}, {"description", "map|http"}}},
              {"policy", {{"type", "object"}}}}},
            {"required", nlohmann::json::array({"url"})},
        }
    );
}

Tool make_web_explore_tool(TransportPtr default_transport) {
    auto transport = default_transport;
    return Tool(
        "web_explore",
        "Bounded multi-step web explore. Result includes a markdown field for prompts.",
        [transport](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("url") || !args["url"].is_string()) {
                return Error::invalid_argument("url is required", "url");
            }
            const std::string url = args["url"].get<std::string>();
            auto pol = policy_from_tool_args(args);
            pol.emit_markdown = true;
            auto t = resolve_transport(args, transport);
            auto r = web_explore(url, t, pol);
            return result_or_error(r);
        },
        nlohmann::json{
            {"type", "object"},
            {"properties",
             {{"url", {{"type", "string"}}},
              {"transport", {{"type", "string"}}},
              {"max_depth", {{"type", "integer"}}},
              {"max_pages", {{"type", "integer"}}},
              {"allow_hosts", {{"type", "array"}}},
              {"deny_hosts", {{"type", "array"}}},
              {"policy", {{"type", "object"}}}}},
            {"required", nlohmann::json::array({"url"})},
        }
    );
}

Tool make_html_to_markdown_tool(TransportPtr default_transport) {
    auto transport = default_transport;
    return Tool(
        "html_to_markdown",
        "Convert HTML to compact Markdown. Pass html directly, or url (+ transport) to fetch then convert.",
        [transport](const nlohmann::json& args) -> Result<nlohmann::json> {
            HtmlToMarkdownOptions opts;
            if (args.contains("url") && args["url"].is_string()) {
                opts.base_url = args["url"].get<std::string>();
            }
            if (args.contains("max_chars") && args["max_chars"].is_number_integer()) {
                opts.max_chars = args["max_chars"].get<int>();
            }
            if (args.contains("include_links") && args["include_links"].is_boolean()) {
                opts.include_links_section = args["include_links"].get<bool>();
            }
            if (args.contains("include_header") && args["include_header"].is_boolean()) {
                opts.include_source_header = args["include_header"].get<bool>();
            }

            std::string html;
            std::string title;
            if (args.contains("html") && args["html"].is_string()) {
                html = args["html"].get<std::string>();
            } else if (args.contains("url") && args["url"].is_string()) {
                auto pol = policy_from_tool_args(args);
                pol.emit_markdown = true;
                auto t = resolve_transport(args, transport);
                auto r = web_fetch(args["url"].get<std::string>(), t, pol);
                if (!r) {
                    return nlohmann::json{
                        {"success", false},
                        {"error", r.error().message},
                        {"format", "markdown"},
                    };
                }
                if (!r.value().success) {
                    return nlohmann::json{
                        {"success", false},
                        {"error", r.value().error},
                        {"url", r.value().final_url},
                        {"format", "markdown"},
                    };
                }
                return markdown_payload(r.value());
            } else {
                return Error::invalid_argument("html or url is required", "html");
            }

            std::string md = html_to_markdown(html, opts);
            title = extract_title(html);
            return nlohmann::json{
                {"success", true},
                {"url", opts.base_url},
                {"title", title},
                {"markdown", md},
                {"markdown_chars", md.size()},
                {"format", "markdown"},
            };
        },
        nlohmann::json{
            {"type", "object"},
            {"properties",
             {{"html", {{"type", "string"}}},
              {"url", {{"type", "string"}}},
              {"transport", {{"type", "string"}}},
              {"max_chars", {{"type", "integer"}}},
              {"include_links", {{"type", "boolean"}}},
              {"include_header", {{"type", "boolean"}}}}},
        }
    );
}

Tool make_web_fetch_markdown_tool(TransportPtr default_transport) {
    auto transport = default_transport;
    return Tool(
        "web_fetch_markdown",
        "Fetch a URL and return Markdown (title, body, links) for agent prompts.",
        [transport](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("url") || !args["url"].is_string()) {
                return Error::invalid_argument("url is required", "url");
            }
            auto pol = policy_from_tool_args(args);
            pol.emit_markdown = true;
            auto t = resolve_transport(args, transport);
            auto r = web_fetch(args["url"].get<std::string>(), t, pol);
            if (!r) {
                return nlohmann::json{
                    {"success", false},
                    {"error", r.error().message},
                    {"format", "markdown"},
                };
            }
            return markdown_payload(r.value());
        },
        nlohmann::json{
            {"type", "object"},
            {"properties",
             {{"url", {{"type", "string"}}},
              {"transport", {{"type", "string"}}},
              {"policy", {{"type", "object"}}}}},
            {"required", nlohmann::json::array({"url"})},
        }
    );
}

void register_web_explorer_tools(ToolRegistry& registry, TransportPtr default_transport) {
    registry.add(make_web_fetch_tool(default_transport));
    registry.add(make_web_explore_tool(default_transport));
    registry.add(make_html_to_markdown_tool(default_transport));
    registry.add(make_web_fetch_markdown_tool(default_transport));
}

}  // namespace explore
}  // namespace handoffkit
