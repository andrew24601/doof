#pragma once

#ifdef __OBJC__
#import <Metal/Metal.h>
#endif

// Loads an image file into a Metal RGBA8 texture using ImageIO.
// If commandQueue is provided, mipmaps will be generated for better quality at distance.
// Returns nil on failure.
id<MTLTexture> loadTexture(id<MTLDevice> device, const char* path, id<MTLCommandQueue> commandQueue = nil);

// Creates a 1x1 solid color texture.
id<MTLTexture> createSolidColorTexture(id<MTLDevice> device, uint8_t r, uint8_t g, uint8_t b, uint8_t a);
