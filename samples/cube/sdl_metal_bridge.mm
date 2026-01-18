// SDL3/Metal Bridge Implementation
// Flexible rendering API with custom vertex formats

#include "sdl_metal_bridge.h"

#include <SDL3/SDL.h>
#include <cmath>
#include <cstring>

#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>

namespace sdl_metal {

// ==================== Mat4 Implementation ====================

Mat4::Mat4() {
    std::memset(m, 0, sizeof(m));
}

Mat4 Mat4::identity() {
    Mat4 result;
    result.m[0] = 1.0f;
    result.m[5] = 1.0f;
    result.m[10] = 1.0f;
    result.m[15] = 1.0f;
    return result;
}

Mat4 Mat4::perspective(float fovY, float aspect, float nearZ, float farZ) {
    Mat4 result;
    float tanHalfFov = std::tan(fovY / 2.0f);
    
    result.m[0] = 1.0f / (aspect * tanHalfFov);
    result.m[5] = 1.0f / tanHalfFov;
    result.m[10] = -(farZ + nearZ) / (farZ - nearZ);
    result.m[11] = -1.0f;
    result.m[14] = -(2.0f * farZ * nearZ) / (farZ - nearZ);
    
    return result;
}

Mat4 Mat4::lookAt(const Vec3& eye, const Vec3& center, const Vec3& up) {
    Vec3 f = (center - eye).normalized();
    Vec3 s = Vec3::cross(f, up).normalized();
    Vec3 u = Vec3::cross(s, f);
    
    Mat4 result = identity();
    result.m[0] = s.x;
    result.m[4] = s.y;
    result.m[8] = s.z;
    result.m[1] = u.x;
    result.m[5] = u.y;
    result.m[9] = u.z;
    result.m[2] = -f.x;
    result.m[6] = -f.y;
    result.m[10] = -f.z;
    result.m[12] = -s.dot(eye);
    result.m[13] = -u.dot(eye);
    result.m[14] = f.dot(eye);
    
    return result;
}

Mat4 Mat4::rotationX(float angle) {
    Mat4 result = identity();
    float c = std::cos(angle);
    float s = std::sin(angle);
    result.m[5] = c;
    result.m[6] = s;
    result.m[9] = -s;
    result.m[10] = c;
    return result;
}

Mat4 Mat4::rotationY(float angle) {
    Mat4 result = identity();
    float c = std::cos(angle);
    float s = std::sin(angle);
    result.m[0] = c;
    result.m[2] = -s;
    result.m[8] = s;
    result.m[10] = c;
    return result;
}

Mat4 Mat4::rotationZ(float angle) {
    Mat4 result = identity();
    float c = std::cos(angle);
    float s = std::sin(angle);
    result.m[0] = c;
    result.m[1] = s;
    result.m[4] = -s;
    result.m[5] = c;
    return result;
}

Mat4 Mat4::translation(float x, float y, float z) {
    Mat4 result = identity();
    result.m[12] = x;
    result.m[13] = y;
    result.m[14] = z;
    return result;
}

Mat4 Mat4::scale(float x, float y, float z) {
    Mat4 result = identity();
    result.m[0] = x;
    result.m[5] = y;
    result.m[10] = z;
    return result;
}

Mat4 Mat4::operator*(const Mat4& o) const {
    Mat4 result;
    for (int col = 0; col < 4; ++col) {
        for (int row = 0; row < 4; ++row) {
            float sum = 0.0f;
            for (int k = 0; k < 4; ++k) {
                sum += m[k * 4 + row] * o.m[col * 4 + k];
            }
            result.m[col * 4 + row] = sum;
        }
    }
    return result;
}

// ==================== Buffer Implementation ====================

VertexBuffer::~VertexBuffer() {
    if (buffer) {
        CFRelease(buffer);
        buffer = nullptr;
    }
    data = nullptr;
}

VertexBuffer::VertexBuffer(VertexBuffer&& other) noexcept
    : buffer(other.buffer), data(other.data), byteSize(other.byteSize) {
    other.buffer = nullptr;
    other.data = nullptr;
    other.byteSize = 0;
}

VertexBuffer& VertexBuffer::operator=(VertexBuffer&& other) noexcept {
    if (this != &other) {
        if (buffer) CFRelease(buffer);
        buffer = other.buffer;
        data = other.data;
        byteSize = other.byteSize;
        other.buffer = nullptr;
        other.data = nullptr;
        other.byteSize = 0;
    }
    return *this;
}

VertexBuffer VertexBuffer::create(uint32_t size) {
    VertexBuffer vb;
    vb.byteSize = size;
    
    // Create Metal buffer with shared storage mode for CPU/GPU access
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    id<MTLBuffer> mtlBuffer = [device newBufferWithLength:size options:MTLResourceStorageModeShared];
    
    vb.buffer = (__bridge_retained void*)mtlBuffer;
    vb.data = static_cast<uint8_t*>([mtlBuffer contents]);
    
    return vb;
}

void VertexBuffer::setFloat(uint32_t offset, float value) {
    if (offset + sizeof(float) <= byteSize && data) {
        *reinterpret_cast<float*>(data + offset) = value;
    }
}

void VertexBuffer::setVec3(uint32_t offset, const Vec3& value) {
    if (offset + sizeof(Vec3) <= byteSize && data) {
        std::memcpy(data + offset, &value, sizeof(Vec3));
    }
}

void VertexBuffer::setVec4(uint32_t offset, const Vec4& value) {
    if (offset + sizeof(Vec4) <= byteSize && data) {
        std::memcpy(data + offset, &value, sizeof(Vec4));
    }
}

void VertexBuffer::setFloatArray(uint32_t offset, const float* values, uint32_t count) {
    uint32_t size = count * sizeof(float);
    if (offset + size <= byteSize && data) {
        std::memcpy(data + offset, values, size);
    }
}

void VertexBuffer::setVec3Array(uint32_t offset, const Vec3* values, uint32_t count) {
    uint32_t size = count * sizeof(Vec3);
    if (offset + size <= byteSize && data) {
        std::memcpy(data + offset, values, size);
    }
}

void VertexBuffer::setVec4Array(uint32_t offset, const Vec4* values, uint32_t count) {
    uint32_t size = count * sizeof(Vec4);
    if (offset + size <= byteSize && data) {
        std::memcpy(data + offset, values, size);
    }
}

IndexBuffer::~IndexBuffer() {
    if (buffer) {
        CFRelease(buffer);
        buffer = nullptr;
    }
    data = nullptr;
}

IndexBuffer::IndexBuffer(IndexBuffer&& other) noexcept
    : buffer(other.buffer), data(other.data), indexCount(other.indexCount) {
    other.buffer = nullptr;
    other.data = nullptr;
    other.indexCount = 0;
}

IndexBuffer& IndexBuffer::operator=(IndexBuffer&& other) noexcept {
    if (this != &other) {
        if (buffer) CFRelease(buffer);
        buffer = other.buffer;
        data = other.data;
        indexCount = other.indexCount;
        other.buffer = nullptr;
        other.data = nullptr;
        other.indexCount = 0;
    }
    return *this;
}

IndexBuffer IndexBuffer::create(uint32_t count) {
    IndexBuffer ib;
    ib.indexCount = count;
    
    uint32_t size = count * sizeof(uint32_t);
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    id<MTLBuffer> mtlBuffer = [device newBufferWithLength:size options:MTLResourceStorageModeShared];
    
    ib.buffer = (__bridge_retained void*)mtlBuffer;
    ib.data = static_cast<uint32_t*>([mtlBuffer contents]);
    
    return ib;
}

void IndexBuffer::setIndex(uint32_t index, uint32_t value) {
    if (index < indexCount && data) {
        data[index] = value;
    }
}

void IndexBuffer::setIndices(uint32_t startIndex, const uint32_t* values, uint32_t count) {
    if (startIndex + count <= indexCount && data) {
        std::memcpy(data + startIndex, values, count * sizeof(uint32_t));
    }
}

void IndexBuffer::setIndices(uint32_t startIndex, const std::vector<uint32_t>& values) {
    setIndices(startIndex, values.data(), static_cast<uint32_t>(values.size()));
}

// ==================== Metal Renderer Implementation ====================

struct Uniforms {
    Mat4 modelViewProjection;
};

struct MetalRenderer::Impl {
    id<MTLDevice> device = nil;
    id<MTLCommandQueue> commandQueue = nil;
    id<MTLRenderPipelineState> pipelineState = nil;
    id<MTLDepthStencilState> depthStencilState = nil;
    id<MTLBuffer> uniformBuffer = nil;
    id<MTLTexture> depthTexture = nil;
    id<MTLLibrary> shaderLibrary = nil;
    CAMetalLayer* metalLayer = nil;
    
