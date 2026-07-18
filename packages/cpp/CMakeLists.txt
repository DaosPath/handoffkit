cmake_minimum_required(VERSION 3.16)
project(handoffkit VERSION 1.14.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(HANDOFFKIT_BUILD_TESTS "Build HandoffKit unit/contract tests" ON)
option(HANDOFFKIT_BUILD_EXAMPLES "Build HandoffKit examples" ON)
option(HANDOFFKIT_BUILD_CLI "Build handoffkit-cli offline binary" ON)
option(HANDOFFKIT_FETCH_JSON "Fetch nlohmann_json via FetchContent when not found" ON)
option(HANDOFFKIT_WITH_HTTP "Build optional OpenAI-compatible HTTP provider (cpp-httplib)" OFF)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

# --- nlohmann_json ---
set(HANDOFFKIT_BUNDLED_JSON OFF)
find_package(nlohmann_json 3.11 QUIET CONFIG)
if(NOT nlohmann_json_FOUND)
  if(NOT HANDOFFKIT_FETCH_JSON)
    message(FATAL_ERROR "nlohmann_json not found and HANDOFFKIT_FETCH_JSON=OFF")
  endif()
  include(FetchContent)
  FetchContent_Declare(
    json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  )
  FetchContent_MakeAvailable(json)
  set(HANDOFFKIT_BUNDLED_JSON ON)
endif()

if(HANDOFFKIT_WITH_HTTP)
  find_package(OpenSSL)
  if(NOT OpenSSL_FOUND)
    # Strawberry Perl OpenSSL (common on this Windows dev box)
    if(EXISTS "C:/Strawberry/c/include/openssl/ssl.h")
      set(OPENSSL_ROOT_DIR "C:/Strawberry/c")
      set(OPENSSL_INCLUDE_DIR "C:/Strawberry/c/include")
      set(OPENSSL_CRYPTO_LIBRARY "C:/Strawberry/c/lib/libcrypto.a")
      set(OPENSSL_SSL_LIBRARY "C:/Strawberry/c/lib/libssl.a")
      find_package(OpenSSL REQUIRED)
    else()
      message(FATAL_ERROR "HANDOFFKIT_WITH_HTTP=ON requires OpenSSL for HTTPS providers")
    endif()
  endif()
  include(FetchContent)
  set(HTTPLIB_REQUIRE_OPENSSL ON CACHE BOOL "" FORCE)
  set(HTTPLIB_USE_OPENSSL_IF_AVAILABLE ON CACHE BOOL "" FORCE)
  FetchContent_Declare(
    httplib
    URL https://github.com/yhirose/cpp-httplib/archive/refs/tags/v0.18.3.tar.gz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  )
  FetchContent_MakeAvailable(httplib)
endif()

# --- library ---
set(HANDOFFKIT_SOURCES
  src/handoff.cpp
  src/core/validation.cpp
  src/core/quality.cpp
  src/runtime/protocol.cpp
  src/runtime/agent.cpp
  src/runtime/team.cpp
  src/runtime/trace.cpp
  src/runtime/http_provider.cpp
  src/runtime/providers.cpp
  src/runtime/builtin_tools.cpp
  src/runtime/orchestrator.cpp
  src/runtime/structured.cpp
  src/runtime/replay.cpp
  src/runtime/policy.cpp
  src/runtime/consensus.cpp
  src/runtime/scheduler.cpp
  src/runtime/diff_score.cpp
  src/explore/web_types.cpp
  src/explore/html_extract.cpp
  src/explore/transport.cpp
  src/explore/explorer.cpp
  src/explore/tools.cpp
  src/util/text.cpp
  src/evaluation/workflow_eval.cpp
  src/workflows/recipe.cpp
  src/workflows/templates.cpp
  src/io/reports.cpp
  src/io/html_report.cpp
  src/io/report_gallery.cpp
  src/io/markdown_table.cpp
  src/demos/cases_corpus.cpp
  src/demos/demo_common.cpp
  src/demos/demo_showcases.cpp
  src/demos/demo_deep_pipelines.cpp
  src/demos/scenario_engine.cpp
  src/demos/demo_consensus_bench.cpp
  src/demos/demo_scheduler_dag.cpp
  src/demos/demo_diff_regression.cpp
  src/demos/demo_catalog.cpp
  src/cli/cli_app.cpp
)

# Fusion-style demo suite (all TUs under src/demos/fusion/)
file(GLOB_RECURSE HANDOFFKIT_FUSION_SOURCES CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/src/demos/fusion/*.cpp"
)
list(APPEND HANDOFFKIT_SOURCES ${HANDOFFKIT_FUSION_SOURCES})

add_library(handoffkit ${HANDOFFKIT_SOURCES})
add_library(handoffkit::handoffkit ALIAS handoffkit)

target_include_directories(handoffkit
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)

# Public headers include <nlohmann/json.hpp>. Link nlohmann only in the build
# tree so install(EXPORT) does not require exporting FetchContent targets.
target_link_libraries(handoffkit PUBLIC $<BUILD_INTERFACE:nlohmann_json::nlohmann_json>)

if(HANDOFFKIT_WITH_HTTP)
  target_compile_definitions(handoffkit PUBLIC HANDOFFKIT_WITH_HTTP=1 CPPHTTPLIB_OPENSSL_SUPPORT)
  target_link_libraries(handoffkit PUBLIC
    $<BUILD_INTERFACE:httplib::httplib>
    OpenSSL::SSL
    OpenSSL::Crypto
  )
  if(WIN32)
    target_link_libraries(handoffkit PUBLIC ws2_32 crypt32)
  endif()
endif()

target_compile_features(handoffkit PUBLIC cxx_std_20)

if(MSVC)
  target_compile_options(handoffkit PRIVATE /W4 /permissive-)
else()
  target_compile_options(handoffkit PRIVATE -Wall -Wextra -Wpedantic)
endif()

set_target_properties(handoffkit PROPERTIES
  VERSION ${PROJECT_VERSION}
  SOVERSION ${PROJECT_VERSION_MAJOR}
  EXPORT_NAME handoffkit
  OUTPUT_NAME handoffkit
)

# --- tests ---
if(HANDOFFKIT_BUILD_TESTS)
  enable_testing()

  set(_default_contracts "${CMAKE_CURRENT_SOURCE_DIR}/../contracts")
  if(DEFINED ENV{HANDOFFKIT_CONTRACTS_DIR})
    set(HANDOFFKIT_CONTRACTS_DIR "$ENV{HANDOFFKIT_CONTRACTS_DIR}")
  elseif(EXISTS "${_default_contracts}/fixtures")
    set(HANDOFFKIT_CONTRACTS_DIR "${_default_contracts}")
  else()
    set(HANDOFFKIT_CONTRACTS_DIR "")
  endif()

  function(handoffkit_add_test name source)
    add_executable(${name} ${source})
    target_link_libraries(${name} PRIVATE handoffkit)
    if(HANDOFFKIT_CONTRACTS_DIR)
      file(TO_CMAKE_PATH "${HANDOFFKIT_CONTRACTS_DIR}" _contracts_cmake)
      target_compile_definitions(${name} PRIVATE
        "HANDOFFKIT_CONTRACTS_DIR=\"${_contracts_cmake}\""
      )
    endif()
    # Scratch dir for report writer tests (optional env)
    if(DEFINED ENV{HANDOFFKIT_TEST_SCRATCH})
      file(TO_CMAKE_PATH "$ENV{HANDOFFKIT_TEST_SCRATCH}" _scratch)
      target_compile_definitions(${name} PRIVATE "HANDOFFKIT_TEST_SCRATCH=\"${_scratch}\"")
    endif()
    add_test(NAME ${name} COMMAND ${name})
  endfunction()

  handoffkit_add_test(test_handoff tests/test_handoff.cpp)
  handoffkit_add_test(test_runtime tests/test_runtime.cpp)
  handoffkit_add_test(test_validation_quality tests/test_validation_quality.cpp)
  handoffkit_add_test(test_memory_trace_reports tests/test_memory_trace_reports.cpp)
  handoffkit_add_test(test_http_parse tests/test_http_parse.cpp)
  handoffkit_add_test(test_cli_and_demos tests/test_cli_and_demos.cpp)
  handoffkit_add_test(test_orchestrator_eval tests/test_orchestrator_eval.cpp)
  handoffkit_add_test(test_structured_replay_text tests/test_structured_replay_text.cpp)
  handoffkit_add_test(test_templates_and_deep_demos tests/test_templates_and_deep_demos.cpp)
  handoffkit_add_test(test_policy_gallery_scenarios tests/test_policy_gallery_scenarios.cpp)
  handoffkit_add_test(test_consensus_benchmark tests/test_consensus_benchmark.cpp)
  handoffkit_add_test(test_scheduler_dag tests/test_scheduler_dag.cpp)
  handoffkit_add_test(test_markdown_and_loc_helpers tests/test_markdown_and_loc_helpers.cpp)
  handoffkit_add_test(test_diff_score tests/test_diff_score.cpp)
  handoffkit_add_test(test_providers tests/test_providers.cpp)
  handoffkit_add_test(test_fusion_cache tests/test_fusion_cache.cpp)
  handoffkit_add_test(test_fusion_engine_echo tests/test_fusion_engine_echo.cpp)
  handoffkit_add_test(test_fusion_scenarios tests/test_fusion_scenarios.cpp)
  handoffkit_add_test(test_fusion_depth tests/test_fusion_depth.cpp)
  handoffkit_add_test(test_fusion_algo tests/test_fusion_algo.cpp)
  handoffkit_add_test(test_fusion_loc_audit tests/test_fusion_loc_audit.cpp)
  handoffkit_add_test(test_web_explorer tests/test_web_explorer.cpp)
  handoffkit_add_test(test_fusion_web_research tests/test_fusion_web_research.cpp)
  handoffkit_add_test(test_fusion_war_room tests/test_fusion_war_room.cpp)
endif()

# --- CLI ---
if(HANDOFFKIT_BUILD_CLI)
  add_executable(handoffkit-cli src/cli/main.cpp)
  target_link_libraries(handoffkit-cli PRIVATE handoffkit)
  set_target_properties(handoffkit-cli PROPERTIES OUTPUT_NAME handoffkit-cli)
  install(TARGETS handoffkit-cli RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()

# --- examples ---
if(HANDOFFKIT_BUILD_EXAMPLES)
  add_executable(example_simple_agent examples/simple_agent.cpp)
  target_link_libraries(example_simple_agent PRIVATE handoffkit)

  add_executable(example_team_handoff examples/team_handoff.cpp)
  target_link_libraries(example_team_handoff PRIVATE handoffkit)
endif()

# --- package source tarball helper target ---
add_custom_target(package_source_tarball
  COMMAND ${CMAKE_COMMAND}
    -DSOURCE_DIR=${CMAKE_CURRENT_SOURCE_DIR}
    -DVERSION=${PROJECT_VERSION}
    -DOUT_DIR=${CMAKE_CURRENT_BINARY_DIR}
    -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/package_source_tarball.cmake
  COMMENT "Create self-contained handoffkit-cpp-${PROJECT_VERSION} source tarball"
  VERBATIM
)

# --- install / export ---
install(TARGETS handoffkit
  EXPORT HandoffKitTargets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
  INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

install(DIRECTORY include/handoffkit
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

install(EXPORT HandoffKitTargets
  FILE HandoffKitTargets.cmake
  NAMESPACE handoffkit::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit
)

configure_package_config_file(
  cmake/HandoffKitConfig.cmake.in
  "${CMAKE_CURRENT_BINARY_DIR}/HandoffKitConfig.cmake"
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit
)

write_basic_package_version_file(
  "${CMAKE_CURRENT_BINARY_DIR}/HandoffKitConfigVersion.cmake"
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion
)

install(FILES
  "${CMAKE_CURRENT_BINARY_DIR}/HandoffKitConfig.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/HandoffKitConfigVersion.cmake"
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit
)

# When nlohmann was FetchContent'd, install headers so find_package consumers
# can resolve includes without a separate system install.
if(HANDOFFKIT_BUNDLED_JSON)
  if(DEFINED json_SOURCE_DIR AND EXISTS "${json_SOURCE_DIR}/include/nlohmann")
    install(DIRECTORY "${json_SOURCE_DIR}/include/nlohmann"
      DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
    )
  endif()
endif()


