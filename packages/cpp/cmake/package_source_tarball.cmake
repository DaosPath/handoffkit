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
  examples
  tests
  scripts
  test_package
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

# Optional: include contracts fixtures for offline consumers that want them
if(EXISTS "${SOURCE_DIR}/../contracts/fixtures")
  file(COPY "${SOURCE_DIR}/../contracts/fixtures" DESTINATION "${STAGE}/contracts")
  file(COPY "${SOURCE_DIR}/../contracts/schemas" DESTINATION "${STAGE}/contracts")
endif()

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
