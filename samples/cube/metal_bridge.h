// metal_bridge.h - Doof-compatible wrappers for SDL3/Metal graphics API
// Provides shared_ptr-based wrappers matching extern class declarations

#ifndef METAL_BRIDGE_H
#define METAL_BRIDGE_H

#include "sdl_metal_bridge.h"
#include <memory>
#include <vector>
#include <cstdint>

// ==================== Vec3 ====================

class Vec3 : public std::enable_shared_from_this<Vec3> {
public:
    float x, y, z;

    Vec3() : x(0), y(0), z(0) {}
    Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}

    static std::shared_ptr<Vec3> create(float x, float y, float z) {
        return std::make_shared<Vec3>(x, y, z);
    }

    static std::shared_ptr<Vec3> cross(const std::shared_ptr<Vec3>& a, const std::shared_ptr<Vec3>& b) {
        return std::make_shared<Vec3>(
            a->y * b->z - a->z * b->y,
            a->z * b->x - a->x * b->z,
            a->x * b->y - a->y * b->x
        );
    }

    float dot(const std::shared_ptr<Vec3>& other) const {
        return x * other->x + y * other->y + z * other->z;
    }

    std::shared_ptr<Vec3> normalized() const {
        float len = std::sqrt(x * x + y * y + z * z);
        if (len > 0.0001f) {
            return std::make_shared<Vec3>(x / len, y / len, z / len);
        }
        return std::make_shared<Vec3>(x, y, z);
    }

    std::shared_ptr<Vec3> add(const std::shared_ptr<Vec3>& other) const {
        return std::make_shared<Vec3>(x + other->x, y + other->y, z + other->z);
    }

    std::shared_ptr<Vec3> sub(const std::shared_ptr<Vec3>& other) const {
        return std::make_shared<Vec3>(x - other->x, y - other->y, z - other->z);
    }

    std::shared_ptr<Vec3> scale(float s) const {
        return std::make_shared<Vec3>(x * s, y * s, z * s);
    }

    // Property accessors for Doof
    float get_x() const { return x; }
    float get_y() const { return y; }
    float get_z() const { return z; }
    void set_x(float v) { x = v; }
    void set_y(float v) { y = v; }
    void set_z(float v) { z = v; }
    
    // Convert to native type
    sdl_metal::Vec3 toNative() const { return sdl_metal::Vec3(x, y, z); }
};

// ==================== Vec4 ====================

class Vec4 : public std::enable_shared_from_this<Vec4> {
public:
    float x, y, z, w;

    Vec4() : x(0), y(0), z(0), w(0) {}
    Vec4(float x_, float y_, float z_, float w_) : x(x_), y(y_), z(z_), w(w_) {}

    static std::shared_ptr<Vec4> create(float x, float y, float z, float w) {
        return std::make_shared<Vec4>(x, y, z, w);
    }

    static std::shared_ptr<Vec4> fromVec3(const std::shared_ptr<Vec3>& v, float w) {
        return std::make_shared<Vec4>(v->x, v->y, v->z, w);
    }

    // Property accessors
    float get_x() const { return x; }
    float get_y() const { return y; }
    float get_z() const { return z; }
    float get_w() const { return w; }
    void set_x(float v) { x = v; }
    void set_y(float v) { y = v; }
    void set_z(float v) { z = v; }
    void set_w(float v) { w = v; }
    
    // Convert to native type
    sdl_metal::Vec4 toNative() const { return sdl_metal::Vec4(x, y, z, w); }
};

// ==================== Mat4 ====================

class Mat4 : public std::enable_shared_from_this<Mat4> {
public:
    sdl_metal::Mat4 native;

    Mat4() : native() {}
    explicit Mat4(const sdl_metal::Mat4& m) : native(m) {}

    static std::shared_ptr<Mat4> identity() {
        return std::make_shared<Mat4>(sdl_metal::Mat4::identity());
    }

