#pragma once

// Keep in sync with project(VERSION) in CMakeLists.txt and conanfile.py.
#define HANDOFFKIT_VERSION_MAJOR 1
#define HANDOFFKIT_VERSION_MINOR 14
#define HANDOFFKIT_VERSION_PATCH 1
#define HANDOFFKIT_VERSION_STRING "1.14.1"

namespace handoffkit {

inline constexpr const char* version() noexcept {
    return HANDOFFKIT_VERSION_STRING;
}

}  // namespace handoffkit
