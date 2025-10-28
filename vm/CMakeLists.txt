cmake_minimum_required(VERSION 3.10)
project(DoofVM)
set(CMAKE_CXX_STANDARD 17)

# Options for performance optimization
option(DOMINO_VM_UNSAFE "Disable bounds checking and validation for maximum performance" OFF)

# Enable debug information and warnings
set(CMAKE_CXX_FLAGS_DEBUG "-g -Wall -Wextra -pedantic")
# For Release builds, avoid architecture-specific flags when cross-compiling for iOS.
if(DEFINED CMAKE_SYSTEM_NAME AND CMAKE_SYSTEM_NAME STREQUAL "iOS")
    set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")
else()
    set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG -flto -march=native")
endif()

# Add JSON bytecode runner
# Build a reusable static library for the VM core so other targets (and the XCFramework) can link it.
add_library(doof-vm STATIC
    src/vm.cpp
    src/doof_vm_c.cpp
    src/iterator.cpp
    src/debug.cpp
    src/json_bytecode_loader.cpp
    src/dap.cpp
    src/dap_channel.cpp
)
target_include_directories(doof-vm PUBLIC include)
set_target_properties(doof-vm PROPERTIES
    POSITION_INDEPENDENT_CODE ON
    PUBLIC_HEADER "include/doof_vm_c.h"
)

# Install rules so `cmake --build --target install` will populate an install prefix
install(TARGETS doof-vm
    ARCHIVE DESTINATION lib
    PUBLIC_HEADER DESTINATION include
)

install(DIRECTORY include/ DESTINATION include FILES_MATCHING PATTERN "*.h")

# Install the module map and umbrella header so Swift/Clang can `import DominoVM`.
install(FILES include/module.modulemap DESTINATION include)


# JSON runner uses the library
add_executable(json-runner 
    src/json_runner.cpp
)
target_link_libraries(json-runner PRIVATE doof-vm)
target_include_directories(json-runner PRIVATE include)

# Conditional compilation flags
if(DOMINO_VM_UNSAFE)
    target_compile_definitions(json-runner PRIVATE DOMINO_VM_UNSAFE)
    message(STATUS "Building with DOMINO_VM_UNSAFE - validation disabled for maximum performance")
endif()

# Add unsafe JSON runner for maximum performance
# unsafe runner links the same library but with unsafe defines
add_executable(json-runner-unsafe 
    src/json_runner.cpp
)
target_link_libraries(json-runner-unsafe PRIVATE doof-vm)
# Remote single-session VM server with socket DAP
add_executable(remote-vm-server
    src/remote_server.cpp
)
target_link_libraries(remote-vm-server PRIVATE doof-vm)
target_include_directories(remote-vm-server PRIVATE include)

add_executable(dap-channel-test
    tests/dap_channel_test.cpp
)
target_link_libraries(dap-channel-test PRIVATE doof-vm)
target_include_directories(dap-channel-test PRIVATE include src)

target_include_directories(json-runner-unsafe PRIVATE include)
target_compile_definitions(json-runner-unsafe PRIVATE DOMINO_VM_UNSAFE)
set_target_properties(json-runner-unsafe PROPERTIES
    COMPILE_FLAGS "-O3 -DNDEBUG -flto -march=native"
    LINK_FLAGS "-flto"
)