    id<CAMetalDrawable> currentDrawable = nil;
    id<MTLCommandBuffer> currentCommandBuffer = nil;
    id<MTLRenderCommandEncoder> currentEncoder = nil;
    
    // Currently bound buffers
    id<MTLBuffer> boundVertexBuffer = nil;
    id<MTLBuffer> boundIndexBuffer = nil;
    
    Mat4 projectionMatrix;
    Mat4 viewMatrix;
    Mat4 modelMatrix;
    
    PipelineConfig currentConfig;
    
    void createDepthTexture(int width, int height) {
        MTLTextureDescriptor* desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatDepth32Float
                                                                                       width:width
                                                                                      height:height
                                                                                   mipmapped:NO];
        desc.usage = MTLTextureUsageRenderTarget;
        desc.storageMode = MTLStorageModePrivate;
        depthTexture = [device newTextureWithDescriptor:desc];
    }
    
    bool loadShaderLibrary() {
        NSError* error = nil;
        NSString* shaderPath = [[NSBundle mainBundle] pathForResource:@"shaders" ofType:@"metallib"];
        
        if (shaderPath) {
            shaderLibrary = [device newLibraryWithFile:shaderPath error:&error];
        }
        
        // Try loading from current directory
        if (!shaderLibrary) {
            NSString* currentPath = [[NSFileManager defaultManager] currentDirectoryPath];
            NSString* localShaderPath = [currentPath stringByAppendingPathComponent:@"shaders.metallib"];
            shaderLibrary = [device newLibraryWithFile:localShaderPath error:&error];
        }
        
        // Compile from source as last resort
        if (!shaderLibrary) {
            NSString* currentPath = [[NSFileManager defaultManager] currentDirectoryPath];
            NSString* sourcePath = [currentPath stringByAppendingPathComponent:@"shaders.metal"];
            NSString* shaderSource = [NSString stringWithContentsOfFile:sourcePath encoding:NSUTF8StringEncoding error:&error];
            
            if (!shaderSource) {
                SDL_Log("Failed to load shader source: %s", [[error localizedDescription] UTF8String]);
                return false;
            }
            
            MTLCompileOptions* options = [[MTLCompileOptions alloc] init];
            shaderLibrary = [device newLibraryWithSource:shaderSource options:options error:&error];
        }
        
        if (!shaderLibrary) {
            SDL_Log("Failed to create shader library: %s", [[error localizedDescription] UTF8String]);
            return false;
        }
        
        return true;
    }
    
