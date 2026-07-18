#pragma once

// Ordered provider fallback: try primary, then secondaries, until one succeeds.

#include <handoffkit/runtime/provider.hpp>

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
        : chain_(std::move(chain)), label_(std::move(label)) {
        if (label_.empty()) label_ = "fallback";
    }

    [[nodiscard]] std::string_view model() const noexcept { return label_; }

    [[nodiscard]] std::size_t chain_size() const noexcept { return chain_.size(); }

    Result<std::string> generate(std::string_view prompt, const GenerateOptions& options = {}) const {
        last_errors_.clear();
        if (chain_.empty()) {
            last_usage_ = ProviderUsage{};
            last_usage_.model = label_;
            last_usage_.success = false;
            last_usage_.error = "FallbackProvider chain is empty";
            last_usage_.prompt_chars = prompt.size();
            last_usage_.prompt_tokens_est = ProviderUsage::estimate_tokens(prompt.size());
            return Error::provider_failed("FallbackProvider chain is empty");
        }
        for (std::size_t i = 0; i < chain_.size(); ++i) {
            auto& p = chain_[i];
            if (!p.valid()) {
                last_errors_.push_back("slot_" + std::to_string(i) + ": not configured");
                continue;
            }
            auto out = p.generate(prompt, options);
            if (out) {
                last_usage_ = p.last_usage();
                last_usage_.model = label_;
                last_usage_.selected_model = std::string(p.model());
                last_usage_.success = true;
                last_usage_.error.clear();
                return out;
            }
            last_errors_.push_back(
                std::string(p.model()) + ": " + out.error().message
            );
        }
        last_usage_ = ProviderUsage{};
        last_usage_.model = label_;
        last_usage_.prompt_chars = prompt.size();
        last_usage_.prompt_tokens_est = ProviderUsage::estimate_tokens(prompt.size());
        last_usage_.success = false;
        last_usage_.error = "All providers failed";
        for (const auto& e : last_errors_) {
            last_usage_.error += "; " + e;
        }
        return Error::provider_failed(last_usage_.error);
    }

    [[nodiscard]] ProviderUsage last_usage() const { return last_usage_; }

    [[nodiscard]] const std::vector<std::string>& last_errors() const { return last_errors_; }

    [[nodiscard]] AnyProvider as_any() const {
        // Capture chain by value so AnyProvider owns the fallback behavior.
        FallbackProvider copy = *this;
        return AnyProvider(
            label_,
            [copy = std::move(copy)](std::string_view prompt, const GenerateOptions& options) mutable {
                return copy.generate(prompt, options);
            }
        );
    }

private:
    mutable std::vector<AnyProvider> chain_;
    std::string label_;
    mutable ProviderUsage last_usage_{};
    mutable std::vector<std::string> last_errors_{};
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
