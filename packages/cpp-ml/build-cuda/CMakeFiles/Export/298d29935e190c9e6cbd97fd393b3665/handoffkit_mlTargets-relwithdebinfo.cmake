#----------------------------------------------------------------
# Generated CMake target import file for configuration "RelWithDebInfo".
#----------------------------------------------------------------

# Commands may need to know the format version.
set(CMAKE_IMPORT_FILE_VERSION 1)

# Import target "handoffkit::handoffkit_ml" for configuration "RelWithDebInfo"
set_property(TARGET handoffkit::handoffkit_ml APPEND PROPERTY IMPORTED_CONFIGURATIONS RELWITHDEBINFO)
set_target_properties(handoffkit::handoffkit_ml PROPERTIES
  IMPORTED_LINK_INTERFACE_LANGUAGES_RELWITHDEBINFO "CUDA;CXX"
  IMPORTED_LOCATION_RELWITHDEBINFO "${_IMPORT_PREFIX}/lib/handoffkit_ml.lib"
  )

list(APPEND _cmake_import_check_targets handoffkit::handoffkit_ml )
list(APPEND _cmake_import_check_files_for_handoffkit::handoffkit_ml "${_IMPORT_PREFIX}/lib/handoffkit_ml.lib" )

# Commands beyond this point should not need to know the version.
set(CMAKE_IMPORT_FILE_VERSION)