    bool createPipeline(const PipelineConfig& config) {
        NSError* error = nil;
        
        id<MTLFunction> vertexFunction = [shaderLibrary newFunctionWithName:@"vertexShader"];
        id<MTLFunction> fragmentFunction = [shaderLibrary newFunctionWithName:@"fragmentShader"];
        
        if (!vertexFunction || !fragmentFunction) {
            SDL_Log("Failed to find shader functions");
            return false;
        }
        
        MTLRenderPipelineDescriptor* pipelineDesc = [[MTLRenderPipelineDescriptor alloc] init];
        pipelineDesc.vertexFunction = vertexFunction;
        pipelineDesc.fragmentFunction = fragmentFunction;
        pipelineDesc.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm;
        pipelineDesc.depthAttachmentPixelFormat = MTLPixelFormatDepth32Float;
        
        // Simple fixed vertex descriptor for position+normal+color
        MTLVertexDescriptor* vertexDesc = [[MTLVertexDescriptor alloc] init];
        vertexDesc.attributes[0].format = MTLVertexFormatFloat3;  // position
        vertexDesc.attributes[0].offset = 0;
        vertexDesc.attributes[0].bufferIndex = 0;
        vertexDesc.attributes[1].format = MTLVertexFormatFloat3;  // normal
        vertexDesc.attributes[1].offset = 12;
        vertexDesc.attributes[1].bufferIndex = 0;
        vertexDesc.attributes[2].format = MTLVertexFormatFloat4;  // color
        vertexDesc.attributes[2].offset = 24;
        vertexDesc.attributes[2].bufferIndex = 0;
        vertexDesc.layouts[0].stride = config.vertexFormat.stride;
        vertexDesc.layouts[0].stepFunction = MTLVertexStepFunctionPerVertex;
        
        pipelineDesc.vertexDescriptor = vertexDesc;
        
        pipelineState = [device newRenderPipelineStateWithDescriptor:pipelineDesc error:&error];
        if (!pipelineState) {
            SDL_Log("Failed to create pipeline state: %s", [[error localizedDescription] UTF8String]);
            return false;
        }
        
        // Create depth stencil state
        MTLDepthStencilDescriptor* depthDesc = [[MTLDepthStencilDescriptor alloc] init];
        depthDesc.depthCompareFunction = config.depthTestEnabled ? MTLCompareFunctionLess : MTLCompareFunctionAlways;
        depthDesc.depthWriteEnabled = config.depthWriteEnabled;
        depthStencilState = [device newDepthStencilStateWithDescriptor:depthDesc];
        
        currentConfig = config;
        return true;
    }
};

