#pragma once

#include <handoffkit/error.hpp>

#include <nlohmann/json.hpp>

#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <utility>

namespace handoffkit {

struct GenerateOptions {
    std::string agent_name;
    std::string task;
    std::string context;
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

    AnyProvider() : usage_(std::make_shared<ProviderUsage>()) {}

    AnyProvider(std::string model, GenerateFn generate)
        : model_(std::move(model)),
          generate_(std::move(generate)),
          usage_(std::make_shared<ProviderUsage>()) {}

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

    Result<std::string> generate(std::string_view prompt, const GenerateOptions& options = {}) const {
        if (!generate_) {
            if (usage_) {
                usage_->prompt_chars = prompt.size();
                usage_->completion_chars = 0;
                usage_->prompt_tokens_est = ProviderUsage::estimate_tokens(prompt.size());
                usage_->completion_tokens_est = 0;
                usage_->model = model_;
                usage_->selected_model.clear();
                usage_->success = false;
                usage_->error = "Provider is not configured.";
            }
            return Error::provider_failed("Provider is not configured.");
        }
        auto out = generate_(prompt, options);
        if (usage_) {
            usage_->prompt_chars = prompt.size();
            usage_->prompt_tokens_est = ProviderUsage::estimate_tokens(prompt.size());
            usage_->model = model_;
            if (!usage_->selected_model.empty() && usage_->selected_model != model_) {
                // keep selected_model if fallback set it before/during call
            } else {
                usage_->selected_model = model_;
            }
            if (out) {
                usage_->completion_chars = out.value().size();
                usage_->completion_tokens_est = ProviderUsage::estimate_tokens(out.value().size());
                usage_->success = true;
                usage_->error.clear();
            } else {
                usage_->completion_chars = 0;
                usage_->completion_tokens_est = 0;
                usage_->success = false;
                usage_->error = out.error().message;
            }
        }
        return out;
    }

    /// Last generate() usage (shared across copies of this AnyProvider).
    [[nodiscard]] ProviderUsage last_usage() const {
        return usage_ ? *usage_ : ProviderUsage{};
    }

    /// Shared usage slot (for FallbackProvider to write selected_model etc.).
    [[nodiscard]] std::shared_ptr<ProviderUsage> usage_slot() const { return usage_; }

private:
    std::string model_;
    GenerateFn generate_;
    std::shared_ptr<ProviderUsage> usage_;
};

}  // namespace handoffkit
