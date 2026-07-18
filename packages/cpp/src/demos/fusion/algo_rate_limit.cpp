#include <handoffkit/demos/fusion/algo_rate_limit.hpp>
#include <algorithm>
namespace handoffkit { namespace demos { namespace fusion {

TokenBucket::TokenBucket(double rate_per_sec, double burst)
  : rate_(rate_per_sec), burst_(burst), tokens_(burst), last_ms_(0) {}

bool TokenBucket::try_take(double tokens, std::int64_t now_ms) {
  if (last_ms_ == 0) last_ms_ = now_ms;
  double elapsed = std::max(0.0, double(now_ms - last_ms_) / 1000.0);
  tokens_ = std::min(burst_, tokens_ + elapsed * rate_);
  last_ms_ = now_ms;
  if (tokens_ + 1e-9 < tokens) return false;
  tokens_ -= tokens;
  return true;
}
nlohmann::json TokenBucket::to_json() const {
  return nlohmann::json{{"rate",rate_},{"burst",burst_},{"tokens",tokens_},{"last_ms",last_ms_}};
}

SlidingWindowLimiter::SlidingWindowLimiter(int max_events, int window_ms)
  : max_events_(max_events), window_ms_(window_ms) {}

bool SlidingWindowLimiter::try_admit(std::int64_t now_ms) {
  while (!events_.empty() && now_ms - events_.front() > window_ms_) events_.pop_front();
  if ((int)events_.size() >= max_events_) return false;
  events_.push_back(now_ms);
  return true;
}
nlohmann::json SlidingWindowLimiter::to_json() const {
  return nlohmann::json{{"max_events",max_events_},{"window_ms",window_ms_},{"size",events_.size()}};
}

FusionCallGate::FusionCallGate(int max_calls, int max_per_minute, double burst)
  : max_calls_(max_calls),
    per_min_(max_per_minute, 60'000),
    bucket_(double(max_per_minute)/60.0, burst) {}

CallGateDecision FusionCallGate::admit(std::int64_t now_ms, int prompt_chars, int max_prompt_chars) {
  CallGateDecision d;
  d.details["used"] = used_;
  d.details["max_calls"] = max_calls_;
  if (used_ >= max_calls_) {
    d.allowed = false; d.reason = "max_calls";
    return d;
  }
  if (prompt_chars > max_prompt_chars) {
    d.allowed = false; d.reason = "prompt_too_large";
    d.details["prompt_chars"] = prompt_chars;
    return d;
  }
  // cost scales mildly with prompt size
  double cost = 1.0 + double(prompt_chars) / 4000.0;
  if (!bucket_.try_take(cost, now_ms)) {
    d.allowed = false; d.reason = "token_bucket";
    d.details["bucket"] = bucket_.to_json();
    return d;
  }
  if (!per_min_.try_admit(now_ms)) {
    d.allowed = false; d.reason = "per_minute";
    d.details["window"] = per_min_.to_json();
    return d;
  }
  ++used_;
  d.allowed = true;
  d.reason = "ok";
  d.details["cost"] = cost;
  d.details["used_after"] = used_;
  return d;
}
nlohmann::json FusionCallGate::to_json() const {
  return nlohmann::json{
    {"max_calls", max_calls_}, {"used", used_},
    {"bucket", bucket_.to_json()}, {"per_min", per_min_.to_json()},
  };
}

}}}
