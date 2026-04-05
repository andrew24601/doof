# OBJ Viewer in Doof

A small interactive 3D OBJ wireframe viewer with the parsing, camera math, projection, and render ordering written in Doof. The native side is intentionally narrow: a single SDL3-backed header handles file loading, a resizable window, and line drawing.

## Files

- `main.do` picks a model path and launches the viewer.
- `obj.do` parses a practical subset of Wavefront OBJ: `v` and `f` records, including negative face indices.
- `viewer.do` owns the camera, transforms vertices, performs perspective projection, and draws the wireframe.
- `native_obj_viewer.hpp` is the tiny SDL3 bridge for windowing, input, and lines.
- `obj.test.do` exercises the OBJ parser without depending on SDL.
- `models/cube.obj` is a small built-in model so the sample runs immediately.

## Controls

- Left drag: orbit
- Right drag: pan
- Mouse wheel: zoom
- `R`: reset camera
- `Esc`: quit

## Supported OBJ Surface

The sample intentionally keeps the parser small and readable. It supports:

- `v x y z`
- `f ...` polygons with `i`, `i/j`, `i//k`, or `i/j/k` elements
- Negative face indices such as `f -4 -3 -2 -1`

It ignores materials, groups, smoothing markers, texture coordinates, and normals. Those lines are skipped rather than treated as hard errors.

## Build

Build the compiler first from the repository root if needed:

```bash
npm install
npm run build
```

Then build the sample:

```bash
bash samples/obj-viewer/build.sh
```

Run the built binary with the checked-in cube model:

```bash
bash samples/obj-viewer/build.sh --run
```

Run a different OBJ file:

```bash
build-obj-viewer/a.out /absolute/path/to/model.obj
```

The build helper looks for SDL3 through `pkg-config sdl3` first and falls back to a Homebrew install on macOS.

## Test

The parser test does not require SDL:

```bash
node dist/cli.js test samples/obj-viewer/obj.test.do
```