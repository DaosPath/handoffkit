#pragma once

#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/runtime/provider.hpp>

#include <memory>
#include <string>

namespace handoffkit {
namespace demos {
namespace fusion {

/// Wraps any provider with fusion cache lookups.
/// Cache key uses provider name + model + prompt body.
class CachingProvider {
public:
    CachingProvider(
        AnyProvider inner,
        std::shared_ptr<FusionCache> cache,
        std::string provider_name,
        std::string profile,
        std::string mode
    );

    [[nodiscard]] std::string_view model() const;
    Result<std::string> generate(std::string_view prompt, const GenerateOptions& options = {});

    [[nodiscard]] AnyProvider as_any() const;

    [[nodiscard]] FusionCacheStats stats_snapshot() const;

private:
    AnyProvider inner_;
    std::shared_ptr<FusionCache> cache_;
    std::string provider_name_;
    std::string profile_;
    std::string mode_;
    std::string model_;
};

Result<AnyProvider> make_fusion_provider(
    const FusionConfig& config,
    std::shared_ptr<FusionCache> cache,
    std::string model_override = {}
);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
