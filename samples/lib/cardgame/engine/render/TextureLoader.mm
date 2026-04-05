#include "TextureLoader.h"

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>

namespace {

std::string resolveTexturePath(const char* path) {
    std::filesystem::path resolved(path);
    if (resolved.is_relative()) {
        resolved = std::filesystem::current_path() / resolved;
    }
    return resolved.lexically_normal().string();
}

} // anonymous namespace

id<MTLTexture> loadTexture(id<MTLDevice> device, const char* path, id<MTLCommandQueue> commandQueue) {
    @autoreleasepool {
        const std::string resolvedPath = resolveTexturePath(path);
        NSString* nsPath = [NSString stringWithUTF8String:resolvedPath.c_str()];
        NSURL* url = [NSURL fileURLWithPath:nsPath];

        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, nil);
        if (!source) {
            std::fprintf(stderr, "Failed to load image: %s\n", resolvedPath.c_str());
            return nil;
        }

        CGImageRef cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil);
        CFRelease(source);

        if (!cgImage) {
            std::fprintf(stderr, "Failed to create CGImage from: %s\n", resolvedPath.c_str());
            return nil;
        }

        size_t width = CGImageGetWidth(cgImage);
        size_t height = CGImageGetHeight(cgImage);

        std::printf("Loaded image: %s (%zux%zu)\n", resolvedPath.c_str(), width, height);

        bool useMipmaps = (commandQueue != nil);

        MTLTextureDescriptor* texDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                                                           width:width
                                                                                          height:height
                                                                                       mipmapped:useMipmaps];
        texDesc.usage = MTLTextureUsageShaderRead;
        if (useMipmaps) {
            texDesc.usage |= MTLTextureUsageRenderTarget;
        }

        id<MTLTexture> texture = [device newTextureWithDescriptor:texDesc];

        CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
        uint8_t* rawData = (uint8_t*)calloc(width * height * 4, sizeof(uint8_t));

        CGContextRef context = CGBitmapContextCreate(rawData, width, height, 8, width * 4,
                                                      colorSpace, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
        CGColorSpaceRelease(colorSpace);

        CGContextDrawImage(context, CGRectMake(0, 0, width, height), cgImage);
        CGContextRelease(context);
        CGImageRelease(cgImage);

        MTLRegion region = MTLRegionMake2D(0, 0, width, height);
        [texture replaceRegion:region mipmapLevel:0 withBytes:rawData bytesPerRow:width * 4];

        free(rawData);

        if (useMipmaps) {
            id<MTLCommandBuffer> cmdBuffer = [commandQueue commandBuffer];
            id<MTLBlitCommandEncoder> blitEncoder = [cmdBuffer blitCommandEncoder];
            [blitEncoder generateMipmapsForTexture:texture];
            [blitEncoder endEncoding];
            [cmdBuffer commit];
            [cmdBuffer waitUntilCompleted];
        }

        return texture;
    }
}

id<MTLTexture> createSolidColorTexture(id<MTLDevice> device, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    MTLTextureDescriptor* texDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                                                       width:1
                                                                                      height:1
                                                                                   mipmapped:NO];
    texDesc.usage = MTLTextureUsageShaderRead;

    id<MTLTexture> texture = [device newTextureWithDescriptor:texDesc];

    uint8_t pixel[4] = { r, g, b, a };
    MTLRegion region = MTLRegionMake2D(0, 0, 1, 1);
    [texture replaceRegion:region mipmapLevel:0 withBytes:pixel bytesPerRow:4];

    return texture;
}
