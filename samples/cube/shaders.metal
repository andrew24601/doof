// Metal Shaders for Rotating Cube
// Compile with: xcrun -sdk macosx metal -c shaders.metal -o shaders.air
// Then: xcrun -sdk macosx metallib shaders.air -o shaders.metallib

#include <metal_stdlib>
using namespace metal;

// Vertex input from buffer
struct VertexIn {
    float3 position [[attribute(0)]];
    float3 normal [[attribute(1)]];
    float4 color [[attribute(2)]];
};

// Output from vertex shader
struct VertexOut {
    float4 position [[position]];
    float3 normal;
    float4 color;
    float3 worldPosition;
};

// Uniforms
struct Uniforms {
    float4x4 modelViewProjection;
};

// Vertex shader
vertex VertexOut vertexShader(VertexIn in [[stage_in]],
                              constant Uniforms& uniforms [[buffer(1)]]) {
    VertexOut out;
    
    out.position = uniforms.modelViewProjection * float4(in.position, 1.0);
    out.normal = in.normal;  // Should transform by normal matrix for proper lighting
    out.color = in.color;
    out.worldPosition = in.position;
    
    return out;
}

// Fragment shader with simple directional lighting
fragment float4 fragmentShader(VertexOut in [[stage_in]]) {
    // Simple directional light
    float3 lightDir = normalize(float3(0.5, 1.0, 0.3));
    float3 normal = normalize(in.normal);
    
    // Ambient + diffuse lighting
    float ambient = 0.3;
    float diffuse = max(dot(normal, lightDir), 0.0) * 0.7;
    
    float3 lighting = float3(ambient + diffuse);
    
    return float4(in.color.rgb * lighting, in.color.a);
}
