#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/runtime/agent.hpp>
#include <handoffkit/util/text.hpp>

#include <nlohmann/json.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

struct Vote {
    std::string agent;
    std::string choice;
    double confidence = 0.0;
    std::string rationale;
    nlohmann::json to_json() const;
};

struct ConsensusResult {
    bool success = false;
    std::string winner;
    double winner_score = 0.0;
    std::vector<Vote> votes;
    std::vector<std::string> ties;
    std::string method;  // majority|weighted|borda
    nlohmann::json metadata = nlohmann::json::object();
    nlohmann::json to_json() const;
    std::string to_markdown() const;
};

/// Offline multi-agent consensus helpers (Echo agents produce free text; callers supply votes).
class ConsensusEngine {
public:
    ConsensusResult majority(const std::vector<Vote>& votes) const;
    ConsensusResult weighted(const std::vector<Vote>& votes) const;
    ConsensusResult borda(const std::vector<std::vector<std::string>>& rankings) const;

    /// Ask each agent for a choice label by prompting; parses first line as choice.
    Result<std::vector<Vote>> collect_echo_votes(
        std::vector<Agent>& agents,
        std::string_view question,
        const std::vector<std::string>& choices
    ) const;

    /// Full panel: collect votes then majority+weighted summaries.
    Result<nlohmann::json> run_panel(
        std::vector<Agent>& agents,
        std::string_view question,
        const std::vector<std::string>& choices
    ) const;
};

}  // namespace handoffkit