    static std::shared_ptr<Mat4> perspective(float fovY, float aspect, float nearZ, float farZ) {
        return std::make_shared<Mat4>(sdl_metal::Mat4::perspective(fovY, aspect, nearZ, farZ));
    }

    static std::shared_ptr<Mat4> lookAt(const std::shared_ptr<Vec3>& eye, 
                                        const std::shared_ptr<Vec3>& center, 
                                        const std::shared_ptr<Vec3>& up) {
        return std::make_shared<Mat4>(sdl_metal::Mat4::lookAt(
            eye->toNative(), center->toNative(), up->toNative()));
    }

    static std::shared_ptr<Mat4> rotationX(float angle) {
        return std::make_shared<Mat4>(sdl_metal::Mat4::rotationX(angle));
    }

    static std::shared_ptr<Mat4> rotationY(float angle) {
        return std::make_shared<Mat4>(sdl_metal::Mat4::rotationY(angle));
    }

    static std::shared_ptr<Mat4> rotationZ(float angle) {
        return std::make_shared<Mat4>(sdl_metal::Mat4::rotationZ(angle));
    }

    static std::shared_ptr<Mat4> translation(float x, float y, float z) {
        return std::make_shared<Mat4>(sdl_metal::Mat4::translation(x, y, z));
    }

    static std::shared_ptr<Mat4> scale(float x, float y, float z) {
        return std::make_shared<Mat4>(sdl_metal::Mat4::scale(x, y, z));
    }

    std::shared_ptr<Mat4> multiply(const std::shared_ptr<Mat4>& other) const {
        return std::make_shared<Mat4>(native * other->native);
    }
};

// ==================== VertexBuffer ====================

class VertexBuffer : public std::enable_shared_from_this<VertexBuffer> {
public:
    sdl_metal::VertexBuffer native;

    VertexBuffer() = default;
    explicit VertexBuffer(sdl_metal::VertexBuffer&& buf) : native(std::move(buf)) {}

    static std::shared_ptr<VertexBuffer> create(int byteSize) {
        return std::make_shared<VertexBuffer>(sdl_metal::VertexBuffer::create(static_cast<uint32_t>(byteSize)));
    }

    void setFloat(int offset, float value) {
        native.setFloat(static_cast<uint32_t>(offset), value);
    }

    void setVec3(int offset, const std::shared_ptr<Vec3>& value) {
        if (value) native.setVec3(static_cast<uint32_t>(offset), value->toNative());
    }

    void setVec4(int offset, const std::shared_ptr<Vec4>& value) {
        if (value) native.setVec4(static_cast<uint32_t>(offset), value->toNative());
    }

    int getSize() const { return static_cast<int>(native.getSize()); }
    bool isValid() const { return native.isValid(); }
};

// ==================== IndexBuffer ====================

class IndexBuffer : public std::enable_shared_from_this<IndexBuffer> {
public:
    sdl_metal::IndexBuffer native;

    IndexBuffer() = default;
    explicit IndexBuffer(sdl_metal::IndexBuffer&& buf) : native(std::move(buf)) {}

    static std::shared_ptr<IndexBuffer> create(int indexCount) {
        return std::make_shared<IndexBuffer>(sdl_metal::IndexBuffer::create(static_cast<uint32_t>(indexCount)));
    }

    void setIndex(int index, int value) {
        native.setIndex(static_cast<uint32_t>(index), static_cast<uint32_t>(value));
    }

    int getIndexCount() const { return static_cast<int>(native.getIndexCount()); }
    bool isValid() const { return native.isValid(); }
};

// ==================== RenderPass ====================

class RenderPass : public std::enable_shared_from_this<RenderPass> {
public:
    sdl_metal::MetalRenderer* renderer = nullptr;

    RenderPass() = default;
    explicit RenderPass(sdl_metal::MetalRenderer* r) : renderer(r) {}

