# Creates a self-contained source tree + tar.gz for releases.
if(NOT DEFINED SOURCE_DIR OR NOT DEFINED VERSION OR NOT DEFINED OUT_DIR)
  message(FATAL_ERROR "SOURCE_DIR, VERSION, and OUT_DIR are required")
endif()

set(STAGE "${OUT_DIR}/handoffkit-cpp-${VERSION}")
file(REMOVE_RECURSE "${STAGE}")
file(MAKE_DIRECTORY "${STAGE}")

foreach(item IN ITEMS
  CMakeLists.txt
  cmake
  include
  src
  benchmarks
  examples
  tests
  scripts
  LICENSE
  README.md
  RELEASE.md
  conanfile.py
  conandata.yml
  vcpkg.json
  vcpkg-overlay
)
  if(EXISTS "${SOURCE_DIR}/${item}")
    file(COPY "${SOURCE_DIR}/${item}" DESTINATION "${STAGE}")
  endif()
endforeach()

# Copy only the source files from the Conan consumer smoke. Ignored local
# presets and build directories must never enter a release archive.
file(MAKE_DIRECTORY "${STAGE}/test_package/src")
foreach(item IN ITEMS CMakeLists.txt conanfile.py)
  file(COPY "${SOURCE_DIR}/test_package/${item}" DESTINATION "${STAGE}/test_package")
endforeach()
file(COPY "${SOURCE_DIR}/test_package/src/example.cpp"
  DESTINATION "${STAGE}/test_package/src")

# Include the complete small contract corpus so extracted source packages can
# run fixture, security-conformance, and artifact-provider tests offline. Use a
# whitelist so ignored/generated credentials can never leak into the tarball.
set(CONTRACTS_SOURCE "${SOURCE_DIR}/../contracts")
file(MAKE_DIRECTORY "${STAGE}/contracts")
foreach(item IN ITEMS corpus fixtures schemas conformance)
  if(EXISTS "${CONTRACTS_SOURCE}/${item}")
    file(COPY "${CONTRACTS_SOURCE}/${item}" DESTINATION "${STAGE}/contracts")
  endif()
endforeach()
foreach(item IN ITEMS
  test-fixtures/artifact-signing/README.md
  test-fixtures/artifact-signing/generate.py
  test-fixtures/artifact-signing/vector.json
  test-fixtures/tls/README.md
  test-fixtures/tls/generate.py
)
  get_filename_component(item_dir "${item}" DIRECTORY)
  file(MAKE_DIRECTORY "${STAGE}/contracts/${item_dir}")
  file(COPY "${CONTRACTS_SOURCE}/${item}"
    DESTINATION "${STAGE}/contracts/${item_dir}")
endforeach()

set(ARCHIVE "${OUT_DIR}/handoffkit-cpp-${VERSION}.tar.gz")
execute_process(
  COMMAND ${CMAKE_COMMAND} -E tar czf "${ARCHIVE}" "handoffkit-cpp-${VERSION}"
  WORKING_DIRECTORY "${OUT_DIR}"
  RESULT_VARIABLE tar_rc
)
if(NOT tar_rc EQUAL 0)
  message(FATAL_ERROR "Failed to create ${ARCHIVE}")
endif()

file(SHA256 "${ARCHIVE}" archive_sha)
file(WRITE "${OUT_DIR}/SHA256SUMS" "handoffkit-cpp-${VERSION}.tar.gz  ${archive_sha}\n")
message(STATUS "Created ${ARCHIVE}")
message(STATUS "SHA256 ${archive_sha}")
