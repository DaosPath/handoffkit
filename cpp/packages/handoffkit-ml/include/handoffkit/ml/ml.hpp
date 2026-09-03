#pragma once

// Umbrella header for the optional HandoffKit ML complement.
// This is NOT part of handoffkit_core. Do not install/link this from light consumers.

#include <handoffkit/ml/version.hpp>

namespace handoffkit {
namespace ml {

/// High-level capability flags for the current build (grow with phases).
struct Capabilities {
    bool tensor_cpu = false;       // Fase 1
    bool mini_transformer = false; // Fase 2
    bool lora = false;             // Fase 3
    bool cuda = false;             // Fase 4 compile path
    bool preference = false;       // Fase 5
    bool quant_stub = false;       // Fase 6
    bool dist_stub = false;        // Fase 6
};

[[nodiscard]] Capabilities capabilities() noexcept;

/// Human-readable status for CLI / doctor.
[[nodiscard]] const char* status_message() noexcept;

}  // namespace ml
}  // namespace handoffkit