    void setVertexBuffer(const std::shared_ptr<VertexBuffer>& buffer, int stride) {
        if (renderer && buffer) {
            renderer->bindVertexBuffer(buffer->native, static_cast<uint32_t>(stride));
        }
    }

    void setIndexBuffer(const std::shared_ptr<IndexBuffer>& buffer) {
        if (renderer && buffer) {
            renderer->bindIndexBuffer(buffer->native);
        }
    }

    void setModelMatrix(const std::shared_ptr<Mat4>& model) {
        if (renderer) renderer->setModelMatrix(model->native);
    }

    void setViewMatrix(const std::shared_ptr<Mat4>& view) {
        if (renderer) renderer->setViewMatrix(view->native);
    }

    void setProjectionMatrix(const std::shared_ptr<Mat4>& proj) {
        if (renderer) renderer->setProjectionMatrix(proj->native);
    }

    void drawIndexed(int indexCount, int startIndex) {
        if (renderer) {
            renderer->drawIndexed(static_cast<uint32_t>(indexCount), static_cast<uint32_t>(startIndex));
        }
    }

    void draw(int vertexCount, int startVertex) {
        if (renderer) {
            renderer->draw(static_cast<uint32_t>(vertexCount), static_cast<uint32_t>(startVertex));
        }
    }
};

// ==================== MetalRenderer ====================

class MetalRenderer : public std::enable_shared_from_this<MetalRenderer> {
public:
    sdl_metal::MetalRenderer* impl = nullptr;

    MetalRenderer() = default;
    explicit MetalRenderer(sdl_metal::MetalRenderer* r) : impl(r) {}

    std::shared_ptr<RenderPass> beginFrame() {
        if (!impl) return std::make_shared<RenderPass>();
        impl->beginFrame();
        return std::make_shared<RenderPass>(impl);
    }

    void endFrame() {
        if (impl) impl->endFrame();
    }

    int getWindowWidth() const {
        return impl ? impl->getWindowWidth() : 0;
    }

    int getWindowHeight() const {
        return impl ? impl->getWindowHeight() : 0;
    }
};

// ==================== Application ====================

class Application : public std::enable_shared_from_this<Application> {
public:
    std::unique_ptr<sdl_metal::Application> impl;
    std::shared_ptr<MetalRenderer> rendererWrapper;

    Application() : impl(std::make_unique<sdl_metal::Application>()) {}

    static std::shared_ptr<Application> create() {
        return std::make_shared<Application>();
    }

    bool initialize(int width, int height, const std::string& title) {
        return impl->initialize(width, height, title);
    }

    void shutdown() {
        impl->shutdown();
    }

    bool pollEvents() {
        return impl->pollEvents();
    }

    float getDeltaTime() {
        return impl->getDeltaTime();
    }

    std::shared_ptr<MetalRenderer> getRenderer() {
        if (!rendererWrapper) {
            rendererWrapper = std::make_shared<MetalRenderer>(&impl->getRenderer());
        }
        return rendererWrapper;
    }

    bool isKeyPressed(int keyCode) const {
        return impl->isKeyPressed(keyCode);
    }
};

// ==================== Keys ====================

class Keys {
public:
    static constexpr int ESCAPE = sdl_metal::KEY_ESCAPE;
    static constexpr int SPACE = sdl_metal::KEY_SPACE;
    static constexpr int LEFT = sdl_metal::KEY_LEFT;
    static constexpr int RIGHT = sdl_metal::KEY_RIGHT;
    static constexpr int UP = sdl_metal::KEY_UP;
    static constexpr int DOWN = sdl_metal::KEY_DOWN;
    static constexpr int W = sdl_metal::KEY_W;
    static constexpr int A = sdl_metal::KEY_A;
    static constexpr int S = sdl_metal::KEY_S;
    static constexpr int D = sdl_metal::KEY_D;
};

#endif // METAL_BRIDGE_H
