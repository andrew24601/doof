function(doof_configure_generated_macos_bundle target_name output_dir)
    set(DOOF_BUILD_MANIFEST_PATH "${output_dir}/doof-build.json")
    if(NOT EXISTS "${DOOF_BUILD_MANIFEST_PATH}")
        message(FATAL_ERROR
            "Generated Doof build metadata was not found in ${output_dir}. Run `node dist/cli.js emit -o ${output_dir} <entry.do>` from the repository root first. Missing doof-build.json."
        )
    endif()

    file(READ "${DOOF_BUILD_MANIFEST_PATH}" DOOF_BUILD_MANIFEST_RAW)

    string(JSON DOOF_BUILD_TARGET_KIND ERROR_VARIABLE DOOF_BUILD_TARGET_ERROR GET "${DOOF_BUILD_MANIFEST_RAW}" buildTarget kind)
    if(DOOF_BUILD_TARGET_ERROR OR NOT DOOF_BUILD_TARGET_KIND STREQUAL "macos-app")
        message(FATAL_ERROR
            "Generated Doof build metadata in ${output_dir} does not declare build.target = \"macos-app\"."
        )
    endif()

    string(JSON DOOF_OUTPUT_BINARY_NAME GET "${DOOF_BUILD_MANIFEST_RAW}" outputBinaryName)
    string(JSON DOOF_APP_ICON_PATH GET "${DOOF_BUILD_MANIFEST_RAW}" buildTarget config iconPath)

    set(DOOF_INFO_PLIST_PATH "${output_dir}/Info.plist")
    set(DOOF_ICON_SCRIPT_PATH "${output_dir}/generate-macos-icon.sh")
    set(DOOF_ICON_ICNS_PATH "${CMAKE_CURRENT_BINARY_DIR}/${DOOF_OUTPUT_BINARY_NAME}.icns")

    if(NOT EXISTS "${DOOF_INFO_PLIST_PATH}")
        message(FATAL_ERROR
            "Generated Doof macOS bundle metadata was not found in ${output_dir}. Missing Info.plist."
        )
    endif()

    if(NOT EXISTS "${DOOF_ICON_SCRIPT_PATH}")
        message(FATAL_ERROR
            "Generated Doof macOS icon helper was not found in ${output_dir}. Missing generate-macos-icon.sh."
        )
    endif()

    set_target_properties(${target_name} PROPERTIES
        MACOSX_BUNDLE TRUE
        OUTPUT_NAME "${DOOF_OUTPUT_BINARY_NAME}"
        MACOSX_BUNDLE_INFO_PLIST "${DOOF_INFO_PLIST_PATH}"
    )

    add_custom_command(
        OUTPUT "${DOOF_ICON_ICNS_PATH}"
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_CURRENT_BINARY_DIR}"
        COMMAND /bin/bash "${DOOF_ICON_SCRIPT_PATH}" "${DOOF_APP_ICON_PATH}" "${DOOF_ICON_ICNS_PATH}"
        DEPENDS "${DOOF_APP_ICON_PATH}" "${DOOF_ICON_SCRIPT_PATH}"
        COMMENT "Generating ${DOOF_OUTPUT_BINARY_NAME} app icon"
        VERBATIM
    )

    target_sources(${target_name} PRIVATE "${DOOF_ICON_ICNS_PATH}")
    set_source_files_properties("${DOOF_ICON_ICNS_PATH}" PROPERTIES MACOSX_PACKAGE_LOCATION "Resources")

    string(JSON DOOF_FRAMEWORK_COUNT LENGTH "${DOOF_BUILD_MANIFEST_RAW}" frameworks)
    if(DOOF_FRAMEWORK_COUNT GREATER 0)
        math(EXPR DOOF_FRAMEWORK_LAST_INDEX "${DOOF_FRAMEWORK_COUNT} - 1")
        foreach(DOOF_FRAMEWORK_INDEX RANGE ${DOOF_FRAMEWORK_LAST_INDEX})
            string(JSON DOOF_FRAMEWORK_NAME GET "${DOOF_BUILD_MANIFEST_RAW}" frameworks ${DOOF_FRAMEWORK_INDEX})
            target_link_libraries(${target_name} PRIVATE "-framework ${DOOF_FRAMEWORK_NAME}")
        endforeach()
    endif()

    string(JSON DOOF_RESOURCE_COUNT LENGTH "${DOOF_BUILD_MANIFEST_RAW}" buildTarget config resources)
    if(DOOF_RESOURCE_COUNT GREATER 0)
        math(EXPR DOOF_RESOURCE_LAST_INDEX "${DOOF_RESOURCE_COUNT} - 1")
        foreach(DOOF_RESOURCE_INDEX RANGE ${DOOF_RESOURCE_LAST_INDEX})
            string(JSON DOOF_RESOURCE_PATTERN GET "${DOOF_BUILD_MANIFEST_RAW}" buildTarget config resources ${DOOF_RESOURCE_INDEX} fromPattern)
            string(JSON DOOF_RESOURCE_DESTINATION GET "${DOOF_BUILD_MANIFEST_RAW}" buildTarget config resources ${DOOF_RESOURCE_INDEX} destination)

            set(DOOF_RESOURCE_VAR "DOOF_MACOS_RESOURCE_${DOOF_RESOURCE_INDEX}")
            file(GLOB ${DOOF_RESOURCE_VAR} CONFIGURE_DEPENDS "${DOOF_RESOURCE_PATTERN}")
            if(NOT ${DOOF_RESOURCE_VAR})
                message(FATAL_ERROR "No files matched generated macOS resource pattern: ${DOOF_RESOURCE_PATTERN}")
            endif()

            set(DOOF_RESOURCE_LOCATION "Resources")
            if(NOT DOOF_RESOURCE_DESTINATION STREQUAL "")
                set(DOOF_RESOURCE_LOCATION "Resources/${DOOF_RESOURCE_DESTINATION}")
            endif()

            target_sources(${target_name} PRIVATE ${${DOOF_RESOURCE_VAR}})
            set_source_files_properties(${${DOOF_RESOURCE_VAR}} PROPERTIES MACOSX_PACKAGE_LOCATION "${DOOF_RESOURCE_LOCATION}")
        endforeach()
    endif()
endfunction()