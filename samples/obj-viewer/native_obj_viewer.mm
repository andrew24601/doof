#include "native_obj_viewer.hpp"

#if defined(__APPLE__)

#include <SDL3/SDL_metal.h>

#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>

#include <algorithm>
#include <array>
#include <simd/simd.h>
#include <utility>
#include <vector>

namespace doof_obj_viewer {
namespace {

constexpr float kNearPlane = 0.2f;
constexpr float kFarPlane = 64.0f;

static NSString* const kShaderSource = @R"(
#include <metal_stdlib>
using namespace metal;

struct VertexIn {
    float4 position [[attribute(0)]];
    float4 color [[attribute(1)]];
};

struct VertexOut {
    float4 position [[position]];
    float4 color;
};

vertex VertexOut vertexMain(VertexIn in [[stage_in]]) {
    VertexOut out;
    out.position = in.position;
    out.color = in.color;
    return out;
}

fragment float4 fragmentMain(VertexOut in [[stage_in]]) {
    return in.color;
}
)";

struct ViewerVertex {
    simd_float4 position;
    simd_float4 color;
};

simd_float4 makeColor(int32_t r, int32_t g, int32_t b) {
    return simd_make_float4(
        static_cast<float>(r) / 255.0f,
        static_cast<float>(g) / 255.0f,
        static_cast<float>(b) / 255.0f,
        1.0f
    );
}

float clampDepth(float depth) {
    const float normalized = (depth - kNearPlane) / (kFarPlane - kNearPlane);
    return std::clamp(normalized, 0.0f, 1.0f);
}

simd_float4 makeClipPosition(float x, float y, float depth, int32_t pixelWidth, int32_t pixelHeight) {
    const float safeWidth = static_cast<float>(std::max(pixelWidth, 1));
    const float safeHeight = static_cast<float>(std::max(pixelHeight, 1));
    const float ndcX = (x / safeWidth) * 2.0f - 1.0f;
    const float ndcY = 1.0f - (y / safeHeight) * 2.0f;
    return simd_make_float4(ndcX, ndcY, clampDepth(depth), 1.0f);
}

bool initPipeline(id<MTLDevice> device, CAMetalLayer* layer, id<MTLRenderPipelineState>* pipelineState) {
    NSError* error = nil;
    id<MTLLibrary> library = [device newLibraryWithSource:kShaderSource options:nil error:&error];
    if (!library) {
        return false;
    }

    id<MTLFunction> vertexFunction = [library newFunctionWithName:@"vertexMain"];
    id<MTLFunction> fragmentFunction = [library newFunctionWithName:@"fragmentMain"];

    MTLVertexDescriptor* vertexDescriptor = [[MTLVertexDescriptor alloc] init];
    vertexDescriptor.attributes[0].format = MTLVertexFormatFloat4;
    vertexDescriptor.attributes[0].offset = offsetof(ViewerVertex, position);
    vertexDescriptor.attributes[0].bufferIndex = 0;
    vertexDescriptor.attributes[1].format = MTLVertexFormatFloat4;
    vertexDescriptor.attributes[1].offset = offsetof(ViewerVertex, color);
    vertexDescriptor.attributes[1].bufferIndex = 0;
    vertexDescriptor.layouts[0].stride = sizeof(ViewerVertex);
    vertexDescriptor.layouts[0].stepFunction = MTLVertexStepFunctionPerVertex;

    MTLRenderPipelineDescriptor* pipelineDescriptor = [[MTLRenderPipelineDescriptor alloc] init];
    pipelineDescriptor.vertexFunction = vertexFunction;
    pipelineDescriptor.fragmentFunction = fragmentFunction;
    pipelineDescriptor.vertexDescriptor = vertexDescriptor;
    pipelineDescriptor.colorAttachments[0].pixelFormat = layer.pixelFormat;
    pipelineDescriptor.depthAttachmentPixelFormat = MTLPixelFormatDepth32Float;

    *pipelineState = [device newRenderPipelineStateWithDescriptor:pipelineDescriptor error:&error];

    [pipelineDescriptor release];
    [vertexDescriptor release];
    [fragmentFunction release];
    [vertexFunction release];
    [library release];

    return *pipelineState != nil;
}

id<MTLDepthStencilState> makeDepthState(id<MTLDevice> device, MTLCompareFunction compareFunction, bool writeDepth) {
    MTLDepthStencilDescriptor* descriptor = [[MTLDepthStencilDescriptor alloc] init];
    descriptor.depthCompareFunction = compareFunction;
    descriptor.depthWriteEnabled = writeDepth ? YES : NO;
    id<MTLDepthStencilState> state = [device newDepthStencilStateWithDescriptor:descriptor];
    [descriptor release];
    return state;
}

} // namespace

