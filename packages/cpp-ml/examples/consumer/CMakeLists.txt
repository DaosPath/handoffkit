cmake_minimum_required(VERSION 3.18)
project(handoffkit_ml_consumer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(HandoffKit CONFIG REQUIRED)
find_package(handoffkit_ml 0.6 CONFIG REQUIRED)

add_executable(handoffkit_ml_consumer main.cpp)
target_link_libraries(handoffkit_ml_consumer PRIVATE handoffkit::ml)
