#import "TextureRegistry.h"
#import "TextureLoader.h"

#include <cstdio>

TextureRegistry::TextureRegistry(id<MTLDevice> device, id<MTLCommandQueue> commandQueue)
    : m_device(device)
    , m_commandQueue(commandQueue)
    , m_nextId(0)
{
}

TextureRegistry::~TextureRegistry() {
    for (id<MTLTexture> texture : m_textures) {
        [texture release];
    }
}

int TextureRegistry::loadTexture(const std::string& path) {
    // Check if already loaded
    auto it = m_pathToId.find(path);
    if (it != m_pathToId.end()) {
        return it->second;
    }
    
    id<MTLTexture> texture = ::loadTexture(m_device, path.c_str(), m_commandQueue);
    if (!texture) {
        std::fprintf(stderr, "TextureRegistry: Failed to load texture '%s'\n", path.c_str());
        return -1;
    }
    
    int id = m_nextId++;
    
    // Ensure vector is large enough
    if (id >= (int)m_textures.size()) {
        m_textures.resize(id + 1, nil);
    }
    
    m_textures[id] = texture;
    m_pathToId[path] = id;
    
    return id;
}

bool TextureRegistry::loadTextureWithId(int textureId, const std::string& path) {
    if (textureId < 0) {
        return false;
    }
    
    id<MTLTexture> texture = ::loadTexture(m_device, path.c_str(), m_commandQueue);
    if (!texture) {
        std::fprintf(stderr, "TextureRegistry: Failed to load texture '%s'\n", path.c_str());
        return false;
    }
    
    // Ensure vector is large enough
    if (textureId >= (int)m_textures.size()) {
        m_textures.resize(textureId + 1, nil);
    }
    
    [m_textures[textureId] release];
    m_textures[textureId] = texture;
    m_pathToId[path] = textureId;
    
    if (textureId >= m_nextId) {
        m_nextId = textureId + 1;
    }
    
    return true;
}

int TextureRegistry::createSolidColor(uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    id<MTLTexture> texture = ::createSolidColorTexture(m_device, r, g, b, a);
    if (!texture) {
        return -1;
    }
    
    int id = m_nextId++;
    
    // Ensure vector is large enough
    if (id >= (int)m_textures.size()) {
        m_textures.resize(id + 1, nil);
    }
    
    m_textures[id] = texture;
    return id;
}

id<MTLTexture> TextureRegistry::getTexture(int textureId) const {
    if (textureId < 0 || textureId >= (int)m_textures.size()) {
        return nil;
    }
    return m_textures[textureId];
}

bool TextureRegistry::hasTexture(int textureId) const {
    if (textureId < 0 || textureId >= (int)m_textures.size()) {
        return false;
    }
    return m_textures[textureId] != nil;
}
