from conan import ConanFile
from conan.tools.cmake import CMake, CMakeDeps, CMakeToolchain, cmake_layout
from conan.tools.files import copy
import os


class HandoffKitConan(ConanFile):
    name = "handoffkit"
    version = "1.14.1"
    license = "MIT"
    author = "DaosPath <daospath@gmail.com>"
    url = "https://github.com/DaosPath/handoffkit"
    homepage = "https://github.com/DaosPath/handoffkit"
    description = "Native C++20 multi-agent runtime with structured handoffs"
    topics = ("multi-agent", "handoffs", "llm", "json", "cpp20")
    settings = "os", "compiler", "build_type", "arch"
    options = {
        "shared": [True, False],
        "fPIC": [True, False],
        "with_http": [True, False],
    }
    default_options = {
        "shared": False,
        "fPIC": True,
        "with_http": False,
    }
    exports_sources = (
        "CMakeLists.txt",
        "cmake/*",
        "include/*",
        "src/*",
        "LICENSE",
        "README.md",
        "conandata.yml",
    )

    def config_options(self):
        if self.settings.os == "Windows":
            del self.options.fPIC

    def configure(self):
        if self.options.shared:
            self.options.rm_safe("fPIC")

    def layout(self):
        cmake_layout(self)

    def requirements(self):
        self.requires("nlohmann_json/3.11.3", transitive_headers=True)

    def generate(self):
        tc = CMakeToolchain(self)
        tc.variables["HANDOFFKIT_BUILD_TESTS"] = False
        tc.variables["HANDOFFKIT_BUILD_EXAMPLES"] = False
        tc.variables["HANDOFFKIT_BUILD_CLI"] = False
        tc.variables["HANDOFFKIT_BUILD_DEMOS"] = True
        tc.variables["HANDOFFKIT_FETCH_JSON"] = False
        tc.variables["HANDOFFKIT_WITH_HTTP"] = bool(self.options.with_http)
        tc.generate()
        deps = CMakeDeps(self)
        deps.generate()

    def build(self):
        cmake = CMake(self)
        cmake.configure()
        cmake.build()

    def package(self):
        copy(self, "LICENSE", src=self.source_folder, dst=os.path.join(self.package_folder, "licenses"))
        cmake = CMake(self)
        cmake.install()

    def package_info(self):
        self.cpp_info.set_property("cmake_file_name", "handoffkit")
        self.cpp_info.set_property("cmake_target_name", "handoffkit::handoffkit")
        # Headers include <nlohmann/json.hpp>; propagate Conan dependency to consumers.
        self.cpp_info.requires = ["nlohmann_json::nlohmann_json"]
        # Link demos then core (demos depends on core symbols).
        self.cpp_info.libs = ["handoffkit_demos", "handoffkit_core"]
        self.cpp_info.components["core"].libs = ["handoffkit_core"]
        self.cpp_info.components["core"].set_property("cmake_target_name", "handoffkit::core")
        self.cpp_info.components["core"].requires = ["nlohmann_json::nlohmann_json"]
        self.cpp_info.components["demos"].libs = ["handoffkit_demos"]
        self.cpp_info.components["demos"].requires = ["core", "nlohmann_json::nlohmann_json"]
        self.cpp_info.components["demos"].set_property("cmake_target_name", "handoffkit::demos")
