set(ENGINE_SOURCES
    render/MetalRenderer.mm
    render/TextureLoader.mm
    render/TextureRegistry.mm
    math/MathUtil.cpp
)

set(ENGINE_HEADERS
    render/MetalRenderer.h
    render/TextureLoader.h
    render/TextureRegistry.h
    render/Vertex.h
    math/MathUtil.h
)

add_library(BoardGameEngine STATIC ${ENGINE_SOURCES} ${ENGINE_HEADERS})

target_include_directories(BoardGameEngine PUBLIC ${CMAKE_CURRENT_LIST_DIR}/..)

target_link_libraries(BoardGameEngine PUBLIC
    "-framework Metal"
    "-framework QuartzCore"
    "-framework Foundation"
    "-framework ImageIO"
)
