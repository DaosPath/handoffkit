#include <handoffkit/demos/fusion/provider_wrap.hpp>
#include <handoffkit/demos/fusion/hash.hpp>
#include <handoffkit/runtime/providers.hpp>

#include <chrono>

namespace handoffkit {
namespace demos {
namespace fusion {

CachingProvider::CachingProvider(
    AnyProvider inner,
    std::shared_ptr<FusionCache> cache,
    std::string provider_name,
    std::string profile,
    std::string mode
)
    : inner_(std::move(inner)),
      cache_(std::move(cache)),
      provider_name_(std::move(provider_name)),
      profile_(std::move(profile)),
      mode_(std::move(mode)),
      model_(std::string(inner_.model())) {}

std::string_view CachingProvider::model() const { return model_; }

Result<std::string> CachingProvider::generate(std::string_view prompt, const GenerateOptions& options) {
    const std::string key = fusion_cache_key_hash(
        provider_name_,
        model_,
        options.agent_name.empty() ? "default" : options.agent_name,
        options.task,
        prompt,
        profile_,
        mode_,
        0.0
    );

    if (cache_) {
        auto hit = cache_->get(key);
        if (hit.has_value()) {
            return Result<std::string>::success(std::move(hit.value()));
        }
    }

    auto out = inner_.generate(prompt, options);
    if (!out) return out;

    if (cache_) {
        nlohmann::json meta{
            {"agent_name", options.agent_name},
            {"provider", provider_name_},
            {"model", model_},
        };
        auto put = cache_->put(key, out.value(), meta);
        if (!put) {
            // cache write failure should not fail generation
        }
    }
    return out;
}

AnyProvider CachingProvider::as_any() const {
    return AnyProvider::from(*this);
}

FusionCacheStats CachingProvider::stats_snapshot() const {
    if (!cache_) return {};
    return cache_->stats();
}

Result<AnyProvider> make_fusion_provider(
    const FusionConfig& config,
    std::shared_ptr<FusionCache> cache,
    std::string model_override
) {
    ProviderResolveOptions opt;
    if (!model_override.empty()) {
        opt.model = model_override;
    } else if (!config.model.empty()) {
        opt.model = config.model;
    }
    auto base = make_provider(config.provider, opt);
    if (!base) return base.error();

    if (!config.cache.enabled || !cache) {
        return base;
    }

    CachingProvider wrapped(
        std::move(base.value()),
        std::move(cache),
        config.provider,
        fusion_profile_to_string(config.profile),
        fusion_mode_to_string(config.mode)
    );
    return wrapped.as_any();
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
