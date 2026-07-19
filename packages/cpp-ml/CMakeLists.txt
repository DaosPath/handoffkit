# HandoffKit ML — optional complement (NOT part of handoffkit_core).
cmake_minimum_required(VERSION 3.16)
project(handoffkit_ml VERSION 0.3.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(HANDOFFKIT_ML_BUILD_TESTS "Build handoffkit-ml unit tests" ON)
option(HANDOFFKIT_ML_BUILD_CLI "Build handoffkit-ml CLI" ON)
option(HANDOFFKIT_ML_CUDA "Enable CUDA compile definitions (F4; kernels optional)" OFF)
option(HANDOFFKIT_ML_LINK_CORE "Link handoffkit_core when available" OFF)
set(HANDOFFKIT_CORE_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp"
    CACHE PATH "In-tree path to packages/cpp (core)")

include(GNUInstallDirs)

set(HANDOFFKIT_ML_SOURCES
  src/version.cpp
  src/ops.cpp
  src/cuda_kernels.cpp
)

add_library(handoffkit_ml STATIC ${HANDOFFKIT_ML_SOURCES})
add_library(handoffkit::ml ALIAS handoffkit_ml)

target_include_directories(handoffkit_ml
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)
target_compile_features(handoffkit_ml PUBLIC cxx_std_20)

if(HANDOFFKIT_ML_CUDA)
  target_compile_definitions(handoffkit_ml PUBLIC HANDOFFKIT_ML_WITH_CUDA=1)
  enable_language(CUDA OPTIONAL)
  find_package(CUDAToolkit QUIET)
  if(CUDAToolkit_FOUND)
    target_link_libraries(handoffkit_ml PUBLIC CUDA::cudart CUDA::cublas)
    message(STATUS "HANDOFFKIT_ML_CUDA=ON linked CUDA::cudart CUDA::cublas")
  else()
    message(STATUS "HANDOFFKIT_ML_CUDA=ON but CUDAToolkit not found — host matmul fallback")
  endif()
endif()
find_package(Threads REQUIRED)
target_link_libraries(handoffkit_ml PUBLIC Threads::Threads)

if(HANDOFFKIT_ML_LINK_CORE)
  if(TARGET handoffkit_core)
    target_link_libraries(handoffkit_ml PUBLIC handoffkit_core)
  else()
    message(FATAL_ERROR "HANDOFFKIT_ML_LINK_CORE=ON but handoffkit_core target missing")
  endif()
endif()

if(HANDOFFKIT_ML_BUILD_CLI)
  add_executable(handoffkit-ml src/cli/main.cpp)
  target_link_libraries(handoffkit-ml PRIVATE handoffkit_ml)
  if(WIN32)
    target_compile_definitions(handoffkit-ml PRIVATE NOMINMAX)
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
    add_test(NAME ${name} COMMAND ${name})
  endfunction()
  hk_ml_test(test_ml_smoke tests/test_ml_smoke.cpp)
  hk_ml_test(test_ml_ops tests/test_ml_ops.cpp)
  hk_ml_test(test_ml_sft tests/test_ml_sft.cpp)
  hk_ml_test(test_ml_lora tests/test_ml_lora.cpp)
  hk_ml_test(test_ml_preference tests/test_ml_preference.cpp)
  hk_ml_test(test_ml_quant tests/test_ml_quant.cpp)
  hk_ml_test(test_ml_attn_parity tests/test_ml_attn_parity.cpp)
  hk_ml_test(test_ml_bpe tests/test_ml_bpe.cpp)
  hk_ml_test(test_ml_gguf tests/test_ml_gguf.cpp)
  hk_ml_test(test_ml_kernels tests/test_ml_kernels.cpp)
  hk_ml_test(test_ml_qlora tests/test_ml_qlora.cpp)
  hk_ml_test(test_ml_dist tests/test_ml_dist.cpp)
  hk_ml_test(test_ml_base_load tests/test_ml_base_load.cpp)
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
install(EXPORT handoffkit_mlTargets
  FILE handoffkit_mlTargets.cmake
  NAMESPACE handoffkit::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/handoffkit_ml
)
