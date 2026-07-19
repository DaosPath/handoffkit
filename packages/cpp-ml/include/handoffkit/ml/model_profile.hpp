#pragma once

#include <stdexcept>
#include <string>

namespace handoffkit {
namespace ml {

/// Non-tiny floors for production-oriented profiles (roadmap Phase A).
struct ModelFloors {
    static constexpr int kMinEmb = 128;
    static constexpr int kMinLayer = 4;
    static constexpr int kMinHead = 4;
    static constexpr int kMinBlock = 128;
    static constexpr int kMinVocabBpe = 512;
};

enum class ModelProfile {
    DebugTiny,   // unit tests only (below floors allowed)
    Standard,    // meets floors
    Large,       // larger defaults
};

struct ProfileSpec {
    int n_embd = 128;
    int n_head = 4;
    int n_layer = 4;
    int block_size = 128;
    int vocab_size = 1024;  // BPE default
    std::string arch{"gpt2"};
};

inline ProfileSpec profile_spec(ModelProfile p) {
    ProfileSpec s;
    switch (p) {
        case ModelProfile::DebugTiny:
            s.n_embd = 32;
            s.n_head = 4;
            s.n_layer = 2;
            s.block_size = 64;
            s.vocab_size = 259;  // byte
            s.arch = "gpt-mini";
            break;
        case ModelProfile::Standard:
            s.n_embd = ModelFloors::kMinEmb;
            s.n_head = ModelFloors::kMinHead;
            s.n_layer = ModelFloors::kMinLayer;
            s.block_size = ModelFloors::kMinBlock;
            s.vocab_size = 1024;
            s.arch = "gpt2";
            break;
        case ModelProfile::Large:
            s.n_embd = 256;
            s.n_head = 8;
            s.n_layer = 6;
            s.block_size = 256;
            s.vocab_size = 2048;
            s.arch = "llama-like";
            break;
    }
    return s;
}

inline void enforce_non_tiny(int n_embd, int n_layer, int n_head, int block_size, bool allow_tiny) {
    if (allow_tiny) return;
    if (n_embd < ModelFloors::kMinEmb || n_layer < ModelFloors::kMinLayer ||
        n_head < ModelFloors::kMinHead || block_size < ModelFloors::kMinBlock) {
        throw std::runtime_error(
            "non-tiny profile required: n_embd>=" + std::to_string(ModelFloors::kMinEmb) +
            " n_layer>=" + std::to_string(ModelFloors::kMinLayer) +
            " n_head>=" + std::to_string(ModelFloors::kMinHead) +
            " block_size>=" + std::to_string(ModelFloors::kMinBlock) +
            " (pass allow_tiny / DebugTiny only for unit tests)"
        );
    }
}

inline bool is_allowed_arch(const std::string& arch) {
    return arch == "gpt-mini" || arch == "gpt2" || arch == "llama-like";
}

}  // namespace ml
}  // namespace handoffkit
