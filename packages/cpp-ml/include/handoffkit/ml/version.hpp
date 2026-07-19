#pragma once

// Independent experimental versioning — not the core handoffkit 1.x line.
#define HANDOFFKIT_ML_VERSION_MAJOR 0
#define HANDOFFKIT_ML_VERSION_MINOR 3
#define HANDOFFKIT_ML_VERSION_PATCH 0
#define HANDOFFKIT_ML_VERSION_STRING "0.3.0"
#define HANDOFFKIT_ML_PHASE "roadmap-A-F-complete"

namespace handoffkit {
namespace ml {

[[nodiscard]] const char* version() noexcept;
[[nodiscard]] const char* phase() noexcept;

}  // namespace ml
}  // namespace handoffkit
