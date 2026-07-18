cmake_minimum_required(VERSION 3.16)
project(handoffkit_test_package LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(handoffkit CONFIG REQUIRED)

add_executable(example src/example.cpp)
target_link_libraries(example PRIVATE handoffkit::handoffkit)
