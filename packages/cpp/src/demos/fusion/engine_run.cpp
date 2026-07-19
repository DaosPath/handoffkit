#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/engine_internal.hpp>
#include <handoffkit/demos/fusion/persist.hpp>
#include <handoffkit/demos/fusion/policy.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/provider_wrap.hpp>
#include <handoffkit/demos/fusion/hash.hpp>
#include <handoffkit/demos/fusion/web_research.hpp>
#include <handoffkit/demos/fusion/panel.hpp>
#include <handoffkit/runtime/protocol.hpp>

#include <algorithm>
#include <chrono>

namespace handoffkit {
namespace demos {
namespace fusion {

FusionEngine::FusionEngine(std::shared_ptr<FusionCache> cache) : cache_(std::move(cache)) {}

void FusionEngine::set_cache(std::shared_ptr<FusionCache> cache) { cache_ = std::move(cache); }

Result<std::string> FusionEngine::call_llm(
    FusionRunResult& run,
    AnyProvider& provider,
    const FusionConfig& config,
    std::string step_id,
    std::string role_id,
    std::string agent_name,
    std::string system_role,
    std::string user_prompt
) {
    FusionBudget budget(config.policy);
    for (int i = 0; i < run.metrics.llm_calls; ++i) budget.after_call();

    if (config.ascii_sanitize) {
        user_prompt = sanitize_prompt_text(user_prompt, true);
        system_role = sanitize_prompt_text(system_role, true);
    }

    auto gate = budget.before_call(user_prompt.size() + system_role.size());
    if (!gate) {
        FusionCallRecord rec;
        rec.step_id = step_id;
        rec.role_id = role_id;
        rec.agent_name = agent_name;
        rec.error = gate.error().message;
        run.metrics.calls.push_back(rec);
        return gate.error();
    }

    const auto t0 = fusion_now_unix_ms();
    GenerateOptions opt;
    opt.agent_name = agent_name;
    opt.task = config.task;
    const std::string full_prompt = "Role: " + system_role + "\nTask: " + user_prompt + "\n";
    const std::string phash = fusion_content_hash(full_prompt);

    FusionCacheStats before;
    if (cache_) before = cache_->stats();

    auto out = provider.generate(full_prompt, opt);
    const auto t1 = fusion_now_unix_ms();

    FusionCallRecord rec;
    rec.step_id = std::move(step_id);
    rec.role_id = std::move(role_id);
    rec.agent_name = std::move(agent_name);
    rec.model = std::string(provider.model());
    rec.latency_ms = static_cast<int>(t1 - t0);
    rec.chars_in = full_prompt.size();
    rec.prompt_hash = phash;
    if (cache_) {
        const auto after = cache_->stats();
        rec.cache_hit = after.hits > before.hits;
    }
    if (!out) {
        rec.error = out.error().message;
        run.metrics.calls.push_back(rec);
        ++run.metrics.llm_calls;
        return out.error();
    }
    rec.chars_out = out.value().size();
    run.metrics.calls.push_back(rec);
    ++run.metrics.llm_calls;
    return out;
}

Result<FusionRunResult> FusionEngine::run_with_provider(const FusionConfig& config, AnyProvider provider) {
    auto v = validate_fusion_config(config);
    if (!v) return v.error();

    switch (config.mode) {
        case FusionMode::Lean:
            return run_lean_ultra(config, std::move(provider), false);
        case FusionMode::Ultra:
            return run_lean_ultra(config, std::move(provider), true);
        case FusionMode::Dag:
            return run_dag(config, std::move(provider));
        case FusionMode::Panel:
            return run_panel(config);
    }
    return Error::invalid_argument("unknown mode");
}

Result<FusionRunResult> FusionEngine::run(const FusionConfig& config) {
    if (!cache_ && config.cache.enabled) {
        cache_ = std::make_shared<FusionCache>(config.cache);
    }
    auto enrich_report_observability = [&](FusionRunResult& run) {
        if (cache_) {
            run.metrics.cache = cache_->stats();
            run.report["cache_stats"] = cache_->stats().to_json();
            run.report["cache_hit_rate"] = cache_->stats().hit_rate();
        }
        nlohmann::json steps = nlohmann::json::array();
        for (const auto& c : run.metrics.calls) {
            steps.push_back({
                {"step_id", c.step_id},
                {"role_id", c.role_id},
                {"agent_name", c.agent_name},
                {"cache_hit", c.cache_hit},
                {"latency_ms", c.latency_ms},
            });
        }
        run.report["call_steps"] = std::move(steps);
    };

    if (config.mode == FusionMode::Panel) {
        auto result = run_panel(config);
        if (!result) return result;
        // Enrich before write so disk report.json matches in-memory observability.
        enrich_report_observability(result.value());
        if (config.write_files) {
            auto arts = write_fusion_run(result.value());
            if (arts) result.value().artifact_paths = arts.value();
        }
        return result;
    }
    auto provider = make_fusion_provider(config, cache_);
    if (!provider) return provider.error();
    auto result = run_with_provider(config, std::move(provider.value()));
    if (!result) return result;

    // Enrich before write so persisted report includes call_steps/cache_stats.
    enrich_report_observability(result.value());
    if (config.write_files) {
        auto arts = write_fusion_run(result.value());
        if (arts) {
            result.value().artifact_paths = arts.value();
        }
    }
    return result;
}

Result<FusionRunResult> run_fusion(const FusionConfig& config) {
    FusionEngine engine;
    return engine.run(config);
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
