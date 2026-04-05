cmake_minimum_required(VERSION 3.20)

include(FetchContent)

set(DOOF_SEAHAVEN_LANGUAGES CXX)
if(APPLE)
    list(APPEND DOOF_SEAHAVEN_LANGUAGES OBJCXX)
endif()

project(DoofSeahavenTowersSample LANGUAGES ${DOOF_SEAHAVEN_LANGUAGES})

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(DOOF_SEAHAVEN_EXECUTABLE "DoofSeahavenTowers")
set(DOOF_SEAHAVEN_DISPLAY_NAME "Doof Seahaven Towers")
set(DOOF_SEAHAVEN_BUNDLE_ID "dev.doof.seahaven-towers")
set(DOOF_SEAHAVEN_VERSION "1.0")

set(DOOF_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")
set(DOOF_OUTPUT_DIR "${DOOF_REPO_ROOT}/build-seahaven-towers")
set(DOOF_SHARED_HOST_DIR "${DOOF_REPO_ROOT}/samples/lib/cardgame")
set(DOOF_SHARED_ENGINE_DIR "${DOOF_SHARED_HOST_DIR}/engine")

set(DOOF_REQUIRED_HEADERS
    app-state.hpp
    lib/cardgame/button.hpp
    camera.hpp
    lib/cardgame/content.hpp
    lib/cardgame/host-runtime.hpp
    lib/cardgame/render-plan.hpp
    lib/cardgame/types.hpp
    host.hpp
    render.hpp
)

foreach(DOOF_REQUIRED_HEADER IN LISTS DOOF_REQUIRED_HEADERS)
    if(NOT EXISTS "${DOOF_OUTPUT_DIR}/${DOOF_REQUIRED_HEADER}")
        message(FATAL_ERROR
            "Generated Doof sources were not found in ${DOOF_OUTPUT_DIR}. Run `node dist/cli.js emit --include-path <repo-root> -o build-seahaven-towers samples/seahaven-towers/main.do` from the repository root first. Missing ${DOOF_REQUIRED_HEADER}."
        )
    endif()
endforeach()

if(NOT EXISTS "${DOOF_OUTPUT_DIR}/doof_runtime.hpp")
    message(FATAL_ERROR
        "Generated Doof sources were not found in ${DOOF_OUTPUT_DIR}. Run `node dist/cli.js emit --include-path <repo-root> -o build-seahaven-towers samples/seahaven-towers/main.do` from the repository root first. Missing doof_runtime.hpp."
    )
endif()

find_package(SDL3 CONFIG QUIET)
find_package(nlohmann_json CONFIG QUIET)

if(NOT nlohmann_json_FOUND)
    FetchContent_Declare(
        json
        URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    FetchContent_MakeAvailable(json)
endif()

if(NOT SDL3_FOUND)
    if(WIN32)
        message(FATAL_ERROR
            "SDL3 was not found. On Windows, install SDL3 with vcpkg and configure CMake with -DCMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%/scripts/buildsystems/vcpkg.cmake, or point CMAKE_PREFIX_PATH at an SDL3 package config directory."
        )
    endif()

    find_package(PkgConfig REQUIRED)
    pkg_check_modules(SDL3 REQUIRED IMPORTED_TARGET sdl3)
endif()

if(APPLE)
    add_subdirectory("${DOOF_SHARED_ENGINE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/boardgame-engine")
endif()

file(GLOB DOOF_GENERATED_SOURCES CONFIGURE_DEPENDS "${DOOF_OUTPUT_DIR}/*.cpp")
file(GLOB_RECURSE DOOF_GENERATED_SHARED_SOURCES CONFIGURE_DEPENDS "${DOOF_OUTPUT_DIR}/lib/**/*.cpp")
list(APPEND DOOF_GENERATED_SOURCES ${DOOF_GENERATED_SHARED_SOURCES})

set(DOOF_SEAHAVEN_HOST_SOURCE)
if(APPLE)
    set(DOOF_SEAHAVEN_HOST_SOURCE "${DOOF_SHARED_HOST_DIR}/native_boardgame_host.mm")
elseif(WIN32)
    set(DOOF_SEAHAVEN_HOST_SOURCE "${DOOF_SHARED_HOST_DIR}/native_boardgame_host.cpp")
else()
    message(FATAL_ERROR "The Seahaven Towers sample currently supports macOS and Windows native builds.")
endif()

set(DOOF_SEAHAVEN_TARGET_ARGS)
if(APPLE)
    list(APPEND DOOF_SEAHAVEN_TARGET_ARGS MACOSX_BUNDLE)
endif()

add_executable(DoofSeahavenTowers
    ${DOOF_SEAHAVEN_TARGET_ARGS}
    ${DOOF_SEAHAVEN_HOST_SOURCE}
    ${DOOF_GENERATED_SOURCES}
)

if(WIN32)
    set_target_properties(DoofSeahavenTowers PROPERTIES WIN32_EXECUTABLE TRUE)
endif()

target_include_directories(DoofSeahavenTowers PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${DOOF_SHARED_HOST_DIR}
    ${DOOF_OUTPUT_DIR}
    ${DOOF_REPO_ROOT}
)

if(APPLE)
    target_link_libraries(DoofSeahavenTowers PRIVATE BoardGameEngine)
endif()

if(SDL3_FOUND)
    target_link_libraries(DoofSeahavenTowers PRIVATE SDL3::SDL3)
else()
    target_link_libraries(DoofSeahavenTowers PRIVATE PkgConfig::SDL3)
endif()

target_link_libraries(DoofSeahavenTowers PRIVATE nlohmann_json::nlohmann_json)

if(APPLE)
    target_link_libraries(DoofSeahavenTowers PRIVATE "-framework Cocoa" "-framework Foundation")
elseif(WIN32)
    target_link_libraries(DoofSeahavenTowers PRIVATE windowscodecs ole32)
endif()

target_compile_definitions(DoofSeahavenTowers PRIVATE SDL_MAIN_HANDLED)

if(MSVC)
    target_compile_definitions(DoofSeahavenTowers PRIVATE NOMINMAX)
    if(WIN32)
        target_link_options(DoofSeahavenTowers PRIVATE /ENTRY:mainCRTStartup)
    endif()
elseif(WIN32)
    target_link_options(DoofSeahavenTowers PRIVATE -mwindows)
endif()

file(GLOB DOOF_SAMPLE_IMAGE_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/images/*")

if(APPLE)
    set(DOOF_SEAHAVEN_ICON_SVG "${CMAKE_CURRENT_SOURCE_DIR}/app-icon.svg")
    set(DOOF_SEAHAVEN_ICON_ICNS "${CMAKE_CURRENT_BINARY_DIR}/DoofSeahavenTowers.icns")
    set(DOOF_SEAHAVEN_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/Info.plist")

    configure_file("${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in" "${DOOF_SEAHAVEN_INFO_PLIST}" @ONLY)

    add_custom_command(
        OUTPUT "${DOOF_SEAHAVEN_ICON_ICNS}"
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_CURRENT_BINARY_DIR}"
        COMMAND /bin/bash "${DOOF_REPO_ROOT}/scripts/generate-macos-icon.sh" "${DOOF_SEAHAVEN_ICON_SVG}" "${DOOF_SEAHAVEN_ICON_ICNS}"
        DEPENDS "${DOOF_SEAHAVEN_ICON_SVG}" "${DOOF_REPO_ROOT}/scripts/generate-macos-icon.sh"
        COMMENT "Generating Doof Seahaven Towers app icon"
        VERBATIM
    )

    target_sources(DoofSeahavenTowers PRIVATE "${DOOF_SEAHAVEN_ICON_ICNS}" ${DOOF_SAMPLE_IMAGE_FILES})
    set_source_files_properties("${DOOF_SEAHAVEN_ICON_ICNS}" PROPERTIES MACOSX_PACKAGE_LOCATION "Resources")
    foreach(DOOF_SAMPLE_IMAGE IN LISTS DOOF_SAMPLE_IMAGE_FILES)
        set_source_files_properties("${DOOF_SAMPLE_IMAGE}" PROPERTIES MACOSX_PACKAGE_LOCATION "Resources/images")
    endforeach()

    set_target_properties(DoofSeahavenTowers PROPERTIES
        MACOSX_BUNDLE_INFO_PLIST "${DOOF_SEAHAVEN_INFO_PLIST}"
    )
else()
    add_custom_command(TARGET DoofSeahavenTowers POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CMAKE_CURRENT_SOURCE_DIR}/images"
        "$<TARGET_FILE_DIR:DoofSeahavenTowers>/images"
    )
endif()