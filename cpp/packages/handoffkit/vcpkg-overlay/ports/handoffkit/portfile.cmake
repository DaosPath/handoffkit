vcpkg_from_github(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO DaosPath/handoffkit
    REF "v${VERSION}"
    SHA512 0
    HEAD_REF main
)

# Monorepo layout: library lives under packages/cpp
set(SOURCE_PATH "${SOURCE_PATH}/packages/cpp")

vcpkg_cmake_configure(
    SOURCE_PATH "${SOURCE_PATH}"
    OPTIONS
        -DHANDOFFKIT_BUILD_TESTS=OFF
        -DHANDOFFKIT_BUILD_EXAMPLES=OFF
        -DHANDOFFKIT_FETCH_JSON=OFF
        -DHANDOFFKIT_WITH_HTTP=OFF
)

vcpkg_cmake_install()
vcpkg_cmake_config_fix_package(PACKAGE_NAME handoffkit CONFIG_PATH share/handoffkit)
# Also support lib/cmake layout from GNUInstallDirs
file(GLOB _cfg "${CURRENT_PACKAGES_DIR}/lib/cmake/handoffkit/*")
if(_cfg)
    file(COPY ${_cfg} DESTINATION "${CURRENT_PACKAGES_DIR}/share/handoffkit")
endif()

vcpkg_install_copyright(FILE_LIST "${SOURCE_PATH}/LICENSE")

file(REMOVE_RECURSE "${CURRENT_PACKAGES_DIR}/debug/include")
