# HandoffKit ML — optional complement (NOT part of handoffkit_core).
# CUDA: own kernels + cudart only (no cuBLAS / cuDNN / third-party BLAS).
cmake_minimum_required(VERSION 3.18)

option(HANDOFFKIT_ML_CUDA "Build own CUDA kernels (cudart only, no cuBLAS)" OFF)

if(HANDOFFKIT_ML_CUDA)
  project(handoffkit_ml VERSION 0.6.0 LANGUAGES CXX CUDA)
else()
  project(handoffkit_ml VERSION 0.6.0 LANGUAGES CXX)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(HANDOFFKIT_ML_BUILD_TESTS "Build handoffkit-ml unit tests" ON)
option(HANDOFFKIT_ML_BUILD_CLI "Build handoffkit-ml CLI" ON)
option(HANDOFFKIT_ML_LINK_CORE "Link handoffkit_core when available" OFF)
option(HANDOFFKIT_ML_TLS "Build the direct C++ TLS/dispatcher worker entrypoint" OFF)
set(HANDOFFKIT_CORE_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../handoffkit"
    CACHE PATH "In-tree path to cpp/packages/handoffkit (core)")

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

set(HANDOFFKIT_ML_SOURCES
  src/version.cpp
  src/ops.cpp
  src/cuda/runtime.cpp
  src/cuda_kernels.cpp
)

if(HANDOFFKIT_ML_LINK_CORE)
  list(APPEND HANDOFFKIT_ML_SOURCES src/csp_worker.cpp)
endif()

if(HANDOFFKIT_ML_CUDA)
  list(APPEND HANDOFFKIT_ML_SOURCES
    src/cuda/gemm.cu
    src/cuda/elementwise.cu
    src/cuda/reduce.cu
    src/cuda/extra.cu
    src/cuda/resident.cu
  )
endif()

add_library(handoffkit_ml STATIC ${HANDOFFKIT_ML_SOURCES})
add_library(handoffkit::ml ALIAS handoffkit_ml)
set_target_properties(handoffkit_ml PROPERTIES EXPORT_NAME ml)

target_include_directories(handoffkit_ml
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)
set_target_properties(handoffkit_ml PROPERTIES
  CXX_STANDARD 20
  CXX_STANDARD_REQUIRED ON
  CXX_EXTENSIONS OFF
)
if(APPLE AND CMAKE_CXX_COMPILER_ID MATCHES "AppleClang|Clang")
  # The public CSP worker header exposes stop_token/jthread and must compile
  # with the same libc++ feature mode as the embedded C++ core.
  target_compile_options(handoffkit_ml PUBLIC -fexperimental-library)
endif()
target_compile_features(handoffkit_ml PUBLIC cxx_std_20)

if(HANDOFFKIT_ML_CUDA)
  target_compile_definitions(handoffkit_ml PUBLIC HANDOFFKIT_ML_WITH_CUDA=1)
  set_target_properties(handoffkit_ml PROPERTIES
    CUDA_SEPARABLE_COMPILATION OFF
    CUDA_RESOLVE_DEVICE_SYMBOLS ON
    CUDA_ARCHITECTURES "75;86;89;120"
  )
  find_package(CUDAToolkit REQUIRED)
  # Purist: cudart only — never cuBLAS/cuDNN
  target_link_libraries(handoffkit_ml PUBLIC CUDA::cudart)
  message(STATUS "HANDOFFKIT_ML_CUDA=ON: own .cu kernels + CUDA::cudart (no cuBLAS)")
endif()

find_package(Threads REQUIRED)
target_link_libraries(handoffkit_ml PUBLIC Threads::Threads)

