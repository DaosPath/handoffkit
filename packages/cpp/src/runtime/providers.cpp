#include <handoffkit/runtime/providers.hpp>

#include <cstdlib>
#include <sstream>

namespace handoffkit {
namespace {

NativeProviderConfig cfg(
    const char* name,
    const char* display,
    const char* key_env,
    const char* base_env,
    const char* model_env,
    const char* default_base,
    const char* default_model,
    std::vector<std::string> models,
    bool requires_key = true,
    std::unordered_map<std::string, std::string> headers = {},
    nlohmann::json meta = nlohmann::json::object()
) {
    NativeProviderConfig c;
    c.name = name;
    c.display_name = display;
    c.api_key_env = key_env;
    c.base_url_env = base_env;
    c.model_env = model_env;
    c.default_base_url = default_base;
    c.default_model = default_model;
    c.suggested_models = std::move(models);
    c.requires_api_key = requires_key;
    c.headers_env = std::move(headers);
    c.metadata = std::move(meta);
    if (!c.metadata.contains("compatibility")) {
        c.metadata["compatibility"] = "openai";
    }
    return c;
}

std::vector<NativeProviderConfig> build_catalog() {
    return {
        cfg("echo", "Echo (offline)", "", "", "", "", "echo", {"echo"}, false, {},
            {{"compatibility", "offline"}, {"vendor", "handoffkit"}}),

        cfg("openai", "OpenAI", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL",
            "https://api.openai.com/v1", "gpt-4o-mini",
            {"gpt-4o-mini", "gpt-4o"}, true, {}, {{"vendor", "openai"}}),

        cfg("nvidia", "NVIDIA NIM", "NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_MODEL",
            "https://integrate.api.nvidia.com/v1", "z-ai/glm-5.2",
            {"z-ai/glm-5.2"}, true, {}, {{"vendor", "nvidia"}}),

        cfg("openrouter", "OpenRouter", "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENROUTER_MODEL",
            "https://openrouter.ai/api/v1", "openrouter/auto",
            {"openrouter/auto", "openrouter/free"}, true,
            {{"HTTP-Referer", "OPENROUTER_HTTP_REFERER"}, {"X-Title", "OPENROUTER_X_TITLE"}},
            {{"gateway", true}}),

        cfg("groq", "Groq", "GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_MODEL",
            "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile",
            {"llama-3.3-70b-versatile", "llama-3.1-8b-instant"}),

        cfg("grok", "xAI Grok", "XAI_API_KEY", "XAI_BASE_URL", "XAI_MODEL",
            "https://api.x.ai/v1", "grok-4.3",
            {"grok-4.3", "grok-build-0.1"}, true, {}, {{"vendor", "xai"}}),

        cfg("together", "Together AI", "TOGETHER_API_KEY", "TOGETHER_BASE_URL", "TOGETHER_MODEL",
            "https://api.together.xyz/v1", "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            {"meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3",
             "Qwen/Qwen2.5-72B-Instruct-Turbo"}),

        cfg("fireworks", "Fireworks AI", "FIREWORKS_API_KEY", "FIREWORKS_BASE_URL", "FIREWORKS_MODEL",
            "https://api.fireworks.ai/inference/v1", "accounts/fireworks/models/deepseek-v3p1",
            {"accounts/fireworks/models/deepseek-v3p1", "accounts/fireworks/routers/glm-5p2-fast"}),

        cfg("deepinfra", "DeepInfra", "DEEPINFRA_API_KEY", "DEEPINFRA_BASE_URL", "DEEPINFRA_MODEL",
            "https://api.deepinfra.com/v1/openai", "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            {"meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct"}),

        cfg("perplexity", "Perplexity Sonar", "PERPLEXITY_API_KEY", "PERPLEXITY_BASE_URL", "PERPLEXITY_MODEL",
            "https://api.perplexity.ai", "sonar-pro",
            {"sonar-pro", "sonar"}, true, {}, {{"search_grounded", true}}),

        cfg("mistral", "Mistral AI", "MISTRAL_API_KEY", "MISTRAL_BASE_URL", "MISTRAL_MODEL",
            "https://api.mistral.ai/v1", "mistral-small-latest",
            {"mistral-small-latest", "mistral-medium-latest"}),

        cfg("cerebras", "Cerebras Inference", "CEREBRAS_API_KEY", "CEREBRAS_BASE_URL", "CEREBRAS_MODEL",
            "https://api.cerebras.ai/v1", "llama3.1-8b",
            {"llama3.1-8b", "llama-3.3-70b"}),

        cfg("sambanova", "SambaNova Cloud", "SAMBANOVA_API_KEY", "SAMBANOVA_BASE_URL", "SAMBANOVA_MODEL",
            "https://api.sambanova.ai/v1", "Meta-Llama-3.3-70B-Instruct",
            {"Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3.1", "DeepSeek-V3.2"}),

        cfg("zai", "Z.ai / GLM", "ZAI_API_KEY", "ZAI_BASE_URL", "ZAI_MODEL",
            "https://api.z.ai/api/paas/v4", "glm-5.2",
            {"glm-5.2", "glm-4.7"}, true, {}, {{"vendor", "zai"}}),

        cfg("ollama", "Ollama (local OpenAI-compatible)", "OLLAMA_API_KEY", "OLLAMA_BASE_URL", "OLLAMA_MODEL",
            "http://127.0.0.1:11434/v1", "llama3.2",
            {"llama3.2", "mistral", "qwen2.5"}, false, {}, {{"local", true}}),

        cfg("opencode-go", "OpenCode Go", "OPENCODE_API_KEY", "OPENCODE_GO_BASE_URL", "OPENCODE_GO_MODEL",
            "https://opencode.ai/zen/go/v1", "deepseek-v4-flash",
            {"deepseek-v4-flash"}, true, {}, {{"vendor", "opencode"}, {"flavor", "go"}}),

        cfg("opencode-zen", "OpenCode Zen", "OPENCODE_API_KEY", "OPENCODE_ZEN_BASE_URL", "OPENCODE_ZEN_MODEL",
            "https://opencode.ai/zen/v1", "gpt-5.4",
            {"gpt-5.4"}, true, {}, {{"vendor", "opencode"}, {"flavor", "zen"}}),
    };
}

// Join base_url (often .../v1) with chat completions path.
std::string default_api_path_for_base(const std::string& base_url) {
    // OpenAiCompatibleProvider joins base path + api_path.
    // We pass base_url as full prefix including /v1 and path /chat/completions.
    (void)base_url;
    return "/chat/completions";
}

}  // namespace

nlohmann::json NativeProviderConfig::to_json() const {
    nlohmann::json header_env_json = nlohmann::json::object();
    for (const auto& kv : headers_env) {
        header_env_json[kv.first] = kv.second;
    }
    return nlohmann::json{
        {"name", name},
        {"display_name", display_name},
        {"api_key_env", api_key_env},
        {"base_url_env", base_url_env},
        {"model_env", model_env},
        {"default_base_url", default_base_url},
        {"default_model", default_model},
        {"suggested_models", suggested_models},
        {"supports_models_endpoint", supports_models_endpoint},
        {"requires_api_key", requires_api_key},
        {"headers_env", header_env_json},
        {"metadata", metadata.is_null() ? nlohmann::json::object() : metadata},
    };
}

nlohmann::json ResolvedProviderSettings::to_json() const {
    nlohmann::json header_json = nlohmann::json::object();
    for (const auto& kv : headers) {
        header_json[kv.first] = kv.second;
    }
    return nlohmann::json{
        {"name", name},
        {"display_name", display_name},
        {"base_url", base_url},
        {"model", model},
        {"api_key_set", !api_key.empty()},
        {"api_path", api_path},
        {"headers", header_json},
        {"metadata", metadata},
    };
}

std::string env_or_empty(std::string_view key) {
    if (key.empty()) return {};
#if defined(_MSC_VER)
    char* buf = nullptr;
    size_t len = 0;
    if (_dupenv_s(&buf, &len, std::string(key).c_str()) == 0 && buf != nullptr) {
        std::string val(buf);
        free(buf);
        return val;
    }
    return {};
#else
    const char* v = std::getenv(std::string(key).c_str());
    return v ? std::string(v) : std::string{};
#endif
}

const std::vector<NativeProviderConfig>& native_provider_configs() {
    static const std::vector<NativeProviderConfig> kCatalog = build_catalog();
    return kCatalog;
}

std::vector<std::string> list_provider_names() {
    std::vector<std::string> names;
    names.reserve(native_provider_configs().size());
    for (const auto& c : native_provider_configs()) names.push_back(c.name);
    return names;
}

const NativeProviderConfig* find_provider_config(std::string_view name) {
    for (const auto& c : native_provider_configs()) {
        if (c.name == name) return &c;
    }
    return nullptr;
}

Result<NativeProviderConfig> get_provider_config(std::string_view name) {
    const auto* c = find_provider_config(name);
    if (!c) {
        return Error::invalid_argument(std::string("unknown provider: ") + std::string(name), "provider");
    }
    return *c;
}

Result<ResolvedProviderSettings> resolve_provider_settings(
    std::string_view name,
    const ProviderResolveOptions& options
) {
    auto cfg_r = get_provider_config(name);
    if (!cfg_r) return cfg_r.error();
    const auto& cfg = cfg_r.value();

    ResolvedProviderSettings s;
    s.name = cfg.name;
    s.display_name = cfg.display_name;
    s.metadata = cfg.metadata;
    s.api_path = default_api_path_for_base(cfg.default_base_url);

    if (cfg.name == "echo") {
        s.model = options.model.empty() ? "echo" : options.model;
        s.base_url = "echo://local";
        return Result<ResolvedProviderSettings>::success(std::move(s));
    }

    s.base_url = !options.base_url.empty()
        ? options.base_url
        : ([&] {
              auto from_env = env_or_empty(cfg.base_url_env);
              return from_env.empty() ? cfg.default_base_url : from_env;
          })();
    s.model = !options.model.empty()
        ? options.model
        : ([&] {
              auto from_env = env_or_empty(cfg.model_env);
              return from_env.empty() ? cfg.default_model : from_env;
          })();
    s.api_key = !options.api_key.empty() ? options.api_key : env_or_empty(cfg.api_key_env);

    for (const auto& [header, env_name] : cfg.headers_env) {
        auto val = env_or_empty(env_name);
        if (!val.empty()) s.headers[header] = val;
    }
    // OpenRouter defaults if missing
    if (cfg.name == "openrouter") {
        if (!s.headers.count("HTTP-Referer")) s.headers["HTTP-Referer"] = "https://github.com/DaosPath/handoffkit";
        if (!s.headers.count("X-Title")) s.headers["X-Title"] = "HandoffKit C++";
    }

    if (cfg.requires_api_key && s.api_key.empty() && !options.allow_missing_key) {
        return Error::provider_failed(
            cfg.api_key_env + " is required for " + cfg.display_name +
            ". Set the environment variable or pass api_key."
        );
    }
    if (s.base_url.empty()) {
        return Error::provider_failed("base_url is empty for provider " + cfg.name);
    }
    if (s.model.empty()) {
        return Error::provider_failed("model is empty for provider " + cfg.name);
    }
    return Result<ResolvedProviderSettings>::success(std::move(s));
}

Result<std::vector<std::string>> list_provider_models(
    std::string_view name,
    const ProviderResolveOptions& options
) {
    auto cfg_result = get_provider_config(name);
    if (!cfg_result) return cfg_result.error();
    const auto& config = cfg_result.value();
    if (!config.supports_models_endpoint) {
        return Error::provider_failed(
            "Provider '" + std::string(name) + "' does not declare a models endpoint"
        );
    }
    if (config.name == "echo") {
        return Result<std::vector<std::string>>::success(config.suggested_models);
    }
    auto settings = resolve_provider_settings(name, options);
    if (!settings) return settings.error();
    OpenAiCompatibleProvider provider(
        settings.value().base_url,
        settings.value().api_key,
        settings.value().model,
        settings.value().api_path,
        settings.value().headers
    );
    return provider.list_models();
}

Result<AnyProvider> make_openai_compatible_provider(const ResolvedProviderSettings& settings) {
    OpenAiCompatibleProvider p(
        settings.base_url,
        settings.api_key,
        settings.model,
        settings.api_path,
        settings.headers
    );
    return Result<AnyProvider>::success(p.as_any());
}

Result<AnyProvider> make_provider(
    std::string_view name,
    const ProviderResolveOptions& options
) {
    if (name == "echo") {
        std::string model = options.model.empty() ? "echo" : options.model;
        return Result<AnyProvider>::success(EchoProvider(std::move(model)).as_any());
    }

    auto settings = resolve_provider_settings(name, options);
    if (!settings) return settings.error();

#if !defined(HANDOFFKIT_WITH_HTTP)
    return Error::provider_failed(
        std::string("Provider '") + std::string(name) +
        "' needs a live HTTP client. Rebuild with -DHANDOFFKIT_WITH_HTTP=ON "
        "(or use provider 'echo' offline)."
    );
#else
    return make_openai_compatible_provider(settings.value());
#endif
}

std::string list_providers_text() {
    std::ostringstream ss;
    ss << "Providers (" << native_provider_configs().size() << "):\n";
    for (const auto& c : native_provider_configs()) {
        const bool key_set = c.api_key_env.empty() ? true : !env_or_empty(c.api_key_env).empty();
        ss << "  - " << c.name << " — " << c.display_name
           << (c.name == "echo" ? " [offline]" : "")
           << (c.requires_api_key ? (key_set ? " [key:set]" : " [key:missing]") : " [key:optional]")
           << "\n"
           << "      base: " << c.default_base_url << "\n"
           << "      model: " << c.default_model
           << (c.model_env.empty() ? "" : std::string(" (env ") + c.model_env + ")")
           << "\n";
        if (!c.suggested_models.empty()) {
            ss << "      suggested:";
            for (const auto& m : c.suggested_models) ss << " " << m;
            ss << "\n";
        }
    }
    ss << "\nLive generate() requires HANDOFFKIT_WITH_HTTP=ON except for echo.\n";
    return ss.str();
}

}  // namespace handoffkit
