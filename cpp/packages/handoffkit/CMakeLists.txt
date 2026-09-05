cmake_minimum_required(VERSION 3.16)
project(handoffkit VERSION 1.20.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(HANDOFFKIT_BUILD_TESTS "Build HandoffKit unit/contract tests" ON)
option(HANDOFFKIT_BUILD_EXAMPLES "Build HandoffKit examples" ON)
option(HANDOFFKIT_BUILD_CLI "Build handoffkit-cli offline binary" ON)
option(HANDOFFKIT_BUILD_DEMOS "Build demos/fusion catalog as handoffkit_demos (ON=default monorepo)" ON)
option(HANDOFFKIT_FETCH_JSON "Fetch nlohmann_json via FetchContent when not found" ON)
option(HANDOFFKIT_WITH_HTTP "Build optional OpenAI-compatible HTTP provider (cpp-httplib)" OFF)
option(HANDOFFKIT_WITH_CRYPTO "Enable OpenSSL-backed Ed25519 and ECDSA-P256 artifact signatures" OFF)
option(HANDOFFKIT_WITH_TLS "Enable OpenSSL-backed TLS 1.3 transport" OFF)
option(HANDOFFKIT_BUILD_BENCHMARKS "Build executable runtime validation/benchmarks" OFF)
option(HANDOFFKIT_INSTALL "Install/export HandoffKit C++ targets" ON)

# OS keystore providers are detected, never emulated. Windows Credential
# Manager is available through the platform SDK; macOS Keychain and Linux
# Secret Service are optional maintained platform providers.
set(HANDOFFKIT_WITH_MACOS_KEYCHAIN OFF)
set(HANDOFFKIT_WITH_LIBSECRET OFF)

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

if(HANDOFFKIT_WITH_CRYPTO)
  find_package(OpenSSL REQUIRED COMPONENTS Crypto)
endif()

if(HANDOFFKIT_WITH_TLS)
  find_package(OpenSSL REQUIRED COMPONENTS SSL Crypto)
endif()

if(APPLE)
  find_library(HANDOFFKIT_SECURITY_FRAMEWORK Security)
  find_library(HANDOFFKIT_COREFOUNDATION_FRAMEWORK CoreFoundation)
  if(HANDOFFKIT_SECURITY_FRAMEWORK AND HANDOFFKIT_COREFOUNDATION_FRAMEWORK)
    set(HANDOFFKIT_WITH_MACOS_KEYCHAIN ON)
  endif()
elseif(UNIX)
  find_package(PkgConfig QUIET)
  if(PkgConfig_FOUND)
    pkg_check_modules(HANDOFFKIT_LIBSECRET QUIET IMPORTED_TARGET libsecret-1)
    if(HANDOFFKIT_LIBSECRET_FOUND)
      set(HANDOFFKIT_WITH_LIBSECRET ON)
    endif()
  endif()
endif()

# --- core runtime sources (no demos/fusion) ---
set(HANDOFFKIT_CORE_SOURCES
  src/handoff.cpp
  src/csp/contracts.cpp
  src/csp/artifact_security.cpp
  src/csp/artifact_gate.cpp
  src/csp/os_keystore.cpp
  src/csp/durable_scheduler.cpp
  src/csp/dispatcher.cpp
  src/csp/security_transcript.cpp
  src/csp/tls_transport.cpp
  src/csp/native_compute.cpp
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
  if(HANDOFFKIT_WITH_CRYPTO)
    target_compile_definitions(${target_name} PUBLIC HANDOFFKIT_WITH_CRYPTO=1)
    target_link_libraries(${target_name} PUBLIC OpenSSL::Crypto)
  endif()
  if(HANDOFFKIT_WITH_TLS)
    target_compile_definitions(${target_name} PUBLIC HANDOFFKIT_WITH_TLS=1)
    target_link_libraries(${target_name} PUBLIC OpenSSL::SSL OpenSSL::Crypto)
    if(WIN32)
      target_link_libraries(${target_name} PUBLIC ws2_32 crypt32)
    endif()
  endif()
  if(HANDOFFKIT_WITH_MACOS_KEYCHAIN)
    target_compile_definitions(${target_name} PUBLIC HANDOFFKIT_WITH_MACOS_KEYCHAIN=1)
    target_link_libraries(${target_name} PUBLIC
      "${HANDOFFKIT_SECURITY_FRAMEWORK}"
      "${HANDOFFKIT_COREFOUNDATION_FRAMEWORK}"
    )
  endif()
  if(HANDOFFKIT_WITH_LIBSECRET)
    target_compile_definitions(${target_name} PUBLIC HANDOFFKIT_WITH_LIBSECRET=1)
    target_link_libraries(${target_name} PUBLIC PkgConfig::HANDOFFKIT_LIBSECRET)
  endif()
  if(WIN32)
    target_link_libraries(${target_name} PUBLIC advapi32)
  endif()
  # Keep the native-compute contract (jthread/stop_token) explicit for
  # AppleClang and other toolchains whose feature tables may not propagate
  # the project-wide setting through imported targets.
  set_target_properties(${target_name} PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
  )
  if(APPLE AND CMAKE_CXX_COMPILER_ID MATCHES "AppleClang|Clang")
    # Xcode 15's libc++ keeps C++20 stop_token/jthread in its experimental
    # library until the newer libc++ release ships on the hosted image.
    target_compile_options(${target_name} PUBLIC -fexperimental-library)
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

set(HANDOFFKIT_BROWSER_SOURCES
  src/browser/core.cpp
  src/browser/web_types.cpp
  src/browser/html_extract.cpp
  src/browser/transport.cpp
  src/browser/explorer.cpp
  src/browser/tools.cpp
  src/browser/rank.cpp
  src/browser/util.cpp
  src/browser/cache.cpp
  src/browser/page.cpp
  src/browser/research.cpp
  src/browser/ultra_browser.cpp
  src/browser/kit.cpp
)

add_library(handoffkit_browser ${HANDOFFKIT_BROWSER_SOURCES})
target_link_libraries(handoffkit_browser PUBLIC handoffkit_core)
handoffkit_apply_common(handoffkit_browser)
set_target_properties(handoffkit_browser PROPERTIES
  VERSION ${PROJECT_VERSION}
  SOVERSION ${PROJECT_VERSION_MAJOR}
  EXPORT_NAME browser
  OUTPUT_NAME handoffkit_browser
)
add_library(handoffkit::browser ALIAS handoffkit_browser)

# List core sources once (for build logs / split verification)
set(_hk_core_src_list "")
foreach(_s ${HANDOFFKIT_CORE_SOURCES})
  string(APPEND _hk_core_src_list "${_s};")
endforeach()
message(STATUS "handoffkit_core sources (${list_length}): no fusion/demos")
list(LENGTH HANDOFFKIT_CORE_SOURCES _hk_core_n)
message(STATUS "handoffkit_core file count: ${_hk_core_n}")

set(_hk_install_libs handoffkit_core handoffkit_browser)

if(HANDOFFKIT_BUILD_DEMOS)
  # Layering: engine (demos) <- eval corpus (bench/medcase/stats/scenarios) <-
  # CLI app. The eval cluster is not compiled as part of the engine itself;
  # headers stay in place, only TU boundaries move. Order matters: eval
  # references the engine, never the reverse, so consumers link eval BEFORE
  # demos on static builds.
  set(_fusion_engine_sources "")
  set(HANDOFFKIT_FUSION_EVAL_SOURCES "")
  foreach(_src ${HANDOFFKIT_FUSION_SOURCES})
    if(_src MATCHES "/(algo_stats|bench_case|bench_corpus_eval|cases_medcase_loader|cases_validate|scenarios_catalog|scenarios_deep)\\.cpp$")
      list(APPEND HANDOFFKIT_FUSION_EVAL_SOURCES "${_src}")
      list(REMOVE_ITEM HANDOFFKIT_DEMOS_SOURCES "${_src}")
    else()
      list(APPEND _fusion_engine_sources "${_src}")
    endif()
  endforeach()
  set(HANDOFFKIT_FUSION_SOURCES "${_fusion_engine_sources}")
  list(REMOVE_ITEM HANDOFFKIT_DEMOS_SOURCES "src/cli/cli_app.cpp")

  add_library(handoffkit_demos ${HANDOFFKIT_DEMOS_SOURCES})
  target_link_libraries(handoffkit_demos PUBLIC handoffkit_browser)
  handoffkit_apply_common(handoffkit_demos)
  set_target_properties(handoffkit_demos PROPERTIES
    VERSION ${PROJECT_VERSION}
    SOVERSION ${PROJECT_VERSION_MAJOR}
    EXPORT_NAME demos
    OUTPUT_NAME handoffkit_demos
  )
  add_library(handoffkit::demos ALIAS handoffkit_demos)
  list(APPEND _hk_install_libs handoffkit_demos)

  add_library(handoffkit_fusion_eval STATIC ${HANDOFFKIT_FUSION_EVAL_SOURCES})
  target_link_libraries(handoffkit_fusion_eval PUBLIC handoffkit_demos)
  handoffkit_apply_common(handoffkit_fusion_eval)
  set_target_properties(handoffkit_fusion_eval PROPERTIES
    POSITION_INDEPENDENT_CODE ON
    VERSION ${PROJECT_VERSION}
    EXPORT_NAME fusion_eval
    OUTPUT_NAME handoffkit_fusion_eval
  )
  add_library(handoffkit::fusion_eval ALIAS handoffkit_fusion_eval)
  list(APPEND _hk_install_libs handoffkit_fusion_eval)

  add_library(handoffkit_cli STATIC src/cli/cli_app.cpp)
  target_link_libraries(handoffkit_cli PRIVATE handoffkit_fusion_eval handoffkit_demos)
  handoffkit_apply_common(handoffkit_cli)
  set_target_properties(handoffkit_cli PROPERTIES
    POSITION_INDEPENDENT_CODE ON
    VERSION ${PROJECT_VERSION}
    EXPORT_NAME cli
    OUTPUT_NAME handoffkit_cli
  )
  add_library(handoffkit::cli ALIAS handoffkit_cli)
  list(APPEND _hk_install_libs handoffkit_cli)

  list(LENGTH HANDOFFKIT_DEMOS_SOURCES _hk_demo_n)
  message(STATUS "handoffkit_demos file count: ${_hk_demo_n} (includes fusion engine)")
  list(LENGTH HANDOFFKIT_FUSION_EVAL_SOURCES _hk_eval_n)
  message(STATUS "handoffkit_fusion_eval file count: ${_hk_eval_n} (bench/medcase/stats/scenarios)")
endif()

# Canonical consumer target: INTERFACE → demos (full) or core+browser
add_library(handoffkit INTERFACE)
if(HANDOFFKIT_BUILD_DEMOS)
  target_link_libraries(handoffkit INTERFACE handoffkit_fusion_eval handoffkit_demos)
else()
  target_link_libraries(handoffkit INTERFACE handoffkit_core handoffkit_browser)
endif()
add_library(handoffkit::handoffkit ALIAS handoffkit)
list(APPEND _hk_install_libs handoffkit)

# --- tests ---
if(HANDOFFKIT_BUILD_TESTS)
  enable_testing()

  set(_default_contracts "${CMAKE_CURRENT_SOURCE_DIR}/../../../shared/contracts")
  set(_packaged_contracts "${CMAKE_CURRENT_SOURCE_DIR}/contracts")
  if(DEFINED ENV{HANDOFFKIT_CONTRACTS_DIR})
    set(HANDOFFKIT_CONTRACTS_DIR "$ENV{HANDOFFKIT_CONTRACTS_DIR}")
  elseif(EXISTS "${_default_contracts}/fixtures")
    set(HANDOFFKIT_CONTRACTS_DIR "${_default_contracts}")
  elseif(EXISTS "${_packaged_contracts}/fixtures")
    set(HANDOFFKIT_CONTRACTS_DIR "${_packaged_contracts}")
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
    # These executables use assertions as executable test requirements. Keep
    # them active in Release so CI cannot report success after compiling the
    # checks away with NDEBUG.
    if(MSVC)
      target_compile_options(${name} PRIVATE /UNDEBUG)
    else()
      target_compile_options(${name} PRIVATE -UNDEBUG)
    endif()
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
  handoffkit_add_test(test_csp_contracts tests/test_csp_contracts.cpp LINK handoffkit_core)
  handoffkit_add_test(test_edge_profiles tests/test_edge_profiles.cpp LINK handoffkit_core)
  handoffkit_add_test(test_csp_security tests/test_csp_security.cpp LINK handoffkit_core)
  handoffkit_add_test(test_tls_transport tests/test_tls_transport.cpp LINK handoffkit_core)
  handoffkit_add_test(test_os_keystore tests/test_os_keystore.cpp LINK handoffkit_core)
  handoffkit_add_test(test_secure_memory tests/test_secure_memory.cpp LINK handoffkit_core)
  handoffkit_add_test(test_durable_scheduler tests/test_durable_scheduler.cpp LINK handoffkit_core)
  handoffkit_add_test(test_security_conformance tests/test_security_conformance.cpp LINK handoffkit_core)
  handoffkit_add_test(test_artifact_signatures tests/test_artifact_signatures.cpp LINK handoffkit_core)
  handoffkit_add_test(test_ecdsa_artifact_signatures tests/test_ecdsa_artifact_signatures.cpp LINK handoffkit_core)
  handoffkit_add_test(test_artifact_gate tests/test_artifact_gate.cpp LINK handoffkit_core)
  handoffkit_add_test(test_native_compute tests/test_native_compute.cpp LINK handoffkit_core)
  handoffkit_add_test(test_runtime tests/test_runtime.cpp LINK handoffkit_core)
  handoffkit_add_test(test_validation_quality tests/test_validation_quality.cpp LINK handoffkit_core)
  handoffkit_add_test(test_memory_trace_reports tests/test_memory_trace_reports.cpp LINK handoffkit_core)
  handoffkit_add_test(test_http_parse tests/test_http_parse.cpp LINK handoffkit_core)
  handoffkit_add_test(test_orchestrator_eval tests/test_orchestrator_eval.cpp LINK handoffkit_core)
  handoffkit_add_test(test_structured_replay_text tests/test_structured_replay_text.cpp LINK handoffkit_core)
  handoffkit_add_test(test_web_explorer tests/test_web_explorer.cpp LINK handoffkit_browser)
  handoffkit_add_test(test_browser_core tests/test_browser_core.cpp LINK handoffkit_browser)
  handoffkit_add_test(test_browser_real_tls tests/test_browser_real_tls.cpp LINK handoffkit_core)
  handoffkit_add_test(test_core_runtime tests/test_core_runtime.cpp LINK handoffkit_core)
  handoffkit_add_test(test_train_core tests/test_train_core.cpp LINK handoffkit_core)

  if(HANDOFFKIT_BUILD_DEMOS)
    handoffkit_add_test(test_cli_and_demos tests/test_cli_and_demos.cpp LINK handoffkit_cli)
    handoffkit_add_test(test_templates_and_deep_demos tests/test_templates_and_deep_demos.cpp LINK handoffkit_cli)
    handoffkit_add_test(test_policy_gallery_scenarios tests/test_policy_gallery_scenarios.cpp)
    handoffkit_add_test(test_markdown_and_loc_helpers tests/test_markdown_and_loc_helpers.cpp LINK handoffkit_cli)
    handoffkit_add_test(test_consensus_benchmark tests/test_consensus_benchmark.cpp)
    handoffkit_add_test(test_scheduler_dag tests/test_scheduler_dag.cpp)
    handoffkit_add_test(test_diff_score tests/test_diff_score.cpp)
    handoffkit_add_test(test_providers tests/test_providers.cpp LINK handoffkit_cli)
    handoffkit_add_test(test_draco_benchmark tests/test_draco_benchmark.cpp LINK handoffkit_cli)
    handoffkit_add_test(test_fusion_cache tests/test_fusion_cache.cpp)
    handoffkit_add_test(test_fusion_engine_echo tests/test_fusion_engine_echo.cpp)
    handoffkit_add_test(test_fusion_scenarios tests/test_fusion_scenarios.cpp)
    handoffkit_add_test(test_fusion_depth tests/test_fusion_depth.cpp)
    handoffkit_add_test(test_fusion_algo tests/test_fusion_algo.cpp)
    handoffkit_add_test(test_fusion_loc_audit tests/test_fusion_loc_audit.cpp)
    set_tests_properties(test_fusion_algo test_fusion_loc_audit PROPERTIES
      WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    )
    handoffkit_add_test(test_fusion_web_research tests/test_fusion_web_research.cpp)
    handoffkit_add_test(test_fusion_war_room tests/test_fusion_war_room.cpp)
    handoffkit_add_test(test_fusion_panel tests/test_fusion_panel.cpp)
    handoffkit_add_test(test_fusion_roles tests/test_fusion_roles.cpp)
    handoffkit_add_test(test_handoff_transfer src/demos/handoff_transfer_benchmark.cpp)
    handoffkit_add_test(test_handoff_transfer_v2 src/demos/handoff_transfer_ultra_v2.cpp)
    handoffkit_add_test(test_handoff_transfer_v3 src/demos/handoff_transfer_v3.cpp)
    handoffkit_add_test(test_handoff_transfer_v4 src/demos/handoff_transfer_v4.cpp)
    # NOTE: benchmarks/test_handoff_transfer_rigorous_v5.cpp is ported but
    # intentionally not registered as a ctest until its harness is qualified.
    # Shipped example pack path for load_role_pack_file / fusion roles --file smoke
    file(TO_CMAKE_PATH
      "${CMAKE_CURRENT_SOURCE_DIR}/examples/fusion/role_packs/custom_review.json"
      _hk_example_role_pack)
    target_compile_definitions(test_fusion_roles PRIVATE
      "HANDOFFKIT_EXAMPLE_ROLE_PACK=\"${_hk_example_role_pack}\"")
  endif()
endif()

if(HANDOFFKIT_BUILD_BENCHMARKS)
  add_executable(native_compute_benchmark benchmarks/native_compute_benchmark.cpp)
  target_link_libraries(native_compute_benchmark PRIVATE handoffkit_core)
endif()

# --- CLI ---
if(HANDOFFKIT_BUILD_CLI)
  if(NOT HANDOFFKIT_BUILD_DEMOS)
    message(WARNING "HANDOFFKIT_BUILD_CLI=ON requires HANDOFFKIT_BUILD_DEMOS=ON; disabling CLI")
  else()
    add_executable(handoffkit-cli src/cli/main.cpp)
    target_link_libraries(handoffkit-cli PRIVATE handoffkit_cli handoffkit)
    set_target_properties(handoffkit-cli PROPERTIES OUTPUT_NAME handoffkit-cli)
    if(HANDOFFKIT_INSTALL)
      install(TARGETS handoffkit-cli RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
    endif()
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
if(HANDOFFKIT_INSTALL)
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
endif()