struct NativeLineViewer::Impl {
    SDL_Window* window = nullptr;
    SDL_MetalView metalView = nullptr;
    CAMetalLayer* layer = nil;
    id<MTLDevice> device = nil;
    id<MTLCommandQueue> queue = nil;
    id<MTLRenderPipelineState> pipelineState = nil;
    id<MTLDepthStencilState> triangleDepthState = nil;
    id<MTLDepthStencilState> lineDepthState = nil;
    id<MTLDepthStencilState> overlayDepthState = nil;
    id<MTLTexture> depthTexture = nil;
    int32_t depthTextureWidth = 0;
    int32_t depthTextureHeight = 0;
    MTLClearColor clearColor = MTLClearColorMake(11.0 / 255.0, 16.0 / 255.0, 23.0 / 255.0, 1.0);
    std::vector<ViewerVertex> triangleVertices;
    std::vector<ViewerVertex> depthLineVertices;
    std::vector<ViewerVertex> overlayLineVertices;
    bool sdlOwned = false;
    bool open = true;
    bool leftDown = false;
    bool rightDown = false;
    bool resetRequested = false;
    float orbitX = 0.0f;
    float orbitY = 0.0f;
    float panX = 0.0f;
    float panY = 0.0f;
    float zoom = 0.0f;

    ~Impl() {
        [depthTexture release];
        [overlayDepthState release];
        [lineDepthState release];
        [triangleDepthState release];
        [pipelineState release];
        [queue release];
        [device release];
    }
};

NativeLineViewer::NativeLineViewer(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}

NativeLineViewer::~NativeLineViewer() {
    close();
}

doof::Result<std::shared_ptr<NativeLineViewer>, std::string> NativeLineViewer::create(
    const std::string& title,
    int32_t width,
    int32_t height
) {
    if (!SDL_Init(SDL_INIT_VIDEO)) {
        return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure(SDL_GetError());
    }

    auto impl = std::make_unique<Impl>();
    impl->sdlOwned = true;

    impl->window = SDL_CreateWindow(
        title.c_str(),
        width,
        height,
        SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY | SDL_WINDOW_METAL
    );
    if (impl->window == nullptr) {
        const std::string error = SDL_GetError();
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure(error);
    }

    impl->metalView = SDL_Metal_CreateView(impl->window);
    if (impl->metalView == nullptr) {
        const std::string error = SDL_GetError();
        SDL_DestroyWindow(impl->window);
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure(error);
    }

    impl->layer = (__bridge CAMetalLayer*)SDL_Metal_GetLayer(impl->metalView);
    if (impl->layer == nil) {
        const std::string error = SDL_GetError();
        SDL_Metal_DestroyView(impl->metalView);
        SDL_DestroyWindow(impl->window);
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure(error);
    }

    impl->device = MTLCreateSystemDefaultDevice();
    if (impl->device == nil) {
        SDL_Metal_DestroyView(impl->metalView);
        SDL_DestroyWindow(impl->window);
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure("Metal device initialization failed");
    }

    impl->layer.device = impl->device;
    impl->layer.pixelFormat = MTLPixelFormatBGRA8Unorm;
    impl->layer.framebufferOnly = YES;

    impl->queue = [impl->device newCommandQueue];
    if (impl->queue == nil || !initPipeline(impl->device, impl->layer, &impl->pipelineState)) {
        SDL_Metal_DestroyView(impl->metalView);
        SDL_DestroyWindow(impl->window);
        SDL_Quit();
        return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::failure("Metal pipeline initialization failed");
    }

    impl->triangleDepthState = makeDepthState(impl->device, MTLCompareFunctionLess, true);
    impl->lineDepthState = makeDepthState(impl->device, MTLCompareFunctionLessEqual, false);
    impl->overlayDepthState = makeDepthState(impl->device, MTLCompareFunctionAlways, false);

    return doof::Result<std::shared_ptr<NativeLineViewer>, std::string>::success(
        std::shared_ptr<NativeLineViewer>(new NativeLineViewer(std::move(impl)))
    );
}