if(HANDOFFKIT_ML_LINK_CORE)
  if(HANDOFFKIT_ML_TLS)
    set(HANDOFFKIT_WITH_TLS ON CACHE BOOL
        "Enable OpenSSL-backed TLS 1.3 transport for cpp-ml" FORCE)
  endif()
  find_package(OpenSSL REQUIRED COMPONENTS Crypto)
  # Resolve an installed JSON package in this parent scope so its imported
  # target remains visible when cpp-ml links CSP sources from the nested core.
  # If unavailable, the core's existing FetchContent fallback still owns it.
  find_package(nlohmann_json 3.11 QUIET CONFIG)
  if(NOT TARGET handoffkit_core)
    # Embedded core is a link-only implementation detail. Its standalone
    # install exports would conflict with handoffkit_ml's export set.
    set(HANDOFFKIT_INSTALL OFF CACHE BOOL
        "Disable standalone core install when embedded in cpp-ml" FORCE)
    set(HANDOFFKIT_WITH_CRYPTO ON CACHE BOOL
        "Enable OpenSSL-backed artifact verification for cpp-ml CSP ingestion" FORCE)
    add_subdirectory(
      "${HANDOFFKIT_CORE_SOURCE_DIR}"
      "${CMAKE_CURRENT_BINARY_DIR}/handoffkit-core"
      EXCLUDE_FROM_ALL
    )
  endif()
  target_include_directories(handoffkit_ml PUBLIC
    $<BUILD_INTERFACE:${HANDOFFKIT_CORE_SOURCE_DIR}/include>
  )
  target_compile_definitions(handoffkit_ml PUBLIC HANDOFFKIT_ML_WITH_CSP=1)
  # CSP tests link the in-tree core target explicitly. Installed consumers get
  # the namespaced dependency without exporting the nested core target twice.
  target_link_libraries(handoffkit_ml
    PUBLIC
      OpenSSL::Crypto
    PRIVATE $<BUILD_INTERFACE:nlohmann_json::nlohmann_json>
  )
  if(HANDOFFKIT_ML_TLS)
    find_package(OpenSSL REQUIRED COMPONENTS SSL Crypto)
    target_compile_definitions(handoffkit_ml PUBLIC HANDOFFKIT_ML_WITH_TLS=1)
    target_link_libraries(handoffkit_ml PUBLIC OpenSSL::SSL)
  endif()
endif()

if(HANDOFFKIT_ML_BUILD_CLI)
  add_executable(handoffkit-ml src/cli/main.cpp)
  target_link_libraries(handoffkit-ml PRIVATE handoffkit_ml)
  if(WIN32)
    target_compile_definitions(handoffkit-ml PRIVATE NOMINMAX)
  endif()
endif()

if(HANDOFFKIT_ML_LINK_CORE)
  add_executable(handoffkit-cpp-ml-worker src/csp_worker_main.cpp)
  target_link_libraries(handoffkit-cpp-ml-worker PRIVATE handoffkit_ml handoffkit_core)
  if(WIN32)
    target_compile_definitions(handoffkit-cpp-ml-worker PRIVATE NOMINMAX)
  endif()
  if(HANDOFFKIT_ML_TLS)
    # Test-only reverse-direction TCP interop client. It is intentionally not
    # installed; CI uses it to prove C++ can speak to Node/Go/Rust servers.
    add_executable(handoffkit-cpp-tcp-client tests/interop/cpp_tcp_client.cpp)
    target_link_libraries(handoffkit-cpp-tcp-client PRIVATE handoffkit_core)
    if(WIN32)
      target_compile_definitions(handoffkit-cpp-tcp-client PRIVATE NOMINMAX)
    endif()
  endif()
endif()

