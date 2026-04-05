#pragma once

#include <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>

#include <array>
#include <vector>

#include "Vertex.h"

struct RenderBatch {
    id<MTLTexture> texture;
    std::vector<Vertex> vertices;
};

class MetalRenderer {
public:
    ~MetalRenderer();

    bool init(CAMetalLayer* layer, int sampleCount = 1);

    id<MTLDevice> device() const { return m_device; }
    id<MTLCommandQueue> commandQueue() const { return m_queue; }
    id<MTLSamplerState> sampler() const { return m_samplerState; }

    void renderFrame(
        CAMetalLayer* layer,
        const std::vector<RenderBatch>& worldBatches,
        const std::array<float, 16>& worldMVP,
        const std::vector<RenderBatch>& uiBatches,
        const std::array<float, 16>& uiMVP,
        int pixelW,
        int pixelH
    );

private:
    id<MTLDevice> m_device = nil;
    id<MTLCommandQueue> m_queue = nil;
    id<MTLRenderPipelineState> m_pipelineState = nil;
    id<MTLRenderPipelineState> m_uiPipelineState = nil;  // Non-MSAA pipeline for UI
    id<MTLDepthStencilState> m_depthState = nil;
    id<MTLDepthStencilState> m_painterDepthState = nil;
    id<MTLSamplerState> m_samplerState = nil;

    id<MTLTexture> m_depthTexture = nil;
    id<MTLTexture> m_msaaColorTexture = nil;  // MSAA color target
    int m_depthTextureWidth = 0;
    int m_depthTextureHeight = 0;
    int m_sampleCount = 1;
};