bool NativeLineViewer::isOpen() const {
    return impl_ != nullptr && impl_->open;
}

void NativeLineViewer::pollEvents() {
    if (impl_ == nullptr || !impl_->open) {
        return;
    }

    impl_->resetRequested = false;

    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        switch (event.type) {
            case SDL_EVENT_QUIT:
            case SDL_EVENT_WINDOW_CLOSE_REQUESTED:
                impl_->open = false;
                break;
            case SDL_EVENT_MOUSE_BUTTON_DOWN:
                if (event.button.button == SDL_BUTTON_LEFT) {
                    impl_->leftDown = true;
                } else if (event.button.button == SDL_BUTTON_RIGHT || event.button.button == SDL_BUTTON_MIDDLE) {
                    impl_->rightDown = true;
                }
                break;
            case SDL_EVENT_MOUSE_BUTTON_UP:
                if (event.button.button == SDL_BUTTON_LEFT) {
                    impl_->leftDown = false;
                } else if (event.button.button == SDL_BUTTON_RIGHT || event.button.button == SDL_BUTTON_MIDDLE) {
                    impl_->rightDown = false;
                }
                break;
            case SDL_EVENT_MOUSE_MOTION:
                if (impl_->leftDown) {
                    impl_->orbitX += event.motion.xrel * 0.010f;
                    impl_->orbitY += event.motion.yrel * 0.010f;
                }
                if (impl_->rightDown) {
                    impl_->panX += event.motion.xrel * 0.0025f;
                    impl_->panY -= event.motion.yrel * 0.0025f;
                }
                break;
            case SDL_EVENT_MOUSE_WHEEL:
                impl_->zoom += static_cast<float>(event.wheel.y);
                break;
            case SDL_EVENT_KEY_DOWN:
                if (event.key.scancode == SDL_SCANCODE_ESCAPE) {
                    impl_->open = false;
                } else if (event.key.scancode == SDL_SCANCODE_R) {
                    impl_->resetRequested = true;
                }
                break;
            default:
                break;
        }
    }
}

int32_t NativeLineViewer::width() const {
    if (impl_ == nullptr || impl_->window == nullptr) {
        return 0;
    }

    int width = 0;
    int height = 0;
    SDL_GetWindowSizeInPixels(impl_->window, &width, &height);
    return width;
}

int32_t NativeLineViewer::height() const {
    if (impl_ == nullptr || impl_->window == nullptr) {
        return 0;
    }

    int width = 0;
    int height = 0;
    SDL_GetWindowSizeInPixels(impl_->window, &width, &height);
    return height;
}

void NativeLineViewer::setTitle(const std::string& title) {
    if (impl_ != nullptr && impl_->window != nullptr) {
        SDL_SetWindowTitle(impl_->window, title.c_str());
    }
}

void NativeLineViewer::clear(int32_t r, int32_t g, int32_t b) {
    if (impl_ == nullptr) {
        return;
    }

    impl_->clearColor = MTLClearColorMake(
        static_cast<double>(r) / 255.0,
        static_cast<double>(g) / 255.0,
        static_cast<double>(b) / 255.0,
        1.0
    );
    impl_->triangleVertices.clear();
    impl_->depthLineVertices.clear();
    impl_->overlayLineVertices.clear();
}

void NativeLineViewer::drawLine(float x0, float y0, float x1, float y1, int32_t r, int32_t g, int32_t b) {
    if (impl_ == nullptr) {
        return;
    }

    const int32_t pixelWidth = width();
    const int32_t pixelHeight = height();
    const simd_float4 color = makeColor(r, g, b);

    impl_->overlayLineVertices.push_back({makeClipPosition(x0, y0, 0.0f, pixelWidth, pixelHeight), color});
    impl_->overlayLineVertices.push_back({makeClipPosition(x1, y1, 0.0f, pixelWidth, pixelHeight), color});
}

