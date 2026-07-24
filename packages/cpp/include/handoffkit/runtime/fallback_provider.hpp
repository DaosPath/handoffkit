#pragma once

// Ordered provider fallback: try primary, then secondaries, until one succeeds.

#include <handoffkit/runtime/provider.hpp>

#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace handoffkit {

/// Tries each provider in order; returns the first successful generate().
/// Offline-safe with Echo + fail stubs. Records which model answered in last_usage().
class FallbackProvider {
public:
    explicit FallbackProvider(std::vector<AnyProvider> chain, std::string label = "fallback")
        : chain_(std::move(chain)),
          label_(std::move(label)),
          state_(std::make_shared<SharedState>()) {
        if (label_.empty()) label_ = "fallback";
    }

    [[nodiscard]] std::string_view model() const noexcept { return label_; }

    [[nodiscard]] std::size_t chain_size() const noexcept { return chain_.size(); }

    Result<std::string> generate(std::string_view prompt, const GenerateOptions& options = {}) const {
        std::vector<std::string> errors;
        ProviderUsage usage;
        usage.model = label_;
        usage.prompt_chars = prompt.size();
        usage.prompt_tokens_est = ProviderUsage::estimate_tokens(prompt.size());

        if (chain_.empty()) {
            usage.success = false;
            usage.error = "FallbackProvider chain is empty";
            publish(std::move(usage), std::move(errors));
            return Error::provider_failed("FallbackProvider chain is empty");
        }

        for (std::size_t i = 0; i < chain_.size(); ++i) {
            const auto& provider = chain_[i];
            if (!provider.valid()) {
                errors.push_back("slot_" + std::to_string(i) + ": not configured");
                continue;
            }
            auto out = provider.generate(prompt, options);
            if (out) {
                usage.completion_chars = out.value().size();
                usage.completion_tokens_est = ProviderUsage::estimate_tokens(out.value().size());
                usage.selected_model = std::string(provider.model());
                usage.success = true;
                usage.error.clear();
                publish(std::move(usage), std::move(errors));
                return out;
            }
            errors.push_back(std::string(provider.model()) + ": " + out.error().message);
        }

        usage.success = false;
        usage.error = "All providers failed";
        for (const auto& error : errors) usage.error += "; " + error;
        const std::string message = usage.error;
        publish(std::move(usage), std::move(errors));
        return Error::provider_failed(message);
    }

    [[nodiscard]] ProviderUsage last_usage() const {
        std::lock_guard<std::mutex> lock(state_->mutex);
        return state_->usage;
    }

    [[nodiscard]] std::vector<std::string> last_errors() const {
        std::lock_guard<std::mutex> lock(state_->mutex);
        return state_->errors;
    }

    [[nodiscard]] AnyProvider as_any() const {
        FallbackProvider copy = *this;
        return AnyProvider(
            label_,
            [copy = std::move(copy)](std::string_view prompt, const GenerateOptions& options) mutable {
                return copy.generate(prompt, options);
            }
        );
    }

private:
    struct SharedState {
        mutable std::mutex mutex;
        ProviderUsage usage{};
        std::vector<std::string> errors{};
    };

    void publish(ProviderUsage usage, std::vector<std::string> errors) const {
        std::lock_guard<std::mutex> lock(state_->mutex);
        state_->usage = std::move(usage);
        state_->errors = std::move(errors);
    }

    std::vector<AnyProvider> chain_;
    std::string label_;
    std::shared_ptr<SharedState> state_;
};

/// Deterministic always-fail provider for offline fallback tests.
class FailingProvider {
public:
    explicit FailingProvider(std::string model = "fail", std::string message = "forced failure")
        : model_(std::move(model)), message_(std::move(message)) {}

    [[nodiscard]] std::string_view model() const noexcept { return model_; }

    Result<std::string> generate(std::string_view /*prompt*/, const GenerateOptions& = {}) const {
        return Error::provider_failed(message_);
    }

    [[nodiscard]] AnyProvider as_any() const { return AnyProvider::from(*this); }

private:
    std::string model_;
    std::string message_;
};

}  // namespace handoffkit
