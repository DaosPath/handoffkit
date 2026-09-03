#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/runtime/provider.hpp>

#include <nlohmann/json.hpp>

#include <cstddef>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace handoffkit {

struct HttpProviderOptions {
    int connection_timeout_ms = 10'000;
    int read_timeout_ms = 120'000;
    int models_read_timeout_ms = 60'000;
    int write_timeout_ms = 120'000;
    std::size_t max_error_body_chars = 4096;
};

/// OpenAI-compatible chat completions client.
/// Live HTTP requires build flag HANDOFFKIT_WITH_HTTP=ON (cpp-httplib).
class OpenAiCompatibleProvider {
public:
    OpenAiCompatibleProvider(
        std::string base_url,
        std::string api_key,
        std::string model,
        std::string api_path = "/chat/completions",
        std::unordered_map<std::string, std::string> extra_headers = {},
        HttpProviderOptions options = {}
    );

    [[nodiscard]] std::string_view model() const noexcept { return model_; }
    [[nodiscard]] std::string_view base_url() const noexcept { return base_url_; }
    [[nodiscard]] const HttpProviderOptions& options() const noexcept { return options_; }

    Result<std::string> generate(std::string_view prompt, const GenerateOptions& options = {}) const;

    /// Query the provider's OpenAI-compatible GET /models endpoint.
    [[nodiscard]] Result<std::vector<std::string>> list_models() const;

    [[nodiscard]] AnyProvider as_any() const;

private:
    std::string base_url_;
    std::string api_key_;
    std::string model_;
    std::string api_path_;
    std::unordered_map<std::string, std::string> extra_headers_;
    HttpProviderOptions options_;
};

/// Produce a bounded, single-line provider HTTP error suitable for logs.
[[nodiscard]] std::string format_http_provider_error(
    int status,
    std::string_view body,
    std::size_t max_body_chars = 4096
);

/// Parse OpenAI-compatible chat completion JSON into assistant text (offline-safe).
[[nodiscard]] Result<std::string> parse_openai_chat_completion(const nlohmann::json& response);

/// Build request body for chat completions (offline helper / tests).
[[nodiscard]] nlohmann::json build_openai_chat_request(
    std::string_view model,
    std::string_view prompt,
    const GenerateOptions& options = {}
);

/// Parse OpenAI-compatible /models list payload into model ids.
[[nodiscard]] Result<std::vector<std::string>> parse_openai_models_list(const nlohmann::json& response);

}  // namespace handoffkit