void NativeLineViewer::drawDepthLine(
    float x0,
    float y0,
    float z0,
    float x1,
    float y1,
    float z1,
    int32_t r,
    int32_t g,
    int32_t b
) {
    if (impl_ == nullptr) {
        return;
    }

    const int32_t pixelWidth = width();
    const int32_t pixelHeight = height();
    const simd_float4 color = makeColor(r, g, b);
    const float depthBias = 0.0025f;

    impl_->depthLineVertices.push_back({makeClipPosition(x0, y0, z0 - depthBias, pixelWidth, pixelHeight), color});
    impl_->depthLineVertices.push_back({makeClipPosition(x1, y1, z1 - depthBias, pixelWidth, pixelHeight), color});
}

void NativeLineViewer::drawTriangle(
    float x0,
    float y0,
    float z0,
    float x1,
    float y1,
    float z1,
    float x2,
    float y2,
    float z2,
    int32_t r,
    int32_t g,
    int32_t b
) {
    if (impl_ == nullptr) {
        return;
    }

    const int32_t pixelWidth = width();
    const int32_t pixelHeight = height();
    const simd_float4 color = makeColor(r, g, b);

    impl_->triangleVertices.push_back({makeClipPosition(x0, y0, z0, pixelWidth, pixelHeight), color});
    impl_->triangleVertices.push_back({makeClipPosition(x1, y1, z1, pixelWidth, pixelHeight), color});
    impl_->triangleVertices.push_back({makeClipPosition(x2, y2, z2, pixelWidth, pixelHeight), color});
}

void NativeLineViewer::present() {
    if (impl_ == nullptr || impl_->layer == nil || impl_->queue == nil || impl_->pipelineState == nil) {
        return;
    }

    const int32_t pixelWidth = width();
    const int32_t pixelHeight = height();
    if (pixelWidth <= 0 || pixelHeight <= 0) {
        return;
    }

    impl_->layer.drawableSize = CGSizeMake(static_cast<CGFloat>(pixelWidth), static_cast<CGFloat>(pixelHeight));

    if (impl_->depthTexture == nil || impl_->depthTextureWidth != pixelWidth || impl_->depthTextureHeight != pixelHeight) {
        impl_->depthTextureWidth = pixelWidth;
        impl_->depthTextureHeight = pixelHeight;
        [impl_->depthTexture release];
        impl_->depthTexture = nil;

        MTLTextureDescriptor* depthDescriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatDepth32Float
                                                                                                   width:pixelWidth
                                                                                                  height:pixelHeight
                                                                                               mipmapped:NO];
        depthDescriptor.usage = MTLTextureUsageRenderTarget;
        depthDescriptor.storageMode = MTLStorageModePrivate;
        impl_->depthTexture = [impl_->device newTextureWithDescriptor:depthDescriptor];
    }

    id<CAMetalDrawable> drawable = [impl_->layer nextDrawable];
    if (drawable == nil) {
        return;
    }

    MTLRenderPassDescriptor* renderPass = [MTLRenderPassDescriptor renderPassDescriptor];
    renderPass.colorAttachments[0].texture = drawable.texture;
    renderPass.colorAttachments[0].loadAction = MTLLoadActionClear;
    renderPass.colorAttachments[0].storeAction = MTLStoreActionStore;
    renderPass.colorAttachments[0].clearColor = impl_->clearColor;
    renderPass.depthAttachment.texture = impl_->depthTexture;
    renderPass.depthAttachment.loadAction = MTLLoadActionClear;
    renderPass.depthAttachment.storeAction = MTLStoreActionDontCare;
    renderPass.depthAttachment.clearDepth = 1.0;

    id<MTLCommandBuffer> commandBuffer = [impl_->queue commandBuffer];
    id<MTLRenderCommandEncoder> encoder = [commandBuffer renderCommandEncoderWithDescriptor:renderPass];
    [encoder setRenderPipelineState:impl_->pipelineState];

    if (!impl_->triangleVertices.empty()) {
      id<MTLBuffer> triangleBuffer = [impl_->device newBufferWithBytes:impl_->triangleVertices.data()
                                                                length:sizeof(ViewerVertex) * impl_->triangleVertices.size()
                                                               options:MTLResourceStorageModeShared];
      [encoder setDepthStencilState:impl_->triangleDepthState];
            [encoder setCullMode:MTLCullModeNone];
      [encoder setVertexBuffer:triangleBuffer offset:0 atIndex:0];
      [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:impl_->triangleVertices.size()];
      [triangleBuffer release];
    }

        if (!impl_->depthLineVertices.empty()) {
            id<MTLBuffer> depthLineBuffer = [impl_->device newBufferWithBytes:impl_->depthLineVertices.data()
                                                                                                                                 length:sizeof(ViewerVertex) * impl_->depthLineVertices.size()
                                                                                                                                options:MTLResourceStorageModeShared];
            [encoder setDepthStencilState:impl_->lineDepthState];
            [encoder setCullMode:MTLCullModeNone];
            [encoder setVertexBuffer:depthLineBuffer offset:0 atIndex:0];
            [encoder drawPrimitives:MTLPrimitiveTypeLine vertexStart:0 vertexCount:impl_->depthLineVertices.size()];
            [depthLineBuffer release];
        }

        if (!impl_->overlayLineVertices.empty()) {
            id<MTLBuffer> lineBuffer = [impl_->device newBufferWithBytes:impl_->overlayLineVertices.data()
                                                                                                                        length:sizeof(ViewerVertex) * impl_->overlayLineVertices.size()
                                                           options:MTLResourceStorageModeShared];
      [encoder setDepthStencilState:impl_->overlayDepthState];
      [encoder setCullMode:MTLCullModeNone];
      [encoder setVertexBuffer:lineBuffer offset:0 atIndex:0];
            [encoder drawPrimitives:MTLPrimitiveTypeLine vertexStart:0 vertexCount:impl_->overlayLineVertices.size()];
      [lineBuffer release];
    }

    [encoder endEncoding];
    [commandBuffer presentDrawable:drawable];
    [commandBuffer commit];
}

