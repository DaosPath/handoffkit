#include <handoffkit/runtime/http_provider.hpp>
#include <handoffkit/version.hpp>

#include <algorithm>
#include <sstream>
#include <vector>

#if defined(HANDOFFKIT_WITH_HTTP)
#include <httplib.h>
#endif

namespace handoffkit {
namespace {

#if defined(HANDOFFKIT_WITH_HTTP)
struct HttpEndpoint {
    std::string origin;
    std::string base_path;
};

Result<HttpEndpoint> split_endpoint(std::string base_url) {
    if (base_url.empty()) return Error::provider_failed("OpenAI-compatible base_url is empty");
    std::string host = std::move(base_url);
    std::string scheme = "http";
    if (host.rfind("https://", 0) == 0) {
        scheme = "https";
        host = host.substr(8);
    } else if (host.rfind("http://", 0) == 0) {
        host = host.substr(7);
    }
    std::string base_path;
    const auto slash = host.find('/');
    if (slash != std::string::npos) {
        base_path = host.substr(slash);
        host = host.substr(0, slash);
        while (!base_path.empty() && base_path.back() == '/') base_path.pop_back();
    }
    while (!host.empty() && host.back() == '/') host.pop_back();
    if (host.empty()) return Error::provider_failed("OpenAI-compatible base_url has no host");
    return HttpEndpoint{scheme + "://" + host, std::move(base_path)};
}

std::string join_endpoint_path(const HttpEndpoint& endpoint, std::string path) {
    if (path.empty() || path.front() != '/') path = "/" + path;
    if (!endpoint.base_path.empty() && path.rfind(endpoint.base_path, 0) != 0) {
        path = endpoint.base_path + path;
    }
    return path;
}

httplib::Headers make_headers(
    const std::string& api_key,
    const std::unordered_map<std::string, std::string>& extra_headers
) {
    httplib::Headers headers = {
        {"Content-Type", "application/json"},
        {"Accept", "application/json"},
        {"User-Agent", std::string("HandoffKit/") + std::string(version())},
    };
    if (!api_key.empty()) headers.emplace("Authorization", "Bearer " + api_key);
    for (const auto& [key, value] : extra_headers) {
        if (!value.empty()) headers.emplace(key, value);
    }
    return headers;
}

std::pair<time_t, time_t> timeout_parts(int timeout_ms) {
    const int bounded = std::max(0, timeout_ms);
    return {
        static_cast<time_t>(bounded / 1000),
        static_cast<time_t>((bounded % 1000) * 1000),
    };
}

void configure_client(
    httplib::Client& client,
    const HttpProviderOptions& options,
    int read_timeout_ms
) {
    const auto [connect_s, connect_us] = timeout_parts(options.connection_timeout_ms);
    const auto [read_s, read_us] = timeout_parts(read_timeout_ms);
    const auto [write_s, write_us] = timeout_parts(options.write_timeout_ms);
    client.set_connection_timeout(connect_s, connect_us);
    client.set_read_timeout(read_s, read_us);
    client.set_write_timeout(write_s, write_us);
}
#endif

}  // namespace

std::string format_http_provider_error(
    int status,
    std::string_view body,
    std::size_t max_body_chars
) {
    std::string message = "HTTP status " + std::to_string(status);
    if (body.empty() || max_body_chars == 0) return message;

    const std::size_t keep = std::min(body.size(), max_body_chars);
    std::string safe;
    safe.reserve(keep);
    for (std::size_t i = 0; i < keep; ++i) {
        const unsigned char ch = static_cast<unsigned char>(body[i]);
        if (ch == '\r' || ch == '\n' || ch == '\t') {
            safe.push_back(' ');
        } else if (ch < 0x20 || ch == 0x7f) {
            safe.push_back('?');
        } else {
            safe.push_back(static_cast<char>(ch));
        }
    }
    message += ": " + safe;
    if (keep < body.size()) {
        message += "... [truncated " + std::to_string(body.size() - keep) + " chars]";
    }
    return message;
}

Result<std::string> parse_openai_chat_completion(const nlohmann::json& response) {
    if (!response.is_object()) {
        return Error::parse_error("chat completion response must be an object");
    }
    if (!response.contains("choices") || !response["choices"].is_array() || response["choices"].empty()) {
        return Error::parse_error("chat completion missing choices", "choices");
    }
    const auto& choice0 = response["choices"][0];
    if (choice0.contains("message") && choice0["message"].is_object()) {
        const auto& message = choice0["message"];
        if (message.contains("content") && message["content"].is_string()) {
            const auto content = message["content"].get<std::string>();
            if (!content.empty()) return Result<std::string>::success(content);
        }
        if (message.contains("reasoning_content") && message["reasoning_content"].is_string() &&
            !message["reasoning_content"].get<std::string>().empty()) {
            const std::string finish = choice0.value("finish_reason", std::string("unknown"));
            return Error::parse_error(
                "completion produced reasoning_content but no final content (finish_reason=" + finish +
                "); increase max_tokens or adjust the thinking model settings",
                "choices[0].message.content"
            );
        }
    }
    if (choice0.contains("text") && choice0["text"].is_string()) {
        return Result<std::string>::success(choice0["text"].get<std::string>());
    }
    return Error::parse_error("unable to extract assistant content from completion");
}

nlohmann::json build_openai_chat_request(
    std::string_view model,
    std::string_view prompt,
    const GenerateOptions& options
) {
    std::string content(prompt);
    if (!options.context.empty()) content = options.context + "\n\n" + content;
    nlohmann::json body = {
        {"model", std::string(model)},
        {"messages", nlohmann::json::array({
            nlohmann::json{{"role", "user"}, {"content", content}},
        })},
    };
    if (!options.agent_name.empty()) body["user"] = options.agent_name;
    if (options.max_tokens > 0) body["max_tokens"] = options.max_tokens;
    if (options.temperature >= 0.0) body["temperature"] = options.temperature;
    if (options.top_p >= 0.0) body["top_p"] = options.top_p;
    if (options.extra_body.is_object()) {
        for (auto it = options.extra_body.begin(); it != options.extra_body.end(); ++it) {
            body[it.key()] = it.value();
        }
    }
    return body;
}

Result<std::vector<std::string>> parse_openai_models_list(const nlohmann::json& response) {
    std::vector<std::string> ids;
    if (!response.is_object() || !response.contains("data") || !response["data"].is_array()) {
        return Error::parse_error("models list missing data array", "data");
    }
    for (const auto& item : response["data"]) {
        if (item.is_object() && item.contains("id") && item["id"].is_string()) {
            ids.push_back(item["id"].get<std::string>());
        } else if (item.is_string()) {
            ids.push_back(item.get<std::string>());
        }
    }
    return Result<std::vector<std::string>>::success(std::move(ids));
}

OpenAiCompatibleProvider::OpenAiCompatibleProvider(
    std::string base_url,
    std::string api_key,
    std::string model,
    std::string api_path,
    std::unordered_map<std::string, std::string> extra_headers,
    HttpProviderOptions options
)
    : base_url_(std::move(base_url)),
      api_key_(std::move(api_key)),
      model_(std::move(model)),
      api_path_(std::move(api_path)),
      extra_headers_(std::move(extra_headers)),
      options_(std::move(options)) {}

Result<std::string> OpenAiCompatibleProvider::generate(
    std::string_view prompt,
    const GenerateOptions& options
) const {
#if !defined(HANDOFFKIT_WITH_HTTP)
    (void)prompt;
    (void)options;
    return Error::provider_failed(
        "OpenAiCompatibleProvider requires HANDOFFKIT_WITH_HTTP=ON at build time"
    );
#else
    if (model_.empty()) return Error::provider_failed("OpenAI-compatible model is empty");
    auto endpoint = split_endpoint(base_url_);
    if (!endpoint) return endpoint.error();
    const std::string path = join_endpoint_path(endpoint.value(), api_path_);

    httplib::Client client(endpoint.value().origin);
    configure_client(client, options_, options_.read_timeout_ms);
    const auto headers = make_headers(api_key_, extra_headers_);
    const auto body = build_openai_chat_request(model_, prompt, options);
    auto response = client.Post(path, headers, body.dump(), "application/json");
    if (!response) return Error::provider_failed("HTTP request failed to " + base_url_ + path);
    if (response->status < 200 || response->status >= 300) {
        return Error::provider_failed(format_http_provider_error(
            response->status,
            response->body,
            options_.max_error_body_chars
        ));
    }
    try {
        return parse_openai_chat_completion(nlohmann::json::parse(response->body));
    } catch (const std::exception& ex) {
        return Error::parse_error(std::string("Invalid provider JSON: ") + ex.what());
    }
#endif
}

Result<std::vector<std::string>> OpenAiCompatibleProvider::list_models() const {
#if !defined(HANDOFFKIT_WITH_HTTP)
    return Error::provider_failed(
        "OpenAiCompatibleProvider::list_models requires HANDOFFKIT_WITH_HTTP=ON at build time"
    );
#else
    auto endpoint = split_endpoint(base_url_);
    if (!endpoint) return endpoint.error();
    const std::string path = join_endpoint_path(endpoint.value(), "/models");
    httplib::Client client(endpoint.value().origin);
    configure_client(client, options_, options_.models_read_timeout_ms);
    const auto headers = make_headers(api_key_, extra_headers_);
    auto response = client.Get(path, headers);
    if (!response) return Error::provider_failed("HTTP request failed to " + base_url_ + path);
    if (response->status < 200 || response->status >= 300) {
        return Error::provider_failed(format_http_provider_error(
            response->status,
            response->body,
            options_.max_error_body_chars
        ));
    }
    try {
        return parse_openai_models_list(nlohmann::json::parse(response->body));
    } catch (const std::exception& ex) {
        return Error::parse_error(std::string("Invalid models JSON: ") + ex.what());
    }
#endif
}

AnyProvider OpenAiCompatibleProvider::as_any() const {
    return AnyProvider::from(*this);
}

}  // namespace handoffkit
