// SDL3/Metal Bridge - Flexible Rendering API
// Provides a generic vertex format system for various 3D applications

#ifndef SDL_METAL_BRIDGE_H
#define SDL_METAL_BRIDGE_H

#include <string>
#include <vector>
#include <memory>
#include <array>
#include <cstdint>
#include <cstring>
#include <cmath>

// Forward declarations for Objective-C types
#ifdef __OBJC__
@protocol MTLDevice;
@protocol MTLCommandQueue;
@protocol MTLRenderPipelineState;
@protocol MTLBuffer;
@protocol MTLDepthStencilState;
@class CAMetalLayer;
#else
typedef void* id;
#endif

struct SDL_Window;

namespace sdl_metal {

// ==================== Math Types ====================

struct Vec3 {
    float x, y, z;
    
    Vec3() : x(0), y(0), z(0) {}
    Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}
    
    Vec3 operator+(const Vec3& o) const { return Vec3(x + o.x, y + o.y, z + o.z); }
    Vec3 operator-(const Vec3& o) const { return Vec3(x - o.x, y - o.y, z - o.z); }
    Vec3 operator*(float s) const { return Vec3(x * s, y * s, z * s); }
    
    static Vec3 cross(const Vec3& a, const Vec3& b) {
        return Vec3(
            a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x
        );
    }
    
    float dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
    
    Vec3 normalized() const {
        float len = std::sqrt(x * x + y * y + z * z);
        if (len > 0.0001f) return Vec3(x / len, y / len, z / len);
        return *this;
    }
};

struct Vec4 {
    float x, y, z, w;
    
    Vec4() : x(0), y(0), z(0), w(0) {}
    Vec4(float x_, float y_, float z_, float w_) : x(x_), y(y_), z(z_), w(w_) {}
    Vec4(const Vec3& v, float w_) : x(v.x), y(v.y), z(v.z), w(w_) {}
};

// Column-major 4x4 matrix
struct Mat4 {
    float m[16];
    
    Mat4();
    
    static Mat4 identity();
    static Mat4 perspective(float fovY, float aspect, float nearZ, float farZ);
    static Mat4 lookAt(const Vec3& eye, const Vec3& center, const Vec3& up);
    static Mat4 rotationX(float angle);
    static Mat4 rotationY(float angle);
    static Mat4 rotationZ(float angle);
    static Mat4 translation(float x, float y, float z);
    static Mat4 scale(float x, float y, float z);
    
    Mat4 operator*(const Mat4& o) const;
};

// ==================== Vertex Format System ====================

// Simple vertex format - just stride and attribute count for shader binding
struct VertexFormat {
    uint32_t stride;  // Total bytes per vertex
    
    VertexFormat() : stride(0) {}
    explicit VertexFormat(uint32_t s) : stride(s) {}
    
    // Create common vertex formats (stride only, app defines layout)
    static VertexFormat positionNormalColor() {
        return VertexFormat(sizeof(float) * 10);  // 3 + 3 + 4
    }
};

// ==================== GPU Buffer Handles ====================

// Vertex buffer with direct memory access
class VertexBuffer {
public:
    VertexBuffer() = default;
    ~VertexBuffer();
    
    VertexBuffer(const VertexBuffer&) = delete;
    VertexBuffer& operator=(const VertexBuffer&) = delete;
    VertexBuffer(VertexBuffer&& other) noexcept;
    VertexBuffer& operator=(VertexBuffer&& other) noexcept;
    
    // Create buffer with byte size
    static VertexBuffer create(uint32_t byteSize);
    
    // Write data at byte offset
    void setFloat(uint32_t offset, float value);
    void setVec3(uint32_t offset, const Vec3& value);
    void setVec4(uint32_t offset, const Vec4& value);
    void setFloatArray(uint32_t offset, const float* values, uint32_t count);
    void setVec3Array(uint32_t offset, const Vec3* values, uint32_t count);
    void setVec4Array(uint32_t offset, const Vec4* values, uint32_t count);
    
