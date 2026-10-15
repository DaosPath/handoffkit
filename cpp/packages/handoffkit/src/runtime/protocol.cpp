#include <handoffkit/runtime/protocol.hpp>

#include <algorithm>
#include <cctype>
#include <sstream>

namespace handoffkit {
namespace {

std::string compact(std::string text, std::size_t max_chars) {
    std::string clean;
    clean.reserve(text.size());
    bool in_space = false;
    for (unsigned char ch : text) {
        if (std::isspace(ch)) {
            if (!in_space && !clean.empty()) {
                clean.push_back(' ');
                in_space = true;
            }
            continue;
        }
        clean.push_back(static_cast<char>(ch));
        in_space = false;
    }
    while (!clean.empty() && clean.back() == ' ') {
        clean.pop_back();
    }
    if (clean.size() <= max_chars) {
        return clean;
    }
    if (max_chars <= 3) {
        return clean.substr(0, max_chars);
    }
    std::string truncated = clean.substr(0, max_chars - 3);
    while (!truncated.empty() && truncated.back() == ' ') {
        truncated.pop_back();
    }
    return truncated + "...";
}

nlohmann::json merge_metadata(nlohmann::json base, const nlohmann::json& extra) {
    if (!extra.is_object()) {
        return base;
    }
    for (auto it = extra.begin(); it != extra.end(); ++it) {
        base[it.key()] = it.value();
    }
    return base;
}

}  // namespace

Result<HandoffState> HandoffProtocol::transfer(const TransferOptions& options) const {
    if (options.task.empty()) {
        return Error::invalid_argument("Transfer requires a non-empty task.", "task");
    }
    if (options.from_agent.empty()) {
        return Error::invalid_argument("Transfer requires from_agent.", "from_agent");
    }
    if (options.to_agent.empty()) {
        return Error::invalid_argument("Transfer requires to_agent.", "to_agent");
    }

    HandoffState state;
    state.task = options.task;
    state.from_agent = options.from_agent;
    state.to_agent = options.to_agent;
    state.summary = options.summary;
    state.decisions = options.decisions;
    state.important_files = options.important_files;
    state.errors = options.errors;
    state.next_steps = options.next_steps;
    state.context_refs = options.context_refs;
    state.metadata = options.metadata.is_null() ? nlohmann::json::object() : options.metadata;

    switch (mode_) {
        case ProtocolMode::Natural: {
            std::ostringstream summary;
            summary << options.from_agent << " is handing off to " << options.to_agent << ". "
                    << "The original task is: " << options.task << ". "
                    << "Progress summary: " << options.summary;
            state.summary = summary.str();
            if (state.next_steps.empty()) {
                state.next_steps = {
                    options.to_agent + " should continue from the summary and preserve task intent."
                };
            }
            state.metadata = merge_metadata(
                nlohmann::json{{"mode", "natural"}, {"format", "human_readable"}},
                state.metadata
            );
            break;
        }
        case ProtocolMode::Compressed: {
            state.task = compact(options.task, 220);
            state.summary = compact(options.summary, 360);
            if (state.next_steps.empty()) {
                state.next_steps = {
                    compact(options.to_agent + ": continue task; preserve constraints; report blockers.", 180)
                };
            } else {
                for (auto& step : state.next_steps) {
                    step = compact(step, 180);
                }
            }
            state.metadata = merge_metadata(
                nlohmann::json{
                    {"mode", "compressed"},
                    {"format", "compact"},
                    {"compression", "whitespace-normalized-char-cap"},
                },
                state.metadata
            );
            break;
        }
        case ProtocolMode::HybridMin: {
            if (state.next_steps.empty()) {
                state.next_steps = {
                    options.to_agent + " should use task and summary as the minimal state contract."
                };
            }
            state.metadata = merge_metadata(
                nlohmann::json{
                    {"mode", "hybrid_min"},
                    {"fields", nlohmann::json::array({"task", "summary", "next_steps"})},
                },
                state.metadata
            );
            break;
        }
        case ProtocolMode::HybridState: {
            if (state.decisions.empty()) {
                state.decisions = {
                    options.from_agent + " completed its current role output."
                };
            }
            if (state.next_steps.empty()) {
                state.next_steps = {
                    options.to_agent + " should inspect the structured handoff.",
                    "Continue the task while preserving decisions and constraints.",
                };
            }
            nlohmann::json base = {
                {"mode", "hybrid_state"},
                {"handoff_version", "1.0"},
                {"state_contract", nlohmann::json::array({
                    "task", "from_agent", "to_agent", "summary", "decisions",
                    "important_files", "errors", "next_steps", "context_refs", "metadata",
                })},
            };
            state.metadata = merge_metadata(std::move(base), state.metadata);
            break;
        }
    }

    return Result<HandoffState>::success(std::move(state));
}

}  // namespace handoffkit
