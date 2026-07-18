#pragma once
#include <cstdint>
#include <deque>
#include <string>
#include <nlohmann/json.hpp>
#include <handoffkit/error.hpp>
namespace handoffkit { namespace demos { namespace fusion {
// Token-bucket limiter for fusion LLM call budgets (demo-layer simulation)
class TokenBucket {
public:
  TokenBucket(double rate_per_sec, double burst);
  bool try_take(double tokens, std::int64_t now_ms);
  double tokens() const { return tokens_; }
  nlohmann::json to_json() const;
private:
  double rate_;
  double burst_;
  double tokens_;
  std::int64_t last_ms_;
};
// Sliding window: max N events in window_ms
class SlidingWindowLimiter {
public:
  SlidingWindowLimiter(int max_events, int window_ms);
  bool try_admit(std::int64_t now_ms);
  int size() const { return (int)events_.size(); }
  nlohmann::json to_json() const;
private:
  int max_events_;
  int window_ms_;
  std::deque<std::int64_t> events_;
};
// Composite fusion call gate used by policy demos
struct CallGateDecision {
  bool allowed = false;
  std::string reason;
  nlohmann::json details = nlohmann::json::object();
};
class FusionCallGate {
public:
  FusionCallGate(int max_calls, int max_per_minute, double burst);
  CallGateDecision admit(std::int64_t now_ms, int prompt_chars, int max_prompt_chars);
  nlohmann::json to_json() const;
private:
  int max_calls_;
  int used_ = 0;
  SlidingWindowLimiter per_min_;
  TokenBucket bucket_;
};
}}}
