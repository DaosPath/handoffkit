cmake_minimum_required(VERSION 3.15)
project(handoffkit VERSION 1.9.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Fetch nlohmann_json via FetchContent
include(FetchContent)
FetchContent_Declare(
    json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
)
FetchContent_MakeAvailable(json)

# HandoffKit Library
add_library(handoffkit src/handoff.cpp)
target_include_directories(handoffkit PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)
target_link_libraries(handoffkit PRIVATE nlohmann_json)

# Tests
enable_testing()
add_executable(test_handoff tests/test_handoff.cpp)
target_link_libraries(test_handoff PRIVATE handoffkit nlohmann_json)
add_test(NAME test_handoff COMMAND test_handoff)
