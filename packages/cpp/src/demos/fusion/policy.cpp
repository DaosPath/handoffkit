#include <handoffkit/demos/fusion/policy.hpp>

namespace handoffkit {
namespace demos {
namespace fusion {

FusionBudget::FusionBudget(FusionPolicyConfig policy)
    : policy_(std::move(policy)), started_ms_(fusion_now_unix_ms()) {}

Result<void> FusionBudget::before_call(std::size_t prompt_chars) {
    if (policy_.hard_fail_on_budget && calls_used_ >= policy_.max_llm_calls) {
        return Result<void>::failure(Error::provider_failed(
            "fusion budget exceeded: max_llm_calls=" + std::to_string(policy_.max_llm_calls)
        ));
    }
    if (policy_.hard_fail_on_budget && wall_exceeded()) {
        return Result<void>::failure(Error::provider_failed(
            "fusion budget exceeded: max_wall_ms=" + std::to_string(policy_.max_wall_ms)
        ));
    }
    if (static_cast<int>(prompt_chars) > policy_.max_prompt_chars) {
        return Result<void>::failure(Error::invalid_argument(
            "prompt exceeds max_prompt_chars=" + std::to_string(policy_.max_prompt_chars),
            "prompt"
        ));
    }
    return Result<void>::success();
}

void FusionBudget::after_call() {
    ++calls_used_;
    if (policy_.cooldown_ms > 0) {
        // intentional no-op sleep in library; CLI may sleep if desired
    }
}

bool FusionBudget::wall_exceeded() const {
    if (policy_.max_wall_ms <= 0) return false;
    return (fusion_now_unix_ms() - started_ms_) > policy_.max_wall_ms;
}

int FusionBudget::remaining_calls() const {
    return policy_.max_llm_calls - calls_used_;
}

nlohmann::json FusionBudget::to_json() const {
    return nlohmann::json{
        {"policy", policy_.to_json()},
        {"calls_used", calls_used_},
        {"started_ms", started_ms_},
        {"remaining_calls", remaining_calls()},
        {"wall_exceeded", wall_exceeded()},
    };
}

Result<void> validate_fusion_config(const FusionConfig& config) {
    if (config.task.empty()) {
        return Result<void>::failure(Error::invalid_argument("task is required", "task"));
    }
    if (config.provider.empty()) {
        return Result<void>::failure(Error::invalid_argument("provider is required", "provider"));
    }
    if (config.policy.max_llm_calls < 1) {
        return Result<void>::failure(Error::invalid_argument("max_llm_calls must be >= 1", "max_llm_calls"));
    }
    if (config.mode == FusionMode::Ultra && config.policy.max_llm_calls < 5) {
        return Result<void>::failure(Error::invalid_argument("ultra mode needs max_llm_calls >= 5", "max_llm_calls"));
    }
    if (config.mode == FusionMode::Lean && config.policy.max_llm_calls < 3) {
        return Result<void>::failure(Error::invalid_argument("lean mode needs max_llm_calls >= 3", "max_llm_calls"));
    }
    return Result<void>::success();
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