void NativeLineViewer::delay(int32_t ms) {
    SDL_Delay(ms);
}

void NativeLineViewer::close() {
    if (impl_ == nullptr) {
        return;
    }

    if (impl_->metalView != nullptr) {
        SDL_Metal_DestroyView(impl_->metalView);
        impl_->metalView = nullptr;
        impl_->layer = nil;
    }
    if (impl_->window != nullptr) {
        SDL_DestroyWindow(impl_->window);
        impl_->window = nullptr;
    }
    if (impl_->sdlOwned) {
        SDL_Quit();
        impl_->sdlOwned = false;
    }
    impl_->open = false;
}

float NativeLineViewer::consumeOrbitX() {
    if (impl_ == nullptr) {
        return 0.0f;
    }

    const float value = impl_->orbitX;
    impl_->orbitX = 0.0f;
    return value;
}

float NativeLineViewer::consumeOrbitY() {
    if (impl_ == nullptr) {
        return 0.0f;
    }

    const float value = impl_->orbitY;
    impl_->orbitY = 0.0f;
    return value;
}

float NativeLineViewer::consumePanX() {
    if (impl_ == nullptr) {
        return 0.0f;
    }

    const float value = impl_->panX;
    impl_->panX = 0.0f;
    return value;
}

float NativeLineViewer::consumePanY() {
    if (impl_ == nullptr) {
        return 0.0f;
    }

    const float value = impl_->panY;
    impl_->panY = 0.0f;
    return value;
}

float NativeLineViewer::consumeZoom() {
    if (impl_ == nullptr) {
        return 0.0f;
    }

    const float value = impl_->zoom;
    impl_->zoom = 0.0f;
    return value;
}

bool NativeLineViewer::consumeResetRequested() {
    if (impl_ == nullptr) {
        return false;
    }

    const bool value = impl_->resetRequested;
    impl_->resetRequested = false;
    return value;
}

} // namespace doof_obj_viewer

#endif