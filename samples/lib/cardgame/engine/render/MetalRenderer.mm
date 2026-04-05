#include "MetalRenderer.h"

#include <cstdio>

static NSString* const kShaderSource = @R"(
#include <metal_stdlib>
using namespace metal;

struct VertexIn {
    float3 position [[attribute(0)]];
    float2 texCoord [[attribute(1)]];
    float alpha [[attribute(2)]];
};

struct VertexOut {
    float4 position [[position]];
    float2 texCoord;
    float alpha;
};

struct Uniforms {
    float4x4 mvp;
};

vertex VertexOut vertexMain(VertexIn in [[stage_in]], constant Uniforms& uniforms [[buffer(1)]]) {
    VertexOut out;
    out.position = uniforms.mvp * float4(in.position, 1.0);
    out.texCoord = in.texCoord;
    out.alpha = in.alpha;
    return out;
}

fragment float4 fragmentMain(VertexOut in [[stage_in]],
                             texture2d<float> tex [[texture(0)]],
                             sampler samp [[sampler(0)]]) {
    float4 color = tex.sample(samp, in.texCoord);
    color.a *= in.alpha;
    // Premultiply alpha for blending
    color.rgb *= color.a;
    return color;
}
)";

MetalRenderer::~MetalRenderer() {
    [m_msaaColorTexture release];
    [m_depthTexture release];
    [m_samplerState release];
    [m_painterDepthState release];
    [m_depthState release];
    [m_uiPipelineState release];
    [m_pipelineState release];
    [m_queue release];
    [m_device release];
}

bool MetalRenderer::init(CAMetalLayer* layer, int sampleCount) {
    m_device = MTLCreateSystemDefaultDevice();
    if (!m_device) {
        std::fprintf(stderr, "MTLCreateSystemDefaultDevice failed\n");
        return false;
    }

    // Store sample count (clamp to valid values)
    m_sampleCount = (sampleCount >= 4) ? 4 : 1;

    layer.device = m_device;
    layer.pixelFormat = MTLPixelFormatBGRA8Unorm;
    layer.framebufferOnly = YES;

    m_queue = [m_device newCommandQueue];
    if (!m_queue) {
        std::fprintf(stderr, "Failed to create Metal command queue\n");
        return false;
    }

    MTLSamplerDescriptor* samplerDesc = [[MTLSamplerDescriptor alloc] init];
    samplerDesc.minFilter = MTLSamplerMinMagFilterLinear;
    samplerDesc.magFilter = MTLSamplerMinMagFilterLinear;
    samplerDesc.mipFilter = MTLSamplerMipFilterLinear;  // Enable trilinear filtering for mipmaps
    samplerDesc.sAddressMode = MTLSamplerAddressModeClampToEdge;
    samplerDesc.tAddressMode = MTLSamplerAddressModeClampToEdge;
    m_samplerState = [m_device newSamplerStateWithDescriptor:samplerDesc];
    [samplerDesc release];

    NSError* error = nil;
    id<MTLLibrary> library = [m_device newLibraryWithSource:kShaderSource options:nil error:&error];
    if (!library) {
        std::fprintf(stderr, "Shader compile error: %s\n", [[error localizedDescription] UTF8String]);
        return false;
    }

    id<MTLFunction> vertFunc = [library newFunctionWithName:@"vertexMain"];
    id<MTLFunction> fragFunc = [library newFunctionWithName:@"fragmentMain"];

    MTLVertexDescriptor* vertDesc = [[MTLVertexDescriptor alloc] init];
    vertDesc.attributes[0].format = MTLVertexFormatFloat3;
    vertDesc.attributes[0].offset = offsetof(Vertex, x);
    vertDesc.attributes[0].bufferIndex = 0;

    vertDesc.attributes[1].format = MTLVertexFormatFloat2;
    vertDesc.attributes[1].offset = offsetof(Vertex, u);
    vertDesc.attributes[1].bufferIndex = 0;

    vertDesc.attributes[2].format = MTLVertexFormatFloat;
    vertDesc.attributes[2].offset = offsetof(Vertex, alpha);
    vertDesc.attributes[2].bufferIndex = 0;

    vertDesc.layouts[0].stride = sizeof(Vertex);
    vertDesc.layouts[0].stepFunction = MTLVertexStepFunctionPerVertex;

    MTLRenderPipelineDescriptor* pipeDesc = [[MTLRenderPipelineDescriptor alloc] init];
    pipeDesc.vertexFunction = vertFunc;
    pipeDesc.fragmentFunction = fragFunc;
    pipeDesc.vertexDescriptor = vertDesc;
    pipeDesc.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm;
    pipeDesc.depthAttachmentPixelFormat = MTLPixelFormatDepth32Float;
    pipeDesc.rasterSampleCount = m_sampleCount;  // Enable MSAA if requested

    // Premultiplied alpha blending (TextureLoader uses kCGImageAlphaPremultipliedLast).
    // This enables transparent pixels in the atlas to blend correctly.
    pipeDesc.colorAttachments[0].blendingEnabled = YES;
    pipeDesc.colorAttachments[0].rgbBlendOperation = MTLBlendOperationAdd;
    pipeDesc.colorAttachments[0].alphaBlendOperation = MTLBlendOperationAdd;
    pipeDesc.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorOne;
    pipeDesc.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
    pipeDesc.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
    pipeDesc.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOneMinusSourceAlpha;

    m_pipelineState = [m_device newRenderPipelineStateWithDescriptor:pipeDesc error:&error];
    if (!m_pipelineState) {
        [pipeDesc release];
        [vertDesc release];
        [fragFunc release];
        [vertFunc release];
        [library release];
        std::fprintf(stderr, "Pipeline error: %s\n", [[error localizedDescription] UTF8String]);
        return false;
    }

    // Create non-MSAA pipeline for UI pass (renders directly to drawable)
    if (m_sampleCount > 1) {
        pipeDesc.rasterSampleCount = 1;
        pipeDesc.depthAttachmentPixelFormat = MTLPixelFormatInvalid;  // No depth for UI
        m_uiPipelineState = [m_device newRenderPipelineStateWithDescriptor:pipeDesc error:&error];
        if (!m_uiPipelineState) {
            [pipeDesc release];
            [vertDesc release];
            [fragFunc release];
            [vertFunc release];
            [library release];
            std::fprintf(stderr, "UI Pipeline error: %s\n", [[error localizedDescription] UTF8String]);
            return false;
        }
    } else {
        // No MSAA, UI can use same pipeline but without depth
        pipeDesc.depthAttachmentPixelFormat = MTLPixelFormatInvalid;
        m_uiPipelineState = [m_device newRenderPipelineStateWithDescriptor:pipeDesc error:&error];
        if (!m_uiPipelineState) {
            [pipeDesc release];
            [vertDesc release];
            [fragFunc release];
            [vertFunc release];
            [library release];
            std::fprintf(stderr, "UI Pipeline error: %s\n", [[error localizedDescription] UTF8String]);
            return false;
        }
    }

    [pipeDesc release];
    [vertDesc release];
    [fragFunc release];
    [vertFunc release];
    [library release];

    MTLDepthStencilDescriptor* depthStencilDesc = [[MTLDepthStencilDescriptor alloc] init];
    depthStencilDesc.depthCompareFunction = MTLCompareFunctionLess;
    depthStencilDesc.depthWriteEnabled = YES;
    m_depthState = [m_device newDepthStencilStateWithDescriptor:depthStencilDesc];
    [depthStencilDesc release];

    // Painter-style depth state: cards are composited strictly in draw order.
    MTLDepthStencilDescriptor* painterDepthDesc = [[MTLDepthStencilDescriptor alloc] init];
    painterDepthDesc.depthCompareFunction = MTLCompareFunctionAlways;
    painterDepthDesc.depthWriteEnabled = NO;
    m_painterDepthState = [m_device newDepthStencilStateWithDescriptor:painterDepthDesc];
    [painterDepthDesc release];

    return true;
}

void MetalRenderer::renderFrame(
    CAMetalLayer* layer,
    const std::vector<RenderBatch>& worldBatches,
    const simd_float4x4& worldMVP,
    const std::vector<RenderBatch>& uiBatches,
    const simd_float4x4& uiMVP,
    int pixelW,
    int pixelH
) {
    layer.drawableSize = CGSizeMake((CGFloat)pixelW, (CGFloat)pixelH);

    id<CAMetalDrawable> drawable = [layer nextDrawable];
    if (!drawable) {
        return;  // Skip this frame if no drawable available
    }

    // Recreate textures if size changed
    if (pixelW != m_depthTextureWidth || pixelH != m_depthTextureHeight || !m_depthTexture) {
        m_depthTextureWidth = pixelW;
        m_depthTextureHeight = pixelH;
        [m_depthTexture release];
        m_depthTexture = nil;
        [m_msaaColorTexture release];
        m_msaaColorTexture = nil;
        
        // Depth texture (with MSAA if enabled)
        MTLTextureDescriptor* depthDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatDepth32Float
                                                                                            width:pixelW
                                                                                           height:pixelH
                                                                                        mipmapped:NO];
        depthDesc.usage = MTLTextureUsageRenderTarget;
        depthDesc.storageMode = MTLStorageModePrivate;
        depthDesc.textureType = (m_sampleCount > 1) ? MTLTextureType2DMultisample : MTLTextureType2D;
        depthDesc.sampleCount = m_sampleCount;
        m_depthTexture = [m_device newTextureWithDescriptor:depthDesc];
        
        // MSAA color texture (if enabled)
        if (m_sampleCount > 1) {
            MTLTextureDescriptor* colorDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                                width:pixelW
                                                                                               height:pixelH
                                                                                            mipmapped:NO];
            colorDesc.usage = MTLTextureUsageRenderTarget;
            colorDesc.storageMode = MTLStorageModePrivate;
            colorDesc.textureType = MTLTextureType2DMultisample;
            colorDesc.sampleCount = m_sampleCount;
            m_msaaColorTexture = [m_device newTextureWithDescriptor:colorDesc];
        } else {
            m_msaaColorTexture = nil;
        }
    }

    MTLViewport viewport = { 0, 0, (double)pixelW, (double)pixelH, 0, 1 };

    id<MTLCommandBuffer> cmd = [m_queue commandBuffer];

    // World pass
    {
        MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor renderPassDescriptor];
        
        if (m_sampleCount > 1) {
            // MSAA: render to multisample texture, resolve to drawable
            pass.colorAttachments[0].texture = m_msaaColorTexture;
            pass.colorAttachments[0].resolveTexture = drawable.texture;
            pass.colorAttachments[0].loadAction = MTLLoadActionClear;
            pass.colorAttachments[0].storeAction = MTLStoreActionMultisampleResolve;
        } else {
            // No MSAA: render directly to drawable
            pass.colorAttachments[0].texture = drawable.texture;
            pass.colorAttachments[0].loadAction = MTLLoadActionClear;
            pass.colorAttachments[0].storeAction = MTLStoreActionStore;
        }
        pass.colorAttachments[0].clearColor = MTLClearColorMake(0.15, 0.25, 0.15, 1.0);

        pass.depthAttachment.texture = m_depthTexture;
        pass.depthAttachment.loadAction = MTLLoadActionClear;
        pass.depthAttachment.storeAction = MTLStoreActionDontCare;
        pass.depthAttachment.clearDepth = 1.0;

        id<MTLRenderCommandEncoder> enc = [cmd renderCommandEncoderWithDescriptor:pass];
        [enc setRenderPipelineState:m_pipelineState];
        [enc setDepthStencilState:m_painterDepthState];  // Use painter's algorithm - render order matters
        [enc setCullMode:MTLCullModeBack];
        [enc setFrontFacingWinding:MTLWindingCounterClockwise];
        [enc setViewport:viewport];

        id<MTLBuffer> mvpBuffer = [m_device newBufferWithBytes:&worldMVP
                                                        length:sizeof(worldMVP)
                                                       options:MTLResourceStorageModeShared];
        [enc setVertexBuffer:mvpBuffer offset:0 atIndex:1];
        [mvpBuffer release];
        [enc setFragmentSamplerState:m_samplerState atIndex:0];

        for (const auto& batch : worldBatches) {
            if (batch.vertices.empty() || !batch.texture) continue;

            id<MTLBuffer> vertexBuffer = [m_device newBufferWithBytes:batch.vertices.data()
                                                               length:batch.vertices.size() * sizeof(Vertex)
                                                              options:MTLResourceStorageModeShared];
            [enc setVertexBuffer:vertexBuffer offset:0 atIndex:0];
            [vertexBuffer release];
            [enc setFragmentTexture:batch.texture atIndex:0];
            [enc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:batch.vertices.size()];
        }

        [enc endEncoding];
    }

    // UI pass (renders without MSAA, directly to drawable)
    if (!uiBatches.empty()) {
        MTLRenderPassDescriptor* uiPass = [MTLRenderPassDescriptor renderPassDescriptor];
        uiPass.colorAttachments[0].texture = drawable.texture;
        uiPass.colorAttachments[0].loadAction = MTLLoadActionLoad;
        uiPass.colorAttachments[0].storeAction = MTLStoreActionStore;
        // No depth attachment for UI pass
        
        id<MTLRenderCommandEncoder> uiEnc = [cmd renderCommandEncoderWithDescriptor:uiPass];
        [uiEnc setRenderPipelineState:m_uiPipelineState];  // Use non-MSAA pipeline
        [uiEnc setDepthStencilState:m_painterDepthState];
        [uiEnc setViewport:viewport];

        id<MTLBuffer> uiMVPBuffer = [m_device newBufferWithBytes:&uiMVP
                                                          length:sizeof(uiMVP)
                                                         options:MTLResourceStorageModeShared];
        [uiEnc setVertexBuffer:uiMVPBuffer offset:0 atIndex:1];
        [uiMVPBuffer release];
        [uiEnc setFragmentSamplerState:m_samplerState atIndex:0];

        for (const auto& batch : uiBatches) {
            if (batch.vertices.empty() || !batch.texture) continue;

            id<MTLBuffer> uiVertexBuffer = [m_device newBufferWithBytes:batch.vertices.data()
                                                                 length:batch.vertices.size() * sizeof(Vertex)
                                                                options:MTLResourceStorageModeShared];
            [uiEnc setVertexBuffer:uiVertexBuffer offset:0 atIndex:0];
            [uiVertexBuffer release];
            [uiEnc setFragmentTexture:batch.texture atIndex:0];
            [uiEnc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:batch.vertices.size()];
        }

        [uiEnc endEncoding];
    }

    [cmd presentDrawable:drawable];
    [cmd commit];
}
