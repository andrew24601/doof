# Rotating Cube Demo

A demonstration of using Doof with SDL3 and Metal on macOS. The majority of the application logic is written in Doof, with C++ bridging code for the SDL3/Metal graphics layer.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  rotating_cube_v2.do (Doof)                     │
│  - Cube geometry generation                                     │
│  - Scene state management (rotation, camera)                    │
│  - Main loop with low-level draw calls                          │
│  - Matrix calculations                                          │
│  - Keyboard input handling                                      │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ import
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                 metal_graphics.do (Doof)                        │
│  - Extern class declarations for graphics API                   │
│  - Vec3, Vec4, Mat4 math types                                  │
│  - Vertex, VertexBuffer, IndexBuffer data types                 │
│  - RenderPass for low-level draw commands                       │
│  - MetalRenderer and Application                                │
│  - Keys for keyboard input                                      │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ C++ implementation
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  metal_bridge.h (C++ Header)                    │
│  - shared_ptr wrappers matching extern class declarations       │
│  - Type adapters for Doof <-> SDL/Metal types                   │
│  - Buffer handle classes (VertexBuffer, IndexBuffer)            │
│  - RenderPass with draw commands                                │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│             sdl_metal_bridge.h/.mm (C++/Obj-C++)                │
│  - SDL3 window management                                       │
│  - Metal device/pipeline setup                                  │
│  - Low-level rendering commands                                 │
│  - Matrix math utilities                                        │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    shaders.metal (MSL)                          │
│  - Vertex shader with MVP transform                             │
│  - Fragment shader with basic lighting                          │
└─────────────────────────────────────────────────────────────────┘
```

## Key Improvements (v2)

1. **Modular Design**: Extern class declarations moved to `metal_graphics.do` for reuse
2. **Low-Level API**: Direct access to vertex/index buffers and draw calls
3. **RenderPass Abstraction**: Frame rendering via explicit render pass objects
4. **Input Handling**: Keyboard input for interactive rotation speed control
5. **Cleaner Bridge**: Unified `metal_bridge.h` with consistent shared_ptr wrappers

## Prerequisites

1. **macOS** with Metal support (macOS 10.14+)
2. **Xcode Command Line Tools** (`xcode-select --install`)
3. **SDL3** installed via Homebrew or built from source:
   ```bash
   brew install sdl3
   ```
4. **Node.js** for running the Doof transpiler
5. **CMake** 3.20+ (`brew install cmake`)

## Building

### 1. Transpile the Doof code

From the repository root:

```bash
npx tsx src/cli.ts samples/cube/rotating_cube_v2.do --output-dir samples/cube/generated
```

### 2. Build with CMake

```bash
cd samples/cube
mkdir -p build && cd build
cmake ..
cmake --build .
```

### 3. Run

```bash
./rotating_cube
```

Or use the build script:

```bash
chmod +x build.sh
./build.sh
```

## Files

| File | Description |
|------|-------------|
| `rotating_cube_v2.do` | Main application logic in Doof |
| `metal_graphics.do` | Extern class declarations (imported by main) |
| `metal_bridge.h` | C++ wrappers matching Doof extern classes |
| `sdl_metal_bridge.h` | Low-level SDL3/Metal interface |
| `sdl_metal_bridge.mm` | Objective-C++ implementation |
| `shaders.metal` | Metal shader source |
| `CMakeLists.txt` | CMake build configuration |
| `build.sh` | Build automation script |

## Controls

- **ESC**: Exit the application
- **W/S**: Increase/decrease X rotation speed
- **A/D**: Decrease/increase Y rotation speed

## How It Works

1. **metal_graphics.do** exports extern class declarations:
   - Math types: `Vec3`, `Vec4`, `Mat4`
   - Graphics types: `Vertex`, `VertexBuffer`, `IndexBuffer`
   - Rendering: `RenderPass`, `MetalRenderer`, `Application`
   - Input: `Keys` with keyboard constants

2. **rotating_cube_v2.do** imports and uses the API:
   - Creates geometry with `createCubeGeometry()`
   - Creates GPU buffers via `renderer.createVertexBuffer/IndexBuffer()`
   - Gets a `RenderPass` from `renderer.beginFrame()`
   - Issues low-level draw calls via `pass.drawIndexed()`

3. **metal_bridge.h** provides C++ implementations:
   - `shared_ptr<T>` wrappers for each extern class
   - Conversion between Doof arrays and `std::vector`
   - `RenderPass` manages draw state and issues Metal commands

4. **sdl_metal_bridge.mm** handles platform specifics:
   - SDL3 window and event loop
   - Metal device, command queue, and pipeline
   - Buffer upload and draw encoding

## Extending

To add new graphics features:

1. Add declarations to `metal_graphics.do`
2. Implement the wrapper class in `metal_bridge.h`
3. Add low-level implementation in `sdl_metal_bridge.mm` if needed

Example: Adding texture support would involve:
- `extern class Texture { ... }` in metal_graphics.do
- `class Texture` wrapper in metal_bridge.h
- Texture loading and binding in sdl_metal_bridge.mm