MetalRenderer::MetalRenderer() : pImpl(std::make_unique<Impl>()) {
    pImpl->projectionMatrix = Mat4::identity();
    pImpl->viewMatrix = Mat4::identity();
    pImpl->modelMatrix = Mat4::identity();
}

MetalRenderer::~MetalRenderer() {
    shutdown();
}

bool MetalRenderer::initialize(SDL_Window* window) {
    SDL_GetWindowSize(window, &windowWidth, &windowHeight);
    
    pImpl->metalLayer = (__bridge CAMetalLayer*)SDL_Metal_GetLayer(SDL_Metal_CreateView(window));
    if (!pImpl->metalLayer) {
        SDL_Log("Failed to get Metal layer");
        return false;
    }
    
    pImpl->device = MTLCreateSystemDefaultDevice();
    if (!pImpl->device) {
        SDL_Log("Failed to create Metal device");
        return false;
    }
    
    pImpl->metalLayer.device = pImpl->device;
    pImpl->metalLayer.pixelFormat = MTLPixelFormatBGRA8Unorm;
    pImpl->metalLayer.framebufferOnly = YES;
    
    pImpl->commandQueue = [pImpl->device newCommandQueue];
    if (!pImpl->commandQueue) {
        SDL_Log("Failed to create command queue");
        return false;
    }
    
    if (!pImpl->loadShaderLibrary()) {
        return false;
    }
    
    // Create uniform buffer
    pImpl->uniformBuffer = [pImpl->device newBufferWithLength:sizeof(Uniforms) options:MTLResourceStorageModeShared];
    
    // Create depth texture
    pImpl->createDepthTexture(windowWidth, windowHeight);
    
    // Initialize with default vertex format (position + normal + color)
    PipelineConfig defaultConfig;
    defaultConfig.vertexFormat = VertexFormat::positionNormalColor();
    currentFormat = defaultConfig.vertexFormat;
    
    return pImpl->createPipeline(defaultConfig);
}

