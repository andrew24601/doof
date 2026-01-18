// Rotating Cube Application in Doof
// Main application logic using simplified low-level buffer API

import { Vec3, Vec4, Mat4, VertexBuffer, IndexBuffer, MetalRenderer, Application, RenderPass, Keys } from "./metal_graphics";

// ==================== Cube Geometry ====================

class CubeGeometry {
    vertexBuffer: VertexBuffer;
    indexBuffer: IndexBuffer;
    indexCount: int;
}

// Face colors for each side of the cube
class FaceColors {
    front: Vec4;   // Blue
    back: Vec4;    // Green
    top: Vec4;     // Red
    bottom: Vec4;  // Yellow
    right: Vec4;   // Orange
    left: Vec4;    // Purple
    
    static defaults(): FaceColors {
        return FaceColors {
            front: Vec4.create(0.2, 0.4, 0.9, 1.0),
            back: Vec4.create(0.2, 0.8, 0.3, 1.0),
            top: Vec4.create(0.9, 0.2, 0.2, 1.0),
            bottom: Vec4.create(0.9, 0.9, 0.2, 1.0),
            right: Vec4.create(0.9, 0.5, 0.1, 1.0),
            left: Vec4.create(0.6, 0.2, 0.8, 1.0)
        };
    }
}

// Vertex layout: position (vec3) + normal (vec3) + color (vec4)
const VERTEX_SIZE = 40;  // 3*4 + 3*4 + 4*4 = 40 bytes

function writeVertex(vertexBuffer: VertexBuffer, offset: int, pos: Vec3, norm: Vec3, col: Vec4) {
    vertexBuffer.setVec3(offset, pos);
    vertexBuffer.setVec3(offset + 12, norm);
    vertexBuffer.setVec4(offset + 24, col);
}

function createCubeGeometry(size: float): CubeGeometry {
    readonly s = size / 2.0;
    readonly colors = FaceColors.defaults();

    // Create vertex buffer: 24 vertices (4 per face * 6 faces)
    // VERTEX_SIZE = 12 (pos) + 12 (normal) + 16 (color) = 40 bytes
    let vertexBuffer = VertexBuffer.create(24 * VERTEX_SIZE);
    let offset: int = 0;

    // Front face (+Z)
    readonly frontNormal = Vec3.create(0.0, 0.0, 1.0);
    writeVertex(vertexBuffer, offset, Vec3.create(-s, -s, s), frontNormal, colors.front); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, -s, s), frontNormal, colors.front); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, s, s), frontNormal, colors.front); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(-s, s, s), frontNormal, colors.front); offset = offset + VERTEX_SIZE;

    // Back face (-Z)
    readonly backNormal = Vec3.create(0.0, 0.0, -1.0);
    writeVertex(vertexBuffer, offset, Vec3.create(s, -s, -s), backNormal, colors.back); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(-s, -s, -s), backNormal, colors.back); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(-s, s, -s), backNormal, colors.back); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, s, -s), backNormal, colors.back); offset = offset + VERTEX_SIZE;

    // Top face (+Y)
    readonly topNormal = Vec3.create(0.0, 1.0, 0.0);
    writeVertex(vertexBuffer, offset, Vec3.create(-s, s, s), topNormal, colors.top); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, s, s), topNormal, colors.top); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, s, -s), topNormal, colors.top); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(-s, s, -s), topNormal, colors.top); offset = offset + VERTEX_SIZE;

    // Bottom face (-Y)
    readonly bottomNormal = Vec3.create(0.0, -1.0, 0.0);
    writeVertex(vertexBuffer, offset, Vec3.create(-s, -s, -s), bottomNormal, colors.bottom); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, -s, -s), bottomNormal, colors.bottom); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, -s, s), bottomNormal, colors.bottom); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(-s, -s, s), bottomNormal, colors.bottom); offset = offset + VERTEX_SIZE;

    // Right face (+X)
    readonly rightNormal = Vec3.create(1.0, 0.0, 0.0);
    writeVertex(vertexBuffer, offset, Vec3.create(s, -s, s), rightNormal, colors.right); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, -s, -s), rightNormal, colors.right); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, s, -s), rightNormal, colors.right); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(s, s, s), rightNormal, colors.right); offset = offset + VERTEX_SIZE;

    // Left face (-X)
    readonly leftNormal = Vec3.create(-1.0, 0.0, 0.0);
    writeVertex(vertexBuffer, offset, Vec3.create(-s, -s, -s), leftNormal, colors.left); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(-s, -s, s), leftNormal, colors.left); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(-s, s, s), leftNormal, colors.left); offset = offset + VERTEX_SIZE;
    writeVertex(vertexBuffer, offset, Vec3.create(-s, s, -s), leftNormal, colors.left); offset = offset + VERTEX_SIZE;

    // Create index buffer (6 faces * 2 triangles * 3 indices)
    let indexBuffer = IndexBuffer.create(36);
    let idx: int = 0;
    
    // Front, Back, Top, Bottom, Right, Left faces
    for (let face = 0; face < 6; face = face + 1) {
        readonly base = face * 4;
        indexBuffer.setIndex(idx, base + 0); idx = idx + 1;
        indexBuffer.setIndex(idx, base + 1); idx = idx + 1;
        indexBuffer.setIndex(idx, base + 2); idx = idx + 1;
        indexBuffer.setIndex(idx, base + 0); idx = idx + 1;
        indexBuffer.setIndex(idx, base + 2); idx = idx + 1;
        indexBuffer.setIndex(idx, base + 3); idx = idx + 1;
    }

    return CubeGeometry {
        vertexBuffer,
        indexBuffer,
        indexCount: 36
    };
}

