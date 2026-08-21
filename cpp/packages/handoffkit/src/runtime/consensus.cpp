#include <handoffkit/runtime/consensus.hpp>

#include <algorithm>
#include <map>
#include <sstream>
#include <unordered_map>

namespace handoffkit {

nlohmann::json Vote::to_json() const {
    return nlohmann::json{
        {"agent", agent},
        {"choice", choice},
        {"confidence", confidence},
        {"rationale", rationale},
    };
}

nlohmann::json ConsensusResult::to_json() const {
    nlohmann::json vs = nlohmann::json::array();
    for (const auto& v : votes) vs.push_back(v.to_json());
    return nlohmann::json{
        {"success", success},
        {"winner", winner},
        {"winner_score", winner_score},
        {"votes", std::move(vs)},
        {"ties", ties},
        {"method", method},
        {"metadata", metadata},
    };
}

std::string ConsensusResult::to_markdown() const {
    std::ostringstream ss;
    ss << "# Consensus (" << method << ")\n\n"
       << "- success: " << (success ? "true" : "false") << "\n"
       << "- winner: " << winner << " (" << winner_score << ")\n";
    if (!ties.empty()) {
        ss << "- ties: " << text::join(ties, ", ") << "\n";
    }
    ss << "\n## Votes\n\n";
    for (const auto& v : votes) {
        ss << "- **" << v.agent << "** → `" << v.choice << "` conf=" << v.confidence
           << " — " << text::truncate(v.rationale, 80) << "\n";
    }
    return ss.str();
}

ConsensusResult ConsensusEngine::majority(const std::vector<Vote>& votes) const {
    ConsensusResult r;
    r.method = "majority";
    r.votes = votes;
    std::unordered_map<std::string, int> counts;
    for (const auto& v : votes) counts[v.choice]++;
    int best = -1;
    for (const auto& [choice, n] : counts) {
        if (n > best) {
            best = n;
            r.winner = choice;
            r.ties.clear();
        } else if (n == best) {
            r.ties.push_back(choice);
        }
    }
    if (!r.winner.empty() && counts[r.winner] == best) {
        // include winner in ties only if others match
        r.ties.erase(std::remove(r.ties.begin(), r.ties.end(), r.winner), r.ties.end());
    }
    r.winner_score = best < 0 ? 0.0 : static_cast<double>(best);
    r.success = !r.winner.empty() && r.ties.empty();
    r.metadata = {{"vote_count", votes.size()}, {"unique_choices", counts.size()}};
    return r;
}

ConsensusResult ConsensusEngine::weighted(const std::vector<Vote>& votes) const {
    ConsensusResult r;
    r.method = "weighted";
    r.votes = votes;
    std::unordered_map<std::string, double> scores;
    for (const auto& v : votes) {
        double w = v.confidence > 0 ? v.confidence : 1.0;
        scores[v.choice] += w;
    }
    double best = -1.0;
    for (const auto& [choice, s] : scores) {
        if (s > best) {
            best = s;
            r.winner = choice;
            r.ties.clear();
        } else if (s == best) {
            r.ties.push_back(choice);
        }
    }
    r.winner_score = best < 0 ? 0.0 : best;
    r.success = !r.winner.empty() && r.ties.empty();
    r.metadata = {{"vote_count", votes.size()}};
    return r;
}

ConsensusResult ConsensusEngine::borda(const std::vector<std::vector<std::string>>& rankings) const {
    ConsensusResult r;
    r.method = "borda";
    std::unordered_map<std::string, double> scores;
    for (const auto& ranking : rankings) {
        const int n = static_cast<int>(ranking.size());
        for (int i = 0; i < n; ++i) {
            scores[ranking[static_cast<std::size_t>(i)]] += static_cast<double>(n - i);
        }
    }
    double best = -1.0;
    for (const auto& [choice, s] : scores) {
        if (s > best) {
            best = s;
            r.winner = choice;
            r.ties.clear();
        } else if (s == best) {
            r.ties.push_back(choice);
        }
    }
    r.winner_score = best < 0 ? 0.0 : best;
    r.success = !r.winner.empty() && r.ties.empty();
    r.metadata = {{"ranking_count", rankings.size()}, {"candidate_count", scores.size()}};
    return r;
}

Result<std::vector<Vote>> ConsensusEngine::collect_echo_votes(
    std::vector<Agent>& agents,
    std::string_view question,
    const std::vector<std::string>& choices
) const {
    if (agents.empty()) return Error::invalid_argument("no agents for votes");
    if (choices.empty()) return Error::invalid_argument("no choices");
    std::vector<Vote> votes;
    votes.reserve(agents.size());
    std::ostringstream prompt;
    prompt << question << "\nChoices:\n";
    for (const auto& c : choices) prompt << "- " << c << "\n";
    prompt << "Reply with one choice on the first line.\n";

    for (std::size_t i = 0; i < agents.size(); ++i) {
        auto out = agents[i].run(prompt.str());
        if (!out) return out.error();
        Vote v;
        v.agent = agents[i].name();
        v.rationale = out.value();
        v.confidence = 0.5 + 0.1 * static_cast<double>(i % 5);
        // pick first matching choice mentioned, else rotate
        v.choice = choices[i % choices.size()];
        for (const auto& c : choices) {
            if (text::contains_ci(out.value(), c)) {
                v.choice = c;
                break;
            }
        }
        votes.push_back(std::move(v));
    }
    return Result<std::vector<Vote>>::success(std::move(votes));
}

Result<nlohmann::json> ConsensusEngine::run_panel(
    std::vector<Agent>& agents,
    std::string_view question,
    const std::vector<std::string>& choices
) const {
    auto votes = collect_echo_votes(agents, question, choices);
    if (!votes) return votes.error();
    auto maj = majority(votes.value());
    auto w = weighted(votes.value());
    // Borda from permuted rankings derived from choices
    std::vector<std::vector<std::string>> rankings;
    for (std::size_t i = 0; i < votes.value().size(); ++i) {
        std::vector<std::string> ranking = choices;
        // rotate so agent i's choice is first if present
        auto it = std::find(ranking.begin(), ranking.end(), votes.value()[i].choice);
        if (it != ranking.end()) {
            std::rotate(ranking.begin(), it, it + 1);
        }
        rankings.push_back(std::move(ranking));
    }
    auto b = borda(rankings);
    return nlohmann::json{
        {"question", std::string(question)},
        {"choices", choices},
        {"majority", maj.to_json()},
        {"weighted", w.to_json()},
        {"borda", b.to_json()},
        {"votes", [&] {
            nlohmann::json arr = nlohmann::json::array();
            for (const auto& v : votes.value()) arr.push_back(v.to_json());
            return arr;
        }()},
    };
}

}  // namespace handoffkit
