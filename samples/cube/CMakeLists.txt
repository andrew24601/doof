cmake_minimum_required(VERSION 3.20)
project(RotatingCube LANGUAGES CXX OBJCXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OBJCXX_STANDARD 17)
set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)

# Find SDL3
find_package(SDL3 REQUIRED CONFIG)

# Find Metal and related frameworks
find_library(METAL_FRAMEWORK Metal REQUIRED)
find_library(QUARTZCORE_FRAMEWORK QuartzCore REQUIRED)
find_library(FOUNDATION_FRAMEWORK Foundation REQUIRED)
find_library(COCOA_FRAMEWORK Cocoa REQUIRED)

# Compile Metal shaders
set(SHADER_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/shaders.metal)
set(SHADER_AIR ${CMAKE_CURRENT_BINARY_DIR}/shaders.air)
set(SHADER_METALLIB ${CMAKE_CURRENT_BINARY_DIR}/shaders.metallib)

add_custom_command(
    OUTPUT ${SHADER_AIR}
    COMMAND xcrun -sdk macosx metal -c ${SHADER_SOURCE} -o ${SHADER_AIR}
    DEPENDS ${SHADER_SOURCE}
    COMMENT "Compiling Metal shaders to AIR"
)

add_custom_command(
    OUTPUT ${SHADER_METALLIB}
    COMMAND xcrun -sdk macosx metallib ${SHADER_AIR} -o ${SHADER_METALLIB}
    DEPENDS ${SHADER_AIR}
    COMMENT "Linking Metal shader library"
)

add_custom_target(shaders DEPENDS ${SHADER_METALLIB})

# Note: The generated C++ from doof should be placed in the generated directory
# Run: npx tsx src/cli.ts samples/cube/rotating_cube_v2.do --output-dir samples/cube/generated

# Source files - the bridge implementation
set(SOURCES
    sdl_metal_bridge.mm
    ${CMAKE_CURRENT_SOURCE_DIR}/../../doof_runtime.cpp
)

# Generated doof files (after transpilation)
# The new version uses imports, so both files are needed
set(GENERATED_SOURCES
    generated/rotating_cube_v2.cpp
)

# Check if generated files exist
if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/generated/rotating_cube_v2.cpp")
    message(WARNING "Generated files not found. Run from repo root:")
    message(WARNING "  npx tsx src/cli.ts samples/cube/rotating_cube_v2.do --output-dir samples/cube/generated")
endif()

# Main executable (v2 with imports and low-level API)
add_executable(rotating_cube 
    ${SOURCES}
    ${GENERATED_SOURCES}
)

add_dependencies(rotating_cube shaders)

target_include_directories(rotating_cube PRIVATE 
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../..
    ${CMAKE_CURRENT_SOURCE_DIR}/generated
)

target_link_libraries(rotating_cube PRIVATE
    SDL3::SDL3
    ${METAL_FRAMEWORK}
    ${QUARTZCORE_FRAMEWORK}
    ${FOUNDATION_FRAMEWORK}
    ${COCOA_FRAMEWORK}
)

# Copy shader library to output directory
add_custom_command(TARGET rotating_cube POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy ${SHADER_METALLIB} $<TARGET_FILE_DIR:rotating_cube>/shaders.metallib
    COMMENT "Copying shader library to output directory"
)

# Enable ARC for Objective-C++
target_compile_options(rotating_cube PRIVATE 
    $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>
)