if(HANDOFFKIT_ML_BUILD_TESTS)
  enable_testing()
  function(hk_ml_test name src)
    add_executable(${name} ${src})
    target_link_libraries(${name} PRIVATE handoffkit_ml)
    if(WIN32)
      target_compile_definitions(${name} PRIVATE NOMINMAX)
    endif()
    if(MSVC)
      target_compile_options(${name} PRIVATE /UNDEBUG)
    else()
      target_compile_options(${name} PRIVATE -UNDEBUG)
    endif()
    add_test(NAME ${name} COMMAND ${name})
  endfunction()
  hk_ml_test(test_ml_smoke tests/test_ml_smoke.cpp)
  hk_ml_test(test_ml_ops tests/test_ml_ops.cpp)
  hk_ml_test(test_ml_sft tests/test_ml_sft.cpp)
  hk_ml_test(test_ml_distill_wire tests/test_ml_distill_wire.cpp)
  hk_ml_test(test_ml_lora tests/test_ml_lora.cpp)
  hk_ml_test(test_ml_preference tests/test_ml_preference.cpp)
  hk_ml_test(test_ml_quant tests/test_ml_quant.cpp)
  hk_ml_test(test_ml_attn_parity tests/test_ml_attn_parity.cpp)
  hk_ml_test(test_ml_bpe tests/test_ml_bpe.cpp)
  hk_ml_test(test_ml_gguf tests/test_ml_gguf.cpp)
  hk_ml_test(test_ml_kernels tests/test_ml_kernels.cpp)
  hk_ml_test(test_ml_qlora tests/test_ml_qlora.cpp)
  hk_ml_test(test_ml_qlora_sft tests/test_ml_qlora_sft.cpp)
  hk_ml_test(test_ml_profile_comfort tests/test_ml_profile_comfort.cpp)
  hk_ml_test(test_ml_eval tests/test_ml_eval.cpp)
  hk_ml_test(test_ml_dataset_tools tests/test_ml_dataset_tools.cpp)
  hk_ml_test(test_ml_recipe tests/test_ml_recipe.cpp)
  hk_ml_test(test_ml_generate_sample tests/test_ml_generate_sample.cpp)
  hk_ml_test(test_ml_resume tests/test_ml_resume.cpp)
  hk_ml_test(test_ml_cli_overrides tests/test_ml_cli_overrides.cpp)
  hk_ml_test(test_ml_dist tests/test_ml_dist.cpp)
  hk_ml_test(test_ml_base_load tests/test_ml_base_load.cpp)
  hk_ml_test(test_ml_cuda_parity tests/test_ml_cuda_parity.cpp)
  hk_ml_test(test_ml_cuda_linear tests/test_ml_cuda_linear.cpp)
  hk_ml_test(test_ml_cuda_attn tests/test_ml_cuda_attn.cpp)
  hk_ml_test(test_ml_cuda_sft tests/test_ml_cuda_sft.cpp)
  hk_ml_test(test_ml_cuda_adamw tests/test_ml_cuda_adamw.cpp)
  # Device-resident (DR) — tests added per phase
  hk_ml_test(test_ml_resident_embed tests/test_ml_resident_embed.cpp)
  hk_ml_test(test_ml_resident_linear tests/test_ml_resident_linear.cpp)
  hk_ml_test(test_ml_resident_mlp tests/test_ml_resident_mlp.cpp)
  hk_ml_test(test_ml_resident_block tests/test_ml_resident_block.cpp)
  hk_ml_test(test_ml_resident_gpt tests/test_ml_resident_gpt.cpp)
  if(HANDOFFKIT_ML_LINK_CORE)
    hk_ml_test(test_ml_csp_jobs tests/test_ml_csp_jobs.cpp)
    target_link_libraries(test_ml_csp_jobs PRIVATE handoffkit_core)
    hk_ml_test(test_ml_csp_worker tests/test_ml_csp_worker.cpp)
    target_link_libraries(test_ml_csp_worker PRIVATE handoffkit_core)
    if(HANDOFFKIT_ML_TLS)
      find_package(Python3 COMPONENTS Interpreter QUIET)
      if(Python3_Interpreter_FOUND)
        add_test(
          NAME test_ml_tls_worker
          COMMAND ${Python3_EXECUTABLE}
                  ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_tls_worker.py
                  $<TARGET_FILE:handoffkit-cpp-ml-worker>)
      else()
        message(WARNING "HANDOFFKIT_ML_TLS tests require a Python interpreter; skipping real worker socket test")
      endif()
    endif()
  endif()
endif()

install(TARGETS handoffkit_ml
  EXPORT handoffkit_mlTargets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)
install(DIRECTORY include/handoffkit DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
if(HANDOFFKIT_ML_BUILD_CLI)
  install(TARGETS handoffkit-ml RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()
if(HANDOFFKIT_ML_LINK_CORE)
  install(TARGETS handoffkit-cpp-ml-worker RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()
install(EXPORT handoffkit_mlTargets
  FILE handoffkit_mlTargets.cmake
  NAMESPACE handoffkit::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit_ml
)

configure_package_config_file(
  ${CMAKE_CURRENT_SOURCE_DIR}/cmake/handoffkit_mlConfig.cmake.in
  ${CMAKE_CURRENT_BINARY_DIR}/handoffkit_mlConfig.cmake
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit_ml
)
write_basic_package_version_file(
  ${CMAKE_CURRENT_BINARY_DIR}/handoffkit_mlConfigVersion.cmake
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion
)
install(FILES
  ${CMAKE_CURRENT_BINARY_DIR}/handoffkit_mlConfig.cmake
  ${CMAKE_CURRENT_BINARY_DIR}/handoffkit_mlConfigVersion.cmake
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit_ml
)
