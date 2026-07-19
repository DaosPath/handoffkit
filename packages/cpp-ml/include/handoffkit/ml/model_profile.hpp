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
    DebugTiny,     // unit tests only (below floors allowed)
    Comfort,       // local comfortable full SFT (allow_tiny)
    ComfortQlora,  // local comfortable QLoRA (allow_tiny + adapters)
    Standard,      // meets non-tiny floors
    Large,         // larger defaults
};

struct ProfileSpec {
    int n_embd = 128;
    int n_head = 4;
    int n_layer = 4;
    int block_size = 128;
    int vocab_size = 1024;  // BPE default
    std::string arch{"gpt2"};
    // Comfort train knobs (CLI / SftConfig)
    int epochs = 20;
    float lr = 3e-3f;
    bool allow_tiny = false;
    bool use_qlora = false;
    bool use_lora = false;
    int lora_rank = 8;
    bool tokenizer_byte = false;
    int log_every = 0;
    std::string name{"standard"};
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
            s.epochs = 10;
            s.lr = 1e-2f;
            s.allow_tiny = true;
            s.tokenizer_byte = true;
            s.name = "tiny";
            break;
        case ModelProfile::Comfort:
            // One-shot local SFT: fast, reliable loss drop on small JSONL
            s.n_embd = 64;
            s.n_head = 4;
            s.n_layer = 2;
            s.block_size = 48;
            s.vocab_size = 259;
            s.arch = "gpt-mini";
            s.epochs = 40;
            s.lr = 1e-2f;
            s.allow_tiny = true;
            s.tokenizer_byte = true;
            s.log_every = 20;
            s.name = "comfort";
            break;
        case ModelProfile::ComfortQlora:
            s.n_embd = 64;
            s.n_head = 4;
            s.n_layer = 2;
            s.block_size = 48;
            s.vocab_size = 259;
            s.arch = "gpt-mini";
            s.epochs = 40;
            s.lr = 1e-2f;
            s.allow_tiny = true;
            s.use_qlora = true;
            s.lora_rank = 8;
            s.tokenizer_byte = true;
            s.log_every = 20;
            s.name = "qlora";
            break;
        case ModelProfile::Standard:
            s.n_embd = ModelFloors::kMinEmb;
            s.n_head = ModelFloors::kMinHead;
            s.n_layer = ModelFloors::kMinLayer;
            s.block_size = ModelFloors::kMinBlock;
            s.vocab_size = 1024;
            s.arch = "gpt2";
            s.epochs = 20;
            s.lr = 3e-3f;
            s.name = "standard";
            break;
        case ModelProfile::Large:
            s.n_embd = 256;
            s.n_head = 8;
            s.n_layer = 6;
            s.block_size = 256;
            s.vocab_size = 2048;
            s.arch = "llama-like";
            s.epochs = 10;
            s.lr = 1e-3f;
            s.name = "large";
            break;
    }
    return s;
}

/// Parse CLI profile name → enum. Empty / unknown → nullopt via bool ok.
inline bool parse_profile_name(const std::string& name, ModelProfile& out) {
    if (name == "tiny" || name == "debug" || name == "debug-tiny") {
        out = ModelProfile::DebugTiny;
        return true;
    }
    if (name == "comfort" || name == "fast" || name == "local") {
        out = ModelProfile::Comfort;
        return true;
    }
    if (name == "qlora" || name == "comfort-qlora" || name == "q-lora") {
        out = ModelProfile::ComfortQlora;
        return true;
    }
    if (name == "standard" || name == "default" || name == "std") {
        out = ModelProfile::Standard;
        return true;
    }
    if (name == "large") {
        out = ModelProfile::Large;
        return true;
    }
    return false;
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