bool MetalRenderer::configurePipeline(const PipelineConfig& config) {
    currentFormat = config.vertexFormat;
    return pImpl->createPipeline(config);
}

void MetalRenderer::shutdown() {
    pImpl->pipelineState = nil;
    pImpl->shaderLibrary = nil;
    pImpl->commandQueue = nil;
    pImpl->device = nil;
}

void MetalRenderer::beginFrame() {
    @autoreleasepool {
        pImpl->currentDrawable = [pImpl->metalLayer nextDrawable];
        if (!pImpl->currentDrawable) {
            return;
        }
        
        pImpl->currentCommandBuffer = [pImpl->commandQueue commandBuffer];
        
        MTLRenderPassDescriptor* passDesc = [[MTLRenderPassDescriptor alloc] init];
        passDesc.colorAttachments[0].texture = pImpl->currentDrawable.texture;
        passDesc.colorAttachments[0].loadAction = MTLLoadActionClear;
        passDesc.colorAttachments[0].storeAction = MTLStoreActionStore;
        passDesc.colorAttachments[0].clearColor = MTLClearColorMake(0.1, 0.1, 0.15, 1.0);
        
        passDesc.depthAttachment.texture = pImpl->depthTexture;
        passDesc.depthAttachment.loadAction = MTLLoadActionClear;
        passDesc.depthAttachment.storeAction = MTLStoreActionDontCare;
        passDesc.depthAttachment.clearDepth = 1.0;
        
        pImpl->currentEncoder = [pImpl->currentCommandBuffer renderCommandEncoderWithDescriptor:passDesc];
        [pImpl->currentEncoder setRenderPipelineState:pImpl->pipelineState];
        [pImpl->currentEncoder setDepthStencilState:pImpl->depthStencilState];
        
        // Set cull mode based on config
        MTLCullMode cullMode = MTLCullModeNone;
        if (pImpl->currentConfig.cullMode == CullMode::Front) cullMode = MTLCullModeFront;
        else if (pImpl->currentConfig.cullMode == CullMode::Back) cullMode = MTLCullModeBack;
        [pImpl->currentEncoder setCullMode:cullMode];
        
        MTLWinding winding = (pImpl->currentConfig.windingOrder == WindingOrder::CounterClockwise) 
            ? MTLWindingCounterClockwise : MTLWindingClockwise;
        [pImpl->currentEncoder setFrontFacingWinding:winding];
    }
}

void MetalRenderer::endFrame() {
    @autoreleasepool {
        if (pImpl->currentEncoder) {
            [pImpl->currentEncoder endEncoding];
            pImpl->currentEncoder = nil;
        }
        
        if (pImpl->currentDrawable && pImpl->currentCommandBuffer) {
            [pImpl->currentCommandBuffer presentDrawable:pImpl->currentDrawable];
            [pImpl->currentCommandBuffer commit];
        }
        
        pImpl->currentDrawable = nil;
        pImpl->currentCommandBuffer = nil;
        pImpl->boundVertexBuffer = nil;
        pImpl->boundIndexBuffer = nil;
    }
}

void MetalRenderer::setProjectionMatrix(const Mat4& proj) {
    pImpl->projectionMatrix = proj;
}

void MetalRenderer::setViewMatrix(const Mat4& view) {
    pImpl->viewMatrix = view;
}

void MetalRenderer::setModelMatrix(const Mat4& model) {
    pImpl->modelMatrix = model;
}

void MetalRenderer::bindVertexBuffer(const VertexBuffer& buffer, uint32_t stride) {
    pImpl->boundVertexBuffer = (__bridge id<MTLBuffer>)buffer.buffer;
    pImpl->currentConfig.vertexFormat.stride = stride;
}

void MetalRenderer::bindIndexBuffer(const IndexBuffer& buffer) {
    pImpl->boundIndexBuffer = (__bridge id<MTLBuffer>)buffer.buffer;
}

