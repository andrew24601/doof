cmake_minimum_required(VERSION 3.10)
project(Unity_DominoRemoteRunner)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

get_filename_component(DOMINO_VM_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../vm" ABSOLUTE)
add_subdirectory(${DOMINO_VM_DIR} ${CMAKE_BINARY_DIR}/domino-vm-build)

add_library(UnityDominoRemoteRunner SHARED remote_runner.cpp)
target_include_directories(UnityDominoRemoteRunner PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_include_directories(UnityDominoRemoteRunner PRIVATE ${DOMINO_VM_DIR}/include)
target_link_libraries(UnityDominoRemoteRunner PRIVATE domino-vm)

set_target_properties(UnityDominoRemoteRunner PROPERTIES
    OUTPUT_NAME "UnityDominoRemoteRunner"
)

add_executable(test_remote_runner test_client.cpp)
target_include_directories(test_remote_runner PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(test_remote_runner PRIVATE UnityDominoRemoteRunner pthread)
