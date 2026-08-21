#pragma once

#include <handoffkit/error.hpp>
#include <handoffkit/handoff.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {

enum class ProtocolMode {
    Natural,
    Compressed,
    HybridMin,
    HybridState,
};

[[nodiscard]] inline std::string_view protocol_mode_name(ProtocolMode mode) noexcept {
    switch (mode) {
        case ProtocolMode::Natural: return "natural";
        case ProtocolMode::Compressed: return "compressed";
        case ProtocolMode::HybridMin: return "hybrid_min";
        case ProtocolMode::HybridState: return "hybrid_state";
    }
    return "hybrid_state";
}

[[nodiscard]] inline Result<ProtocolMode> parse_protocol_mode(std::string_view name) {
    if (name == "natural") return ProtocolMode::Natural;
    if (name == "compressed") return ProtocolMode::Compressed;
    if (name == "hybrid_min") return ProtocolMode::HybridMin;
    if (name == "hybrid_state") return ProtocolMode::HybridState;
    return Error::protocol_unsupported(std::string("Unsupported handoff protocol mode: ") + std::string(name));
}

struct TransferOptions {
    std::string task;
    std::string from_agent;
    std::string to_agent;
    std::string summary;
    std::vector<std::string> decisions;
    std::vector<std::string> important_files;
    std::vector<std::string> errors;
    std::vector<std::string> next_steps;
    std::vector<std::string> context_refs;
    nlohmann::json metadata = nlohmann::json::object();
};

class HandoffProtocol {
public:
    explicit HandoffProtocol(ProtocolMode mode = ProtocolMode::HybridState) : mode_(mode) {}

    explicit HandoffProtocol(std::string_view mode_name) {
        auto parsed = parse_protocol_mode(mode_name);
        if (!parsed) {
            mode_ = ProtocolMode::HybridState;
            // Constructor stays noexcept-friendly; transfer will still work with default.
            // Prefer HandoffProtocol::create for fallible construction.
        } else {
            mode_ = parsed.value();
        }
    }

    static Result<HandoffProtocol> create(std::string_view mode_name) {
        auto parsed = parse_protocol_mode(mode_name);
        if (!parsed) {
            return parsed.error();
        }
        return HandoffProtocol(parsed.value());
    }

    [[nodiscard]] ProtocolMode mode() const noexcept { return mode_; }
    [[nodiscard]] std::string_view mode_name() const noexcept { return protocol_mode_name(mode_); }

    Result<HandoffState> transfer(const TransferOptions& options) const;

private:
    ProtocolMode mode_;
};

}  // namespace handoffkit
