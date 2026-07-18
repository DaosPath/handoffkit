#pragma once

#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/roles.hpp>
#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/runtime/provider.hpp>

#include <memory>

namespace handoffkit {
namespace demos {
namespace fusion {

class FusionEngine {
public:
    FusionEngine() = default;
    explicit FusionEngine(std::shared_ptr<FusionCache> cache);

    void set_cache(std::shared_ptr<FusionCache> cache);
    [[nodiscard]] std::shared_ptr<FusionCache> cache() const { return cache_; }

    /// Run full fusion pipeline (lean/ultra/dag) with configured provider.
    Result<FusionRunResult> run(const FusionConfig& config);

    /// Run with an already-built provider (tests / custom wraps).
    Result<FusionRunResult> run_with_provider(const FusionConfig& config, AnyProvider provider);

private:
    std::shared_ptr<FusionCache> cache_;

    Result<std::string> call_llm(
        FusionRunResult& run,
        AnyProvider& provider,
        const FusionConfig& config,
        std::string step_id,
        std::string role_id,
        std::string agent_name,
        std::string system_role,
        std::string user_prompt
    );

    Result<FusionRunResult> run_lean_ultra(const FusionConfig& config, AnyProvider provider, bool ultra);
    Result<FusionRunResult> run_dag(const FusionConfig& config, AnyProvider provider);
};

/// Top-level helper used by CLI and demo catalog.
Result<FusionRunResult> run_fusion(const FusionConfig& config);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