    uint32_t getSize() const { return byteSize; }
    bool isValid() const { return buffer != nullptr && data != nullptr; }
    
private:
    friend class MetalRenderer;
    void* buffer = nullptr;  // id<MTLBuffer>
    uint8_t* data = nullptr;  // CPU-accessible memory
    uint32_t byteSize = 0;
};

// Index buffer with direct memory access
class IndexBuffer {
public:
    IndexBuffer() = default;
    ~IndexBuffer();
    
    IndexBuffer(const IndexBuffer&) = delete;
    IndexBuffer& operator=(const IndexBuffer&) = delete;
    IndexBuffer(IndexBuffer&& other) noexcept;
    IndexBuffer& operator=(IndexBuffer&& other) noexcept;
    
    // Create buffer with index count
    static IndexBuffer create(uint32_t indexCount);
    
    // Write indices
    void setIndex(uint32_t index, uint32_t value);
    void setIndices(uint32_t startIndex, const uint32_t* values, uint32_t count);
    void setIndices(uint32_t startIndex, const std::vector<uint32_t>& values);
    
    uint32_t getIndexCount() const { return indexCount; }
    bool isValid() const { return buffer != nullptr && data != nullptr; }
    
private:
    friend class MetalRenderer;
    void* buffer = nullptr;  // id<MTLBuffer>
    uint32_t* data = nullptr;  // CPU-accessible memory
    uint32_t indexCount = 0;
};

// ==================== Pipeline Configuration ====================

enum class CullMode {
    None,
    Front,
    Back
};

enum class WindingOrder {
    Clockwise,
    CounterClockwise
};

struct PipelineConfig {
    VertexFormat vertexFormat;
    bool depthTestEnabled = true;
    bool depthWriteEnabled = true;
    CullMode cullMode = CullMode::Back;
    WindingOrder windingOrder = WindingOrder::CounterClockwise;
    std::string shaderName = "default";  // For future shader variants
};

// ==================== Renderer Interface ====================

class MetalRenderer {
public:
    MetalRenderer();
    ~MetalRenderer();
    
    bool initialize(SDL_Window* window);
    void shutdown();
    
    // Pipeline management
    bool configurePipeline(const PipelineConfig& config);
    const VertexFormat& getCurrentVertexFormat() const { return currentFormat; }
    
    // Frame lifecycle
    void beginFrame();
    void endFrame();
    
    // Transform matrices
    void setProjectionMatrix(const Mat4& proj);
    void setViewMatrix(const Mat4& view);
    void setModelMatrix(const Mat4& model);
    
    // Drawing commands
    void bindVertexBuffer(const VertexBuffer& buffer, uint32_t stride);
    void bindIndexBuffer(const IndexBuffer& buffer);
    void drawIndexed(uint32_t indexCount, uint32_t startIndex = 0);
    void draw(uint32_t vertexCount, uint32_t startVertex = 0);
    
    // Window info
    int getWindowWidth() const { return windowWidth; }
    int getWindowHeight() const { return windowHeight; }
    
private:
    struct Impl;
    std::unique_ptr<Impl> pImpl;
    
    VertexFormat currentFormat;
    int windowWidth = 800;
    int windowHeight = 600;
};

// ==================== Application Interface ====================

class Application {
public:
    Application();
    ~Application();
    
    bool initialize(int width, int height, const std::string& title);
    void shutdown();
    
    bool pollEvents();  // Returns false when should quit
    float getDeltaTime();
    
    MetalRenderer& getRenderer() { return *renderer; }
    
    bool isKeyPressed(int keyCode) const;
    
private:
    SDL_Window* window = nullptr;
    std::unique_ptr<MetalRenderer> renderer;
    uint64_t lastFrameTime = 0;
    float deltaTime = 0.0f;
};

// ==================== Key Codes ====================

constexpr int KEY_ESCAPE = 27;
constexpr int KEY_SPACE = 32;
constexpr int KEY_LEFT = 80;
constexpr int KEY_RIGHT = 79;
constexpr int KEY_UP = 82;
constexpr int KEY_DOWN = 81;
constexpr int KEY_W = 119;
constexpr int KEY_A = 97;
constexpr int KEY_S = 115;
constexpr int KEY_D = 100;

} // namespace sdl_metal

#endif // SDL_METAL_BRIDGE_H
