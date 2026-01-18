// Metal Graphics API - Extern class declarations for SDL3/Metal rendering
// Simplified low-level buffer interface

// ==================== Math Types ====================

export extern class Vec3 from "metal_bridge.h" {
    x: float;
    y: float;
    z: float;
    
    static create(x: float, y: float, z: float): Vec3;
    static cross(a: Vec3, b: Vec3): Vec3;
    dot(other: Vec3): float;
    normalized(): Vec3;
    add(other: Vec3): Vec3;
    sub(other: Vec3): Vec3;
    scale(s: float): Vec3;
}

export extern class Vec4 from "metal_bridge.h" {
    x: float;
    y: float;
    z: float;
    w: float;
    
    static create(x: float, y: float, z: float, w: float): Vec4;
    static fromVec3(v: Vec3, w: float): Vec4;
}

export extern class Mat4 from "metal_bridge.h" {
    static identity(): Mat4;
    static perspective(fovY: float, aspect: float, nearZ: float, farZ: float): Mat4;
    static lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4;
    static rotationX(angle: float): Mat4;
    static rotationY(angle: float): Mat4;
    static rotationZ(angle: float): Mat4;
    static translation(x: float, y: float, z: float): Mat4;
    static scale(x: float, y: float, z: float): Mat4;
    
    multiply(other: Mat4): Mat4;
}

// ==================== GPU Buffers ====================

// Raw vertex buffer with direct memory writes
export extern class VertexBuffer from "metal_bridge.h" {
    static create(byteSize: int): VertexBuffer;
    
    setFloat(offset: int, value: float): void;
    setVec3(offset: int, value: Vec3): void;
    setVec4(offset: int, value: Vec4): void;
    
    getSize(): int;
    isValid(): bool;
}

// Raw index buffer
export extern class IndexBuffer from "metal_bridge.h" {
    static create(indexCount: int): IndexBuffer;
    
    setIndex(index: int, value: int): void;
    
    getIndexCount(): int;
    isValid(): bool;
}

// ==================== Render Commands ====================

export extern class RenderPass from "metal_bridge.h" {
    setVertexBuffer(buffer: VertexBuffer, stride: int): void;
    setIndexBuffer(buffer: IndexBuffer): void;
    setModelMatrix(model: Mat4): void;
    setViewMatrix(view: Mat4): void;
    setProjectionMatrix(proj: Mat4): void;
    drawIndexed(indexCount: int, startIndex: int): void;
    draw(vertexCount: int, startVertex: int): void;
}

// ==================== Renderer ====================

export extern class MetalRenderer from "metal_bridge.h" {
    beginFrame(): RenderPass;
    endFrame(): void;
    
    getWindowWidth(): int;
    getWindowHeight(): int;
}

// ==================== Application ====================

export extern class Application from "metal_bridge.h" {
    static create(): Application;
    initialize(width: int, height: int, title: string): bool;
    shutdown(): void;
    pollEvents(): bool;
    getDeltaTime(): float;
    getRenderer(): MetalRenderer;
    isKeyPressed(keyCode: int): bool;
}

// ==================== Key Codes ====================

export extern class Keys from "metal_bridge.h" {
    static ESCAPE: int;
    static SPACE: int;
    static LEFT: int;
    static RIGHT: int;
    static UP: int;
    static DOWN: int;
    static W: int;
    static A: int;
    static S: int;
    static D: int;
}
