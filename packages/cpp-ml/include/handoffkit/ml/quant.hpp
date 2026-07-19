#pragma once

#include <handoffkit/ml/tensor.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

/// F6 stub: quantization API surface (not a full QLoRA engine).
struct QuantConfig {
    int bits = 4;
    std::string scheme{"none"};  // none | int8 | nf4_stub
};

struct QuantizedTensor {
    std::vector<std::uint8_t> packed;
    Tensor scale;  // dequant scales
    QuantConfig cfg;
    std::vector<std::size_t> shape;
};

/// Pack f32 -> crude int8 (symmetric). Real NF4/QLoRA is roadmap.
inline QuantizedTensor quantize_int8(const Tensor& t) {
    QuantizedTensor q;
    q.cfg.bits = 8;
    q.cfg.scheme = "int8";
    q.shape = t.shape;
    float max_abs = 0.f;
    for (float v : t.data) max_abs = std::max(max_abs, std::fabs(v));
    if (max_abs < 1e-8f) max_abs = 1.f;
    q.scale = zeros({1});
    q.scale.data[0] = max_abs / 127.f;
    q.packed.resize(t.numel());
    for (std::size_t i = 0; i < t.numel(); ++i) {
        int v = static_cast<int>(std::round(t.data[i] / q.scale.data[0]));
        if (v > 127) v = 127;
        if (v < -127) v = -127;
        q.packed[i] = static_cast<std::uint8_t>(v + 128);
    }
    return q;
}

inline Tensor dequantize_int8(const QuantizedTensor& q) {
    Tensor t(q.shape);
    for (std::size_t i = 0; i < t.numel(); ++i) {
        int v = static_cast<int>(q.packed[i]) - 128;
        t.data[i] = static_cast<float>(v) * q.scale.data[0];
    }
    return t;
}

/// Multi-GPU / distributed training — F6 explicit non-implementation hooks.
struct DistConfig {
    int world_size = 1;
    int rank = 0;
    std::string backend{"none"};  // none | nccl_stub
};

inline bool dist_available() { return false; }

inline std::string dist_status() {
    return "multi-gpu/NCCL not implemented (F6 roadmap); world_size must be 1";
}

}  // namespace ml
}  // namespace handoffkit
