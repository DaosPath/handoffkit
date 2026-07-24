#pragma once

#include <handoffkit/error.hpp>

#include <nlohmann/json.hpp>

#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <utility>

namespace handoffkit {

struct GenerateOptions {
    std::string agent_name;
    std::string task;
    std::string context;
    /// 0 lets the provider choose. Thinking models should receive enough room for reasoning + final content.
    int max_tokens = 0;
    /// Negative means provider default.
    double temperature = -1.0;
    /// Negative means provider default.
    double top_p = -1.0;
    /// Provider-specific OpenAI-compatible request fields.
    nlohmann::json extra_body = nlohmann::json::object();
};

/// Call-level usage metrics (snake_case JSON for reports / Studio).
/// Token estimates are chars/4 when the backend does not return real usage.
struct ProviderUsage {
    std::size_t prompt_chars = 0;
    std::size_t completion_chars = 0;
    std::size_t prompt_tokens_est = 0;
    std::size_t completion_tokens_est = 0;
    std::string model;
    bool success = false;
    std::string error;
    /// Which backend answered (fallback chain) — empty if single provider.
    std::string selected_model;

    nlohmann::json to_json() const {
        return nlohmann::json{
            {"prompt_chars", prompt_chars},
            {"completion_chars", completion_chars},
            {"prompt_tokens_est", prompt_tokens_est},
            {"completion_tokens_est", completion_tokens_est},
            {"model", model},
            {"success", success},
            {"error", error},
            {"selected_model", selected_model},
        };
    }

    static std::size_t estimate_tokens(std::size_t chars) noexcept {
        return chars == 0 ? 0 : (chars + 3) / 4;
    }
};

/// Type-erased LLM/provider backend (sync-first).
class AnyProvider {
public:
    using GenerateFn = std::function<Result<std::string>(std::string_view prompt, const GenerateOptions& options)>;

    AnyProvider()
        : usage_(std::make_shared<ProviderUsage>()),
          usage_mutex_(std::make_shared<std::mutex>()) {}

    AnyProvider(std::string model, GenerateFn generate)
        : model_(std::move(model)),
          generate_(std::move(generate)),
          usage_(std::make_shared<ProviderUsage>()),
          usage_mutex_(std::make_shared<std::mutex>()) {}

    template <typename Provider>
    static AnyProvider from(Provider provider) {
        std::string model = std::string(provider.model());
        return AnyProvider(
            std::move(model),
            [provider = std::move(provider)](std::string_view prompt, const GenerateOptions& options) mutable {
                return provider.generate(prompt, options);
            }
        );
    }

    [[nodiscard]] bool valid() const noexcept { return static_cast<bool>(generate_); }

    [[nodiscard]] std::string_view model() const noexcept { return model_; }

    /// Calls the backend and atomically publishes the completed usage snapshot.
    /// The metrics are safe across copied AnyProvider handles. The backend callable itself
    /// must still support concurrent calls when generate() is invoked concurrently.
    Result<std::string> generate(std::string_view prompt, const GenerateOptions& options = {}) const {
        ProviderUsage usage;
        usage.prompt_chars = prompt.size();
        usage.prompt_tokens_est = ProviderUsage::estimate_tokens(prompt.size());
        usage.model = model_;

        if (!generate_) {
            usage.success = false;
            usage.error = "Provider is not configured.";
            publish_usage(std::move(usage));
            return Error::provider_failed("Provider is not configured.");
        }

        auto out = generate_(prompt, options);
        usage.selected_model = model_;
        if (out) {
            usage.completion_chars = out.value().size();
            usage.completion_tokens_est = ProviderUsage::estimate_tokens(out.value().size());
            usage.success = true;
        } else {
            usage.success = false;
            usage.error = out.error().message;
        }
        publish_usage(std::move(usage));
        return out;
    }

    /// Last completed generate() usage (shared across copies of this AnyProvider).
    [[nodiscard]] ProviderUsage last_usage() const {
        if (!usage_ || !usage_mutex_) return ProviderUsage{};
        std::lock_guard<std::mutex> lock(*usage_mutex_);
        return *usage_;
    }

    /// Legacy direct access to the shared slot. Prefer last_usage(); callers that mutate
    /// this pointer are responsible for their own synchronization.
    [[nodiscard]] std::shared_ptr<ProviderUsage> usage_slot() const { return usage_; }

private:
    void publish_usage(ProviderUsage usage) const {
        if (!usage_ || !usage_mutex_) return;
        std::lock_guard<std::mutex> lock(*usage_mutex_);
        *usage_ = std::move(usage);
    }

    std::string model_;
    GenerateFn generate_;
    std::shared_ptr<ProviderUsage> usage_;
    std::shared_ptr<std::mutex> usage_mutex_;
};

}  // namespace handoffkit
