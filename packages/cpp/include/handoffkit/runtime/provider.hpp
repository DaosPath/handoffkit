#pragma once

#include <handoffkit/error.hpp>

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

/// Type-erased LLM/provider backend (sync-first).
class AnyProvider {
public:
    using GenerateFn = std::function<Result<std::string>(std::string_view prompt, const GenerateOptions& options)>;

    AnyProvider() = default;

    AnyProvider(std::string model, GenerateFn generate)
        : model_(std::move(model)), generate_(std::move(generate)) {}

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
            return Error::provider_failed("Provider is not configured.");
        }
        return generate_(prompt, options);
    }

private:
    std::string model_;
    GenerateFn generate_;
};

}  // namespace handoffkit
