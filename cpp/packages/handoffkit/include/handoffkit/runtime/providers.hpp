#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/fallback_provider.hpp>
#include <handoffkit/runtime/http_provider.hpp>
#include <handoffkit/runtime/provider.hpp>

#include <nlohmann/json.hpp>

#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace handoffkit {

/// Catalog entry for an OpenAI-compatible (or Echo) provider, aligned with Python native configs.
struct NativeProviderConfig {
    std::string name;
    std::string display_name;
    std::string api_key_env;
    std::string base_url_env;
    std::string model_env;
    std::string default_base_url;
    std::string default_model;
    std::vector<std::string> suggested_models;
    bool supports_models_endpoint = true;
    bool requires_api_key = true;
    /// Extra HTTP headers: header-name -> env var that supplies the value (optional).
    std::unordered_map<std::string, std::string> headers_env;
    nlohmann::json metadata = nlohmann::json::object();

    nlohmann::json to_json() const;
};

struct ProviderResolveOptions {
    std::string model;       // optional override
    std::string api_key;     // optional override
    std::string base_url;    // optional override
    bool allow_missing_key = false;  // for dry wiring / tests
};

struct ResolvedProviderSettings {
    std::string name;
    std::string display_name;
    std::string base_url;
    std::string model;
    std::string api_key;
    std::string api_path = "/chat/completions";  // relative to base_url which usually ends with /v1
    std::unordered_map<std::string, std::string> headers;
    nlohmann::json metadata = nlohmann::json::object();

    nlohmann::json to_json() const;
};

/// Full catalog (echo + openai-compatible natives + ollama + opencode).
[[nodiscard]] const std::vector<NativeProviderConfig>& native_provider_configs();

[[nodiscard]] std::vector<std::string> list_provider_names();

[[nodiscard]] const NativeProviderConfig* find_provider_config(std::string_view name);

[[nodiscard]] Result<NativeProviderConfig> get_provider_config(std::string_view name);

/// Resolve URLs/keys/models from env + overrides (no network).
[[nodiscard]] Result<ResolvedProviderSettings> resolve_provider_settings(
    std::string_view name,
    const ProviderResolveOptions& options = {}
);

/// Query a provider's OpenAI-compatible GET /models endpoint.
[[nodiscard]] Result<std::vector<std::string>> list_provider_models(
    std::string_view name,
    const ProviderResolveOptions& options = {}
);

/// Build a live AnyProvider.
/// - "echo" always works offline
/// - others require HANDOFFKIT_WITH_HTTP at build time and (usually) an API key
[[nodiscard]] Result<AnyProvider> make_provider(
    std::string_view name,
    const ProviderResolveOptions& options = {}
);

/// Convenience: OpenAI-compatible provider from explicit settings (HTTP build).
[[nodiscard]] Result<AnyProvider> make_openai_compatible_provider(
    const ResolvedProviderSettings& settings
);

/// Human-readable catalog for CLI/docs.
[[nodiscard]] std::string list_providers_text();

/// Read env var; empty if unset.
[[nodiscard]] std::string env_or_empty(std::string_view key);

}  // namespace handoffkit