void MetalRenderer::drawIndexed(uint32_t indexCount, uint32_t startIndex) {
    if (!pImpl->currentEncoder || !pImpl->boundVertexBuffer || !pImpl->boundIndexBuffer) {
        return;
    }
    
    // Update uniforms
    Uniforms uniforms;
    uniforms.modelViewProjection = pImpl->projectionMatrix * pImpl->viewMatrix * pImpl->modelMatrix;
    std::memcpy([pImpl->uniformBuffer contents], &uniforms, sizeof(Uniforms));
    
    [pImpl->currentEncoder setVertexBuffer:pImpl->boundVertexBuffer offset:0 atIndex:0];
    [pImpl->currentEncoder setVertexBuffer:pImpl->uniformBuffer offset:0 atIndex:1];
    
    [pImpl->currentEncoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle
                                     indexCount:indexCount
                                      indexType:MTLIndexTypeUInt32
                                    indexBuffer:pImpl->boundIndexBuffer
                              indexBufferOffset:startIndex * sizeof(uint32_t)];
}

void MetalRenderer::draw(uint32_t vertexCount, uint32_t startVertex) {
    if (!pImpl->currentEncoder || !pImpl->boundVertexBuffer) {
        return;
    }
    
    // Update uniforms
    Uniforms uniforms;
    uniforms.modelViewProjection = pImpl->projectionMatrix * pImpl->viewMatrix * pImpl->modelMatrix;
    std::memcpy([pImpl->uniformBuffer contents], &uniforms, sizeof(Uniforms));
    
    [pImpl->currentEncoder setVertexBuffer:pImpl->boundVertexBuffer offset:0 atIndex:0];
    [pImpl->currentEncoder setVertexBuffer:pImpl->uniformBuffer offset:0 atIndex:1];
    
    [pImpl->currentEncoder drawPrimitives:MTLPrimitiveTypeTriangle
                              vertexStart:startVertex
                              vertexCount:vertexCount];
}

// ==================== Application Implementation ====================

Application::Application() : renderer(std::make_unique<MetalRenderer>()) {}

Application::~Application() {
    shutdown();
}

bool Application::initialize(int width, int height, const std::string& title) {
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS) < 0) {
        SDL_Log("Failed to initialize SDL: %s", SDL_GetError());
        return false;
    }
    
    window = SDL_CreateWindow(title.c_str(),
                              width, height,
                              SDL_WINDOW_METAL | SDL_WINDOW_RESIZABLE);
    
    if (!window) {
        SDL_Log("Failed to create window: %s", SDL_GetError());
        return false;
    }
    
    if (!renderer->initialize(window)) {
        SDL_Log("Failed to initialize Metal renderer");
        return false;
    }
    
    lastFrameTime = SDL_GetPerformanceCounter();
    
    return true;
}

void Application::shutdown() {
    renderer->shutdown();
    
    if (window) {
        SDL_DestroyWindow(window);
        window = nullptr;
    }
    
    SDL_Quit();
}

bool Application::pollEvents() {
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        switch (event.type) {
            case SDL_EVENT_QUIT:
                return false;
            case SDL_EVENT_KEY_DOWN:
                if (event.key.key == SDLK_ESCAPE) {
                    return false;
                }
                break;
        }
    }
    
    // Calculate delta time
    uint64_t currentTime = SDL_GetPerformanceCounter();
    deltaTime = static_cast<float>(currentTime - lastFrameTime) / static_cast<float>(SDL_GetPerformanceFrequency());
    lastFrameTime = currentTime;
    
    return true;
}

float Application::getDeltaTime() {
    return deltaTime;
}

bool Application::isKeyPressed(int keyCode) const {
    const bool* keyState = SDL_GetKeyboardState(nullptr);
    SDL_Scancode scancode = SDL_GetScancodeFromKey(static_cast<SDL_Keycode>(keyCode), nullptr);
    return keyState[scancode];
}

} // namespace sdl_metal
