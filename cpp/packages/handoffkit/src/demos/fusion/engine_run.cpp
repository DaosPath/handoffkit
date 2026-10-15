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

bool FusionEngine::over_budget() const {
    const std::int64_t deadline = run_deadline_steady_ms_.load();
    return deadline > 0 && fusion_now_steady_ms() >= deadline;
}

void FusionEngine::adopt_run_deadline(const FusionEngine& parent) {
    run_deadline_steady_ms_.store(parent.run_deadline_steady_ms_.load());
}

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

    if (over_budget()) {
        FusionCallRecord rec;
        rec.step_id = step_id;
        rec.role_id = role_id;
        rec.agent_name = agent_name;
        rec.error = "budget_exceeded";
        run.metrics.calls.push_back(rec);
        return Error::invalid_argument("budget_exceeded", "max_total_ms");
    }

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
    opt.max_tokens = config.generation.max_tokens_for_step(step_id);
    opt.temperature = config.generation.temperature;
    opt.top_p = config.generation.top_p;
    opt.extra_body = config.generation.extra_body;
    const std::string full_prompt = "Role: " + system_role + "\nTask: " + user_prompt + "\n";
    const std::string phash = fusion_content_hash(full_prompt);

    FusionCacheStats before;
    if (cache_) before = cache_->stats();

    auto out = provider.generate(full_prompt, opt);
    const auto t1 = fusion_now_unix_ms();

    if (over_budget()) {
        FusionCallRecord rec;
        rec.step_id = step_id;
        rec.role_id = role_id;
        rec.agent_name = agent_name;
        rec.error = "budget_exceeded";
        rec.latency_ms = static_cast<int>(t1 - t0);
        run.metrics.calls.push_back(rec);
        ++run.metrics.llm_calls;
        return Error::invalid_argument("budget_exceeded", "max_total_ms");
    }

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

    const auto run_start_ms = fusion_now_unix_ms();
    run_deadline_steady_ms_.store(config.max_total_ms > 0 ? fusion_now_steady_ms() + config.max_total_ms : 0);
    struct DeadlineClear {
        FusionEngine* engine;
        ~DeadlineClear() {
            if (engine) engine->run_deadline_steady_ms_.store(0);
        }
    } deadline_guard{this};

    Result<FusionRunResult> result = Error::invalid_argument("unknown mode");
    switch (config.mode) {
        case FusionMode::Lean:
            result = run_lean_ultra(config, std::move(provider), false);
            break;
        case FusionMode::Ultra:
            result = run_lean_ultra(config, std::move(provider), true);
            break;
        case FusionMode::Dag:
            result = run_dag(config, std::move(provider));
            break;
        case FusionMode::Panel:
            result = run_panel(config);
            break;
    }
    if (!result) return result;
    // Direct callers (draco, tests, external consumers) get the same
    // budget/call_steps observability as the run() path.
    enrich_report_observability(result.value(), config, run_start_ms);
    return result;
}

void FusionEngine::enrich_report_observability(FusionRunResult& run, const FusionConfig& config,
                                               std::int64_t run_start_ms) {
    if (cache_) {
        run.metrics.cache = cache_->stats();
        run.report["cache_stats"] = cache_->stats().to_json();
        run.report["cache_hit_rate"] = cache_->stats().hit_rate();
    }
    run.report["budget"] = {
        {"max_total_ms", config.max_total_ms},
        {"elapsed_ms", static_cast<int>(fusion_now_unix_ms() - run_start_ms)},
        {"exceeded", over_budget()},
    };
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
}

Result<FusionRunResult> FusionEngine::run(const FusionConfig& config) {
    if (!cache_ && config.cache.enabled) {
        cache_ = std::make_shared<FusionCache>(config.cache);
    }
    const auto run_start_ms = fusion_now_unix_ms();
    run_deadline_steady_ms_.store(config.max_total_ms > 0 ? fusion_now_steady_ms() + config.max_total_ms : 0);
    struct DeadlineClear {
        FusionEngine* engine;
        ~DeadlineClear() {
            if (engine) engine->run_deadline_steady_ms_.store(0);
        }
    } deadline_guard{this};
    auto enrich_report_observability = [&](FusionRunResult& run) {
        this->enrich_report_observability(run, config, run_start_ms);
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

    // Already enriched inside run_with_provider (while the deadline guard is
    // still alive, so budget.exceeded is accurate). Enrich here only to cover
    // fields a future mode might skip; budget keys are preserved as-is.
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
