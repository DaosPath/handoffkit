#include <handoffkit/runtime/http_provider.hpp>

#include <sstream>
#include <vector>

#if defined(HANDOFFKIT_WITH_HTTP)
#include <httplib.h>
#endif

namespace handoffkit {

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
    if (!options.context.empty()) {
        content = std::string(options.context) + "\n\n" + content;
    }
    nlohmann::json body = {
        {"model", std::string(model)},
        {"messages", nlohmann::json::array({
            nlohmann::json{{"role", "user"}, {"content", content}},
        })},
    };
    if (!options.agent_name.empty()) {
        body["user"] = options.agent_name;
    }
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
    std::unordered_map<std::string, std::string> extra_headers
)
    : base_url_(std::move(base_url)),
      api_key_(std::move(api_key)),
      model_(std::move(model)),
      api_path_(std::move(api_path)),
      extra_headers_(std::move(extra_headers)) {}

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
    if (base_url_.empty()) {
        return Error::provider_failed("OpenAI-compatible base_url is empty");
    }
    if (model_.empty()) {
        return Error::provider_failed("OpenAI-compatible model is empty");
    }

    std::string host = base_url_;
    std::string scheme = "http";
    std::string base_path;
    if (host.rfind("https://", 0) == 0) {
        scheme = "https";
        host = host.substr(8);
    } else if (host.rfind("http://", 0) == 0) {
        host = host.substr(7);
    }
    // split path from host if base_url includes /v1
    auto slash = host.find('/');
    if (slash != std::string::npos) {
        base_path = host.substr(slash);
        host = host.substr(0, slash);
        while (!base_path.empty() && base_path.back() == '/') base_path.pop_back();
    }
    while (!host.empty() && host.back() == '/') host.pop_back();

    httplib::Client client(scheme + "://" + host);
    client.set_connection_timeout(10, 0);
    client.set_read_timeout(120, 0);

    httplib::Headers headers = {
        {"Content-Type", "application/json"},
        {"Accept", "application/json"},
        {"User-Agent", "HandoffKit/1.14.0"},
    };
    if (!api_key_.empty()) {
        headers.emplace("Authorization", "Bearer " + api_key_);
    }
    for (const auto& [k, v] : extra_headers_) {
        if (!v.empty()) headers.emplace(k, v);
    }

    std::string path = api_path_;
    if (!path.empty() && path[0] != '/') path = "/" + path;
    // If base_url already ends with /v1 and api_path is /chat/completions, join them.
    if (!base_path.empty()) {
        if (path.rfind(base_path, 0) == 0) {
            // already prefixed
        } else {
            path = base_path + path;
        }
    }

    const auto body = build_openai_chat_request(model_, prompt, options);
    auto res = client.Post(path, headers, body.dump(), "application/json");
    if (!res) {
        return Error::provider_failed("HTTP request failed to " + base_url_ + path);
    }
    if (res->status < 200 || res->status >= 300) {
        return Error::provider_failed(
            "HTTP status " + std::to_string(res->status) + ": " + res->body
        );
    }
    try {
        const auto json = nlohmann::json::parse(res->body);
        return parse_openai_chat_completion(json);
    } catch (const std::exception& ex) {
        return Error::parse_error(std::string("Invalid provider JSON: ") + ex.what());
    }
#endif
}

AnyProvider OpenAiCompatibleProvider::as_any() const {
    return AnyProvider::from(*this);
}

}  // namespace handoffkit