// ==================== Scene State ====================

class SceneState {
    rotationX: float = 0.0;
    rotationY: float = 0.0;
    rotationZ: float = 0.0;
    
    speedX: float = 0.5;
    speedY: float = 0.8;
    speedZ: float = 0.3;
    
    cameraDistance: float = 5.0;
    
    update(deltaTime: float): void {
        this.rotationX = this.rotationX + this.speedX * deltaTime;
        this.rotationY = this.rotationY + this.speedY * deltaTime;
        this.rotationZ = this.rotationZ + this.speedZ * deltaTime;
        
        readonly twoPi: float = 6.28318530718;
        if (this.rotationX > twoPi) {
            this.rotationX = this.rotationX - twoPi;
        }
        if (this.rotationY > twoPi) {
            this.rotationY = this.rotationY - twoPi;
        }
        if (this.rotationZ > twoPi) {
            this.rotationZ = this.rotationZ - twoPi;
        }
    }
    
    getModelMatrix(): Mat4 {
        readonly rx = Mat4.rotationX(this.rotationX);
        readonly ry = Mat4.rotationY(this.rotationY);
        readonly rz = Mat4.rotationZ(this.rotationZ);
        
        return rz.multiply(ry.multiply(rx));
    }
    
    getViewMatrix(): Mat4 {
        readonly eye = Vec3.create(0.0, 0.0, this.cameraDistance);
        readonly center = Vec3.create(0.0, 0.0, 0.0);
        readonly up = Vec3.create(0.0, 1.0, 0.0);
        
        return Mat4.lookAt(eye, center, up);
    }
    
    getProjectionMatrix(width: int, height: int): Mat4 {
        readonly aspect: float = float(width) / float(height);
        readonly fovY: float = 0.785398163;
        readonly nearZ: float = 0.1;
        readonly farZ: float = 100.0;
        
        return Mat4.perspective(fovY, aspect, nearZ, farZ);
    }
}

// ==================== Main Application ====================

function main(): int {
    println("Starting Rotating Cube Demo...");
    
    readonly app = Application.create();
    
    if (!app.initialize(800, 600, "Rotating Cube - Doof/SDL3/Metal")) {
        println("Failed to initialize application");
        return 1;
    }
    
    readonly renderer = app.getRenderer();
    
    // Create cube geometry using raw buffers
    readonly cube = createCubeGeometry(1.5);
    
    println("Created vertex buffer: " + string(cube.vertexBuffer.getSize()) + " bytes");
    println("Created index buffer: " + string(cube.indexBuffer.getIndexCount()) + " indices");
    
    let scene = SceneState {};
    
    println("Entering main loop. Press ESC to exit.");
    println("Use WASD to adjust rotation speeds.");
    
    // Main loop
    while (app.pollEvents()) {
        readonly dt = app.getDeltaTime();
        
        // Handle input
        if (app.isKeyPressed(Keys.W)) {
            scene.speedX = scene.speedX + dt;
        }
        if (app.isKeyPressed(Keys.S)) {
            scene.speedX = scene.speedX - dt;
        }
        if (app.isKeyPressed(Keys.A)) {
            scene.speedY = scene.speedY - dt;
        }
        if (app.isKeyPressed(Keys.D)) {
            scene.speedY = scene.speedY + dt;
        }
        
        scene.update(dt);
        
        readonly width = renderer.getWindowWidth();
        readonly height = renderer.getWindowHeight();
        
        readonly pass = renderer.beginFrame();
        
        pass.setProjectionMatrix(scene.getProjectionMatrix(width, height));
        pass.setViewMatrix(scene.getViewMatrix());
        pass.setModelMatrix(scene.getModelMatrix());
        
        pass.setVertexBuffer(cube.vertexBuffer, VERTEX_SIZE);
        pass.setIndexBuffer(cube.indexBuffer);
        pass.drawIndexed(cube.indexCount, 0);
        
        renderer.endFrame();
    }
    
    println("Shutting down...");
    app.shutdown();
    
    return 0;
}
