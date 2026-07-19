cmake_minimum_required(VERSION 3.16)
project(handoffkit VERSION 1.14.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(HANDOFFKIT_BUILD_TESTS "Build HandoffKit unit/contract tests" ON)
option(HANDOFFKIT_BUILD_EXAMPLES "Build HandoffKit examples" ON)
option(HANDOFFKIT_BUILD_CLI "Build handoffkit-cli offline binary" ON)
option(HANDOFFKIT_BUILD_DEMOS "Build demos/fusion catalog as handoffkit_demos (ON=default monorepo)" ON)
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

# --- core runtime sources (no demos/fusion) ---
set(HANDOFFKIT_CORE_SOURCES
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
  src/train/types.cpp
  src/train/dataset.cpp
  src/train/distill.cpp
  src/train/backends.cpp
  src/train/runner.cpp
)

# --- demos + fusion + CLI app sources (optional) ---
set(HANDOFFKIT_DEMOS_SOURCES
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

file(GLOB_RECURSE HANDOFFKIT_FUSION_SOURCES CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/src/demos/fusion/*.cpp"
)
list(APPEND HANDOFFKIT_DEMOS_SOURCES ${HANDOFFKIT_FUSION_SOURCES})

# Guard: core must never pick up fusion TUs
foreach(_src ${HANDOFFKIT_CORE_SOURCES})
  if(_src MATCHES "demos/fusion" OR _src MATCHES "demos\\\\fusion")
    message(FATAL_ERROR "handoffkit_core must not include fusion source: ${_src}")
  endif()
endforeach()

function(handoffkit_apply_common target_name)
  target_include_directories(${target_name}
    PUBLIC
      $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
      $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
  )
  target_link_libraries(${target_name} PUBLIC $<BUILD_INTERFACE:nlohmann_json::nlohmann_json>)
  if(HANDOFFKIT_WITH_HTTP)
    target_compile_definitions(${target_name} PUBLIC HANDOFFKIT_WITH_HTTP=1 CPPHTTPLIB_OPENSSL_SUPPORT)
    target_link_libraries(${target_name} PUBLIC
      $<BUILD_INTERFACE:httplib::httplib>
      OpenSSL::SSL
      OpenSSL::Crypto
    )
    if(WIN32)
      target_link_libraries(${target_name} PUBLIC ws2_32 crypt32)
    endif()
  endif()
  target_compile_features(${target_name} PUBLIC cxx_std_20)
  if(MSVC)
    target_compile_options(${target_name} PRIVATE /W4 /permissive-)
  else()
    target_compile_options(${target_name} PRIVATE -Wall -Wextra -Wpedantic)
  endif()
endfunction()

add_library(handoffkit_core ${HANDOFFKIT_CORE_SOURCES})
handoffkit_apply_common(handoffkit_core)
set_target_properties(handoffkit_core PROPERTIES
  VERSION ${PROJECT_VERSION}
  SOVERSION ${PROJECT_VERSION_MAJOR}
  EXPORT_NAME core
  OUTPUT_NAME handoffkit_core
)
add_library(handoffkit::core ALIAS handoffkit_core)

# List core sources once (for build logs / split verification)
set(_hk_core_src_list "")
foreach(_s ${HANDOFFKIT_CORE_SOURCES})
  string(APPEND _hk_core_src_list "${_s};")
endforeach()
message(STATUS "handoffkit_core sources (${list_length}): no fusion/demos")
list(LENGTH HANDOFFKIT_CORE_SOURCES _hk_core_n)
message(STATUS "handoffkit_core file count: ${_hk_core_n}")

set(_hk_install_libs handoffkit_core)

if(HANDOFFKIT_BUILD_DEMOS)
  add_library(handoffkit_demos ${HANDOFFKIT_DEMOS_SOURCES})
  target_link_libraries(handoffkit_demos PUBLIC handoffkit_core)
  handoffkit_apply_common(handoffkit_demos)
  set_target_properties(handoffkit_demos PROPERTIES
    VERSION ${PROJECT_VERSION}
    SOVERSION ${PROJECT_VERSION_MAJOR}
    EXPORT_NAME demos
    OUTPUT_NAME handoffkit_demos
  )
  add_library(handoffkit::demos ALIAS handoffkit_demos)
  list(APPEND _hk_install_libs handoffkit_demos)
  list(LENGTH HANDOFFKIT_DEMOS_SOURCES _hk_demo_n)
  message(STATUS "handoffkit_demos file count: ${_hk_demo_n} (includes fusion)")
endif()

# Canonical consumer target: INTERFACE → demos (full monorepo) or core-only
add_library(handoffkit INTERFACE)
if(HANDOFFKIT_BUILD_DEMOS)
  target_link_libraries(handoffkit INTERFACE handoffkit_demos)
else()
  target_link_libraries(handoffkit INTERFACE handoffkit_core)
endif()
add_library(handoffkit::handoffkit ALIAS handoffkit)
list(APPEND _hk_install_libs handoffkit)

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
    set(options "")
    set(oneValueArgs LINK)
    cmake_parse_arguments(HKT "${options}" "${oneValueArgs}" "" ${ARGN})
    if(NOT HKT_LINK)
      set(HKT_LINK handoffkit)
    endif()
    add_executable(${name} ${source})
    target_link_libraries(${name} PRIVATE ${HKT_LINK})
    if(HANDOFFKIT_CONTRACTS_DIR)
      file(TO_CMAKE_PATH "${HANDOFFKIT_CONTRACTS_DIR}" _contracts_cmake)
      target_compile_definitions(${name} PRIVATE
        "HANDOFFKIT_CONTRACTS_DIR=\"${_contracts_cmake}\""
      )
    endif()
    if(DEFINED ENV{HANDOFFKIT_TEST_SCRATCH})
      file(TO_CMAKE_PATH "$ENV{HANDOFFKIT_TEST_SCRATCH}" _scratch)
      target_compile_definitions(${name} PRIVATE "HANDOFFKIT_TEST_SCRATCH=\"${_scratch}\"")
    endif()
    add_test(NAME ${name} COMMAND ${name})
  endfunction()

  # Core-only tests (must not require demos/fusion)
  handoffkit_add_test(test_handoff tests/test_handoff.cpp LINK handoffkit_core)
  handoffkit_add_test(test_runtime tests/test_runtime.cpp LINK handoffkit_core)
  handoffkit_add_test(test_validation_quality tests/test_validation_quality.cpp LINK handoffkit_core)
  handoffkit_add_test(test_memory_trace_reports tests/test_memory_trace_reports.cpp LINK handoffkit_core)
  handoffkit_add_test(test_http_parse tests/test_http_parse.cpp LINK handoffkit_core)
  handoffkit_add_test(test_orchestrator_eval tests/test_orchestrator_eval.cpp LINK handoffkit_core)
  handoffkit_add_test(test_structured_replay_text tests/test_structured_replay_text.cpp LINK handoffkit_core)
  handoffkit_add_test(test_web_explorer tests/test_web_explorer.cpp LINK handoffkit_core)
  handoffkit_add_test(test_core_runtime tests/test_core_runtime.cpp LINK handoffkit_core)
  handoffkit_add_test(test_train_core tests/test_train_core.cpp LINK handoffkit_core)

  if(HANDOFFKIT_BUILD_DEMOS)
    handoffkit_add_test(test_cli_and_demos tests/test_cli_and_demos.cpp)
    handoffkit_add_test(test_templates_and_deep_demos tests/test_templates_and_deep_demos.cpp)
    handoffkit_add_test(test_policy_gallery_scenarios tests/test_policy_gallery_scenarios.cpp)
    handoffkit_add_test(test_markdown_and_loc_helpers tests/test_markdown_and_loc_helpers.cpp)
    handoffkit_add_test(test_consensus_benchmark tests/test_consensus_benchmark.cpp)
    handoffkit_add_test(test_scheduler_dag tests/test_scheduler_dag.cpp)
    handoffkit_add_test(test_diff_score tests/test_diff_score.cpp)
    handoffkit_add_test(test_providers tests/test_providers.cpp)
    handoffkit_add_test(test_fusion_cache tests/test_fusion_cache.cpp)
    handoffkit_add_test(test_fusion_engine_echo tests/test_fusion_engine_echo.cpp)
    handoffkit_add_test(test_fusion_scenarios tests/test_fusion_scenarios.cpp)
    handoffkit_add_test(test_fusion_depth tests/test_fusion_depth.cpp)
    handoffkit_add_test(test_fusion_algo tests/test_fusion_algo.cpp)
    handoffkit_add_test(test_fusion_loc_audit tests/test_fusion_loc_audit.cpp)
    handoffkit_add_test(test_fusion_web_research tests/test_fusion_web_research.cpp)
    handoffkit_add_test(test_fusion_war_room tests/test_fusion_war_room.cpp)
    handoffkit_add_test(test_fusion_panel tests/test_fusion_panel.cpp)
    handoffkit_add_test(test_fusion_roles tests/test_fusion_roles.cpp)
    # Shipped example pack path for load_role_pack_file / fusion roles --file smoke
    file(TO_CMAKE_PATH
      "${CMAKE_CURRENT_SOURCE_DIR}/examples/fusion/role_packs/custom_review.json"
      _hk_example_role_pack)
    target_compile_definitions(test_fusion_roles PRIVATE
      "HANDOFFKIT_EXAMPLE_ROLE_PACK=\"${_hk_example_role_pack}\"")
  endif()
endif()

# --- CLI ---
if(HANDOFFKIT_BUILD_CLI)
  if(NOT HANDOFFKIT_BUILD_DEMOS)
    message(WARNING "HANDOFFKIT_BUILD_CLI=ON requires HANDOFFKIT_BUILD_DEMOS=ON; disabling CLI")
  else()
    add_executable(handoffkit-cli src/cli/main.cpp)
    target_link_libraries(handoffkit-cli PRIVATE handoffkit)
    set_target_properties(handoffkit-cli PROPERTIES OUTPUT_NAME handoffkit-cli)
    install(TARGETS handoffkit-cli RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
  endif()
endif()

# --- examples ---
if(HANDOFFKIT_BUILD_EXAMPLES)
  add_executable(example_simple_agent examples/simple_agent.cpp)
  target_link_libraries(example_simple_agent PRIVATE handoffkit_core)

  add_executable(example_team_handoff examples/team_handoff.cpp)
  target_link_libraries(example_team_handoff PRIVATE handoffkit_core)
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

# Document consumer example path (built separately against an install prefix).
# See examples/consumer_core/ and scripts/consumer_install_smoke.*

# Fusion role pack examples (CLI: fusion roles --file …)
install(DIRECTORY examples/fusion/role_packs
  DESTINATION ${CMAKE_INSTALL_DATADIR}/handoffkit/examples/fusion
  FILES_MATCHING PATTERN "*.json" PATTERN "README.md"
)

# --- install / export ---
install(TARGETS ${_hk_install_libs}
  EXPORT HandoffKitTargets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
  INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

install(DIRECTORY include/handoffkit
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

# find_package(handoffkit) on Linux is case-sensitive and needs:
#   handoffkitConfig.cmake / handoffkitTargets.cmake
# Also ship HandoffKit* aliases so older CI/scripts keep working.
install(EXPORT HandoffKitTargets
  FILE handoffkitTargets.cmake
  NAMESPACE handoffkit::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit
)

configure_package_config_file(
  cmake/HandoffKitConfig.cmake.in
  "${CMAKE_CURRENT_BINARY_DIR}/handoffkitConfig.cmake"
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit
)

write_basic_package_version_file(
  "${CMAKE_CURRENT_BINARY_DIR}/handoffkitConfigVersion.cmake"
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion
)

# Case aliases (Windows was fine with either; Linux find_package is picky).
# configure_file COPYONLY works on CMake 3.16+ (file(COPY_FILE) needs 3.21+).
configure_file(
  "${CMAKE_CURRENT_BINARY_DIR}/handoffkitConfig.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/HandoffKitConfig.cmake"
  COPYONLY
)
configure_file(
  "${CMAKE_CURRENT_BINARY_DIR}/handoffkitConfigVersion.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/HandoffKitConfigVersion.cmake"
  COPYONLY
)
# Targets alias name for scripts that include HandoffKitTargets.cmake
install(EXPORT HandoffKitTargets
  FILE HandoffKitTargets.cmake
  NAMESPACE handoffkit::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit
)

install(FILES
  "${CMAKE_CURRENT_BINARY_DIR}/handoffkitConfig.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/handoffkitConfigVersion.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/HandoffKitConfig.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/HandoffKitConfigVersion.cmake"
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit
)

if(HANDOFFKIT_BUNDLED_JSON)
  if(DEFINED json_SOURCE_DIR AND EXISTS "${json_SOURCE_DIR}/include/nlohmann")
    install(DIRECTORY "${json_SOURCE_DIR}/include/nlohmann"
      DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
    )
  endif()
endif()
