#pragma once

#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/roles.hpp>
#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/runtime/provider.hpp>

#include <atomic>
#include <cstdint>
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

    /// Inherit the wall-clock deadline from a parent engine (parallel DAG
    /// branch workers). Must be called before the worker's first call_llm.
    void adopt_run_deadline(const FusionEngine& parent);

private:
    std::shared_ptr<FusionCache> cache_;
    /// Wall-clock run deadline (unix ms, 0 = none). Set per run(); read by
    /// call_llm from any branch thread, so it stays atomic.
    std::atomic<std::int64_t> run_deadline_ms_{0};

    [[nodiscard]] bool over_budget() const;

    /// Attach call_steps/cache_stats/budget observability to run.report.
    /// Idempotent: safe to call on both run() and run_with_provider() paths.
    void enrich_report_observability(FusionRunResult& run, const FusionConfig& config,
                                     std::int64_t run_start_ms);

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
    /// Multi-model panel: one LLM call per model/role + deterministic panel judge.
    Result<FusionRunResult> run_panel(const FusionConfig& config);
};

/// Top-level helper used by CLI and demo catalog.
Result<FusionRunResult> run_fusion(const FusionConfig& config);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
