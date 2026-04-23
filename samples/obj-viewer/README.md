# OBJ Viewer in Doof

A small interactive 3D OBJ wireframe viewer with the parsing, camera math, projection, and render ordering written in Doof. The native side is intentionally narrow: a single SDL3-backed header handles file loading, a resizable window, and line drawing.

## Files

- `main.do` picks a model path and launches the viewer.
- `obj.do` parses a practical subset of Wavefront OBJ: `v` and `f` records, including negative face indices.
- `viewer.do` owns the camera, transforms vertices, performs perspective projection, and draws the wireframe.
- `native_obj_viewer.hpp` is the tiny SDL3 bridge for windowing, input, and lines.
- `doof.json` wires native header copying and SDL3 pkg-config metadata so `doof run` works from the package directory.
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

## Run

Build the compiler first from the repository root if needed:

```bash
npm install
npm run build
```

Run the sample directly:

```bash
doof run samples/obj-viewer
```

Build only:

```bash
doof build samples/obj-viewer
```

Run the built binary with the checked-in cube model:

```bash
samples/obj-viewer/build/a.out samples/obj-viewer/models/cube.obj
```

Run a different OBJ file:

```bash
samples/obj-viewer/build/a.out /absolute/path/to/model.obj
```

The package manifest resolves SDL3 through `pkg-config sdl3` on macOS and Linux.

If you prefer the helper script, it now wraps package-based build output:

```bash
bash samples/obj-viewer/build.sh --run
```

## Test

The parser test does not require SDL:

```bash
node dist/cli.js test samples/obj-viewer/obj.test.do
```