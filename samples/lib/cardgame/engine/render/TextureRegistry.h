#pragma once

#ifdef __OBJC__
#import <Metal/Metal.h>

#include <string>
#include <unordered_map>
#include <vector>

// TextureRegistry manages multiple Metal textures, each identified by an integer ID.
// This allows cards to reference different texture images.
class TextureRegistry {
public:
    TextureRegistry(id<MTLDevice> device, id<MTLCommandQueue> commandQueue = nil);
    ~TextureRegistry();
    
    // Load a texture from file path. Returns the assigned texture ID, or -1 on failure.
    int loadTexture(const std::string& path);
    
    // Load a texture and assign it a specific ID. Returns true on success.
    // If a texture already exists at this ID, it will be replaced.
    bool loadTextureWithId(int textureId, const std::string& path);
    
    // Create and register a solid color texture. Returns the assigned texture ID.
    int createSolidColor(uint8_t r, uint8_t g, uint8_t b, uint8_t a);
    
    // Get a texture by ID. Returns nil if not found.
    id<MTLTexture> getTexture(int textureId) const;
    
    // Get all loaded textures (for rendering).
    const std::vector<id<MTLTexture>>& getAllTextures() const { return m_textures; }
    
    // Get number of loaded textures.
    size_t count() const { return m_textures.size(); }
    
    // Check if a texture ID is valid.
    bool hasTexture(int textureId) const;

private:
    id<MTLDevice> m_device;
    id<MTLCommandQueue> m_commandQueue;  // For mipmap generation
    std::vector<id<MTLTexture>> m_textures;
    std::unordered_map<std::string, int> m_pathToId;
    int m_nextId = 0;
};

#endif // __OBJC__
