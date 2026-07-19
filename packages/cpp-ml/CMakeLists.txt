# HandoffKit ML — optional complement (NOT part of handoffkit_core).
# Train weights / tensors / optimizers live here. Core stays light.
cmake_minimum_required(VERSION 3.16)
project(handoffkit_ml VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(HANDOFFKIT_ML_BUILD_TESTS "Build handoffkit-ml unit tests" ON)
option(HANDOFFKIT_ML_BUILD_CLI "Build handoffkit-ml CLI" ON)
option(HANDOFFKIT_ML_CUDA "Enable CUDA backend (Fase 4+; default OFF)" OFF)
# Optional: consume train JSONL types from core (Fase 2+). F0 does not require a prebuilt core.
option(HANDOFFKIT_ML_LINK_CORE "Link handoffkit_core when available" OFF)
set(HANDOFFKIT_CORE_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp"
    CACHE PATH "In-tree path to packages/cpp (core)")

if(HANDOFFKIT_ML_CUDA)
  message(WARNING "HANDOFFKIT_ML_CUDA=ON is experimental and not implemented in 0.1.x")
endif()

include(GNUInstallDirs)

set(HANDOFFKIT_ML_SOURCES
  src/version.cpp
)

add_library(handoffkit_ml STATIC ${HANDOFFKIT_ML_SOURCES})
add_library(handoffkit::ml ALIAS handoffkit_ml)

target_include_directories(handoffkit_ml
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)

target_compile_features(handoffkit_ml PUBLIC cxx_std_20)

if(HANDOFFKIT_ML_LINK_CORE)
  if(TARGET handoffkit_core)
    target_link_libraries(handoffkit_ml PUBLIC handoffkit_core)
  elseif(EXISTS "${HANDOFFKIT_CORE_SOURCE_DIR}/CMakeLists.txt")
    # Prefer a pre-configured core build; do not force-add full monorepo by default.
    message(STATUS "HANDOFFKIT_ML_LINK_CORE=ON but handoffkit_core target missing — "
                   "build/install packages/cpp first, or add_subdirectory it from a superbuild.")
    message(FATAL_ERROR "handoffkit_core not found (set up core before HANDOFFKIT_ML_LINK_CORE=ON)")
  else()
    message(FATAL_ERROR "HANDOFFKIT_ML_LINK_CORE=ON but core not found at ${HANDOFFKIT_CORE_SOURCE_DIR}")
  endif()
endif()

if(HANDOFFKIT_ML_BUILD_CLI)
  add_executable(handoffkit-ml src/cli/main.cpp)
  target_link_libraries(handoffkit-ml PRIVATE handoffkit_ml)
  # Windows: avoid min/max macros if any headers pull windows.h later
  if(WIN32)
    target_compile_definitions(handoffkit-ml PRIVATE NOMINMAX)
  endif()
endif()

if(HANDOFFKIT_ML_BUILD_TESTS)
  enable_testing()
  add_executable(test_ml_smoke tests/test_ml_smoke.cpp)
  target_link_libraries(test_ml_smoke PRIVATE handoffkit_ml)
  add_test(NAME test_ml_smoke COMMAND test_ml_smoke)
endif()

# --- install (optional consumers of the complement) ---
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
