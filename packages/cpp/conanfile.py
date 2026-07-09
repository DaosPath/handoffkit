from conan import ConanFile
from conan.tools.cmake import CMake, cmake_layout, CMakeDeps, CMakeToolchain


class HandoffKitConan(ConanFile):
    name = "handoffkit"
    version = "1.12.0"
    license = "MIT"
    author = "DaosPath <daospath@gmail.com>"
    url = "https://github.com/DaosPath/handoffkit"
    description = "C++ contract layer for multi-agent workflows with structured handoffs"
    topics = ("multi-agent", "state-transfer", "json", "handoffs")
    settings = "os", "compiler", "build_type", "arch"
    options = {"shared": [True, False], "fPIC": [True, False]}
    default_options = {"shared": False, "fPIC": True}

    def config_options(self):
        if self.settings.os == "Windows":
            del self.options.fPIC

    def layout(self):
        cmake_layout(self)

    def requirements(self):
        self.requires("nlohmann_json/3.11.3")

    def generate(self):
        tc = CMakeToolchain(self)
        tc.generate()
        deps = CMakeDeps(self)
        deps.generate()

    def build(self):
        cmake = CMake(self)
        cmake.configure()
        cmake.build()

    def package(self):
        cmake = CMake(self)
        cmake.install()

    def package_info(self):
        self.cpp_info.libs = ["handoffkit"]
