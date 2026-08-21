# Standalone consumer: uses an *installed* HandoffKit prefix only.
# Does not add_subdirectory the monorepo — validates find_package + handoffkit::core.
#
#   cmake --install <handoffkit-build> --prefix /path/to/prefix
#   cmake -S . -B build -DCMAKE_PREFIX_PATH=/path/to/prefix
#   cmake --build build
#   ./build/consumer_core

cmake_minimum_required(VERSION 3.16)
project(handoffkit_consumer_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(handoffkit CONFIG REQUIRED)

if(NOT TARGET handoffkit::core)
  message(FATAL_ERROR
    "handoffkit::core not found. Install a build that exports handoffkit_core "
    "(monorepo packages/cpp with current CMakeLists)."
  )
endif()

add_executable(consumer_core main.cpp)
target_link_libraries(consumer_core PRIVATE handoffkit::core)

# Optional: prove the full monorepo target also exists when demos were installed
if(TARGET handoffkit::handoffkit)
  message(STATUS "handoffkit::handoffkit is available (demos were part of the install)")
endif()
