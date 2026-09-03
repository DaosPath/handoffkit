#pragma once

#include <handoffkit/runtime/provider.hpp>

#include <string>
#include <string_view>

namespace handoffkit {

/// Deterministic offline provider for tests and demos.
class EchoProvider {
public:
    explicit EchoProvider(std::string model = "echo") : model_(std::move(model)) {}

    [[nodiscard]] std::string_view model() const noexcept { return model_; }

    Result<std::string> generate(std::string_view prompt, const GenerateOptions& options = {}) const {
        std::string out = "EchoProvider(" + model_ + "): ";
        if (!options.agent_name.empty()) {
            out += "[" + options.agent_name + "] ";
        }
        out.append(prompt.data(), prompt.size());
        return Result<std::string>::success(std::move(out));
    }

    [[nodiscard]] AnyProvider as_any() const {
        return AnyProvider::from(*this);
    }

private:
    std::string model_;
};

}  // namespace handoffkit
