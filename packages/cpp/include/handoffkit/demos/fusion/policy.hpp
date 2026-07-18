#pragma once

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/error.hpp>

namespace handoffkit {
namespace demos {
namespace fusion {

class FusionBudget {
public:
    explicit FusionBudget(FusionPolicyConfig policy);

    [[nodiscard]] const FusionPolicyConfig& policy() const noexcept { return policy_; }
    [[nodiscard]] int calls_used() const noexcept { return calls_used_; }
    [[nodiscard]] std::int64_t started_ms() const noexcept { return started_ms_; }

    Result<void> before_call(std::size_t prompt_chars);
    void after_call();

    [[nodiscard]] bool wall_exceeded() const;
    [[nodiscard]] int remaining_calls() const;

    nlohmann::json to_json() const;

private:
    FusionPolicyConfig policy_;
    int calls_used_ = 0;
    std::int64_t started_ms_ = 0;
};

Result<void> validate_fusion_config(const FusionConfig& config);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
