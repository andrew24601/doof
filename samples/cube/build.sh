#!/bin/bash
# Build script for the rotating cube demo
# Run from the samples/cube directory

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "=== Rotating Cube Build Script ==="
echo ""

# Step 1: Transpile doof to C++
echo "Step 1: Transpiling doof to C++..."
cd "$PROJECT_ROOT"
mkdir -p samples/cube/generated

# Run the transpiler (both files for multi-module compilation)
npx tsx src/cli.ts samples/cube/metal_graphics.do samples/cube/rotating_cube_v2.do -o samples/cube/generated

echo "Transpilation complete."
echo ""

# Step 2: Build with CMake
echo "Step 2: Building with CMake..."
cd "$SCRIPT_DIR"
mkdir -p build
cd build

# Configure
cmake .. -DCMAKE_BUILD_TYPE=Release

# Build
cmake --build . --config Release

echo ""
echo "=== Build Complete ==="
echo ""
echo "To run the demo:"
echo "  cd samples/cube/build"
echo "  ./rotating_cube"
echo ""
echo "Controls:"
echo "  ESC - Exit the demo"
echo "  W/S - Adjust X rotation speed"
echo "  A/D - Adjust Y rotation speed"
