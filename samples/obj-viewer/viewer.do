import { PI, sin, cos, sqrt, min, clamp } from "std/math"
import { ObjError, ObjFace, ObjModel, Vec3, parseObj } from "./obj"

export import class NativeLineViewer from "./native_obj_viewer.hpp" as doof_obj_viewer::NativeLineViewer {
  static create(title: string, width: int, height: int): Result<NativeLineViewer, string>
  isOpen(): bool
  pollEvents(): void
  width(): int
  height(): int
  setTitle(title: string): void
  clear(r: int, g: int, b: int): void
  drawLine(x0: float, y0: float, x1: float, y1: float, r: int, g: int, b: int): void
  drawDepthLine(x0: float, y0: float, z0: float, x1: float, y1: float, z1: float, r: int, g: int, b: int): void
  drawTriangle(x0: float, y0: float, z0: float, x1: float, y1: float, z1: float, x2: float, y2: float, z2: float, r: int, g: int, b: int): void
  present(): void
  delay(ms: int): void
  close(): void
  consumeOrbitX(): float
  consumeOrbitY(): float
  consumePanX(): float
  consumePanY(): float
  consumeZoom(): float
  consumeResetRequested(): bool
}

export import function readTextFile(path: string): Result<string, string> from "./native_obj_viewer.hpp" as doof_obj_viewer::readTextFile

class ScreenPoint {
  x: float = 0.0f
  y: float = 0.0f
  depth: float = 0.0f
  visible: bool = false
}

class FaceShading {
  red: int = 0
  green: int = 0
  blue: int = 0
  wireRed: int = 0
  wireGreen: int = 0
  wireBlue: int = 0
}

class ViewerState {
  yaw: float = 0.6283f
  pitch: float = -0.3770f
  distance: float = 4.0f
  panX: float = 0.0f
  panY: float = 0.0f
  autoSpin: bool = true
}

function formatObjError(error: ObjError): string {
  return error.message
}

function fileBasename(path: string): string {
  let index = path.length - 1
  while index >= 0 {
    ch := path.charAt(index)
    if ch == "/" || ch == "\\" {
      return path.slice(index + 1)
    }
    index -= 1
  }
  return path
}

function buildWindowTitle(model: ObjModel, path: string): string {
  name := fileBasename(path)
  return `Doof OBJ Viewer - ${name} (${model.vertices.length} vertices, ${model.faces.length} faces)`
}

function restoreViewerState(state: ViewerState): void {
  state.yaw = float(PI) * 0.2f
  state.pitch = -float(PI) * 0.12f
  state.distance = 4.0f
  state.panX = 0.0f
  state.panY = 0.0f
  state.autoSpin = true
}

function transformPoint(point: Vec3, state: ViewerState): Vec3 {
  yawCos := cos(state.yaw)
  yawSin := sin(state.yaw)
  pitchCos := cos(state.pitch)
  pitchSin := sin(state.pitch)

  rotatedX := point.x * yawCos - point.z * yawSin
  rotatedZ := point.x * yawSin + point.z * yawCos
  rotatedY := point.y * pitchCos - rotatedZ * pitchSin
  cameraZ := point.y * pitchSin + rotatedZ * pitchCos

  return Vec3 {
    x: rotatedX + state.panX,
    y: rotatedY + state.panY,
    z: cameraZ + state.distance,
  }
}

function transformVertex(model: ObjModel, vertex: Vec3, state: ViewerState): Vec3 {
  normalized := Vec3 {
    x: (vertex.x - model.center.x) / model.extent,
    y: (vertex.y - model.center.y) / model.extent,
    z: (vertex.z - model.center.z) / model.extent,
  }
  return transformPoint(normalized, state)
}

function projectPoint(point: Vec3, pixelWidth: float, pixelHeight: float): ScreenPoint {
  if point.z <= 0.2f {
    return ScreenPoint {
      depth: point.z,
      visible: false,
    }
  }

  projectionScale := min(pixelWidth, pixelHeight) * 0.42f / point.z
  return ScreenPoint {
    x: pixelWidth * 0.5f + point.x * projectionScale,
    y: pixelHeight * 0.5f - point.y * projectionScale,
    depth: point.z,
    visible: true,
  }
}

function averageFaceDepth(face: ObjFace, vertices: Vec3[]): float {
  let depth = 0.0f
  for index of face.indices {
    depth += vertices[index].z
  }
  return depth / float(face.indices.length)
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  abX := b.x - a.x
  abY := b.y - a.y
  abZ := b.z - a.z
  acX := c.x - a.x
  acY := c.y - a.y
  acZ := c.z - a.z
  return Vec3 {
    x: abY * acZ - abZ * acY,
    y: abZ * acX - abX * acZ,
    z: abX * acY - abY * acX,
  }
}

function normalizeOrZero(vector: Vec3): Vec3 {
  lengthSquared := vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
  if lengthSquared <= 0.000001f {
    return Vec3 {}
  }

  inverseLength := 1.0f / sqrt(lengthSquared)
  return Vec3 {
    x: vector.x * inverseLength,
    y: vector.y * inverseLength,
    z: vector.z * inverseLength,
  }
}

function dot(a: Vec3, b: Vec3): float {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function faceCenter(face: ObjFace, transformed: Vec3[]): Vec3 {
  let center = Vec3 {}
  for index of face.indices {
    center.x += transformed[index].x
    center.y += transformed[index].y
    center.z += transformed[index].z
  }

  scale := 1.0f / float(face.indices.length)
  return Vec3 {
    x: center.x * scale,
    y: center.y * scale,
    z: center.z * scale,
  }
}

function isFrontFacingFace(face: ObjFace, transformed: Vec3[]): bool {
  if face.indices.length < 3 {
    return false
  }

  first := transformed[face.indices[0]]
  second := transformed[face.indices[1]]
  third := transformed[face.indices[2]]
  normal := faceNormal(first, second, third)
  center := faceCenter(face, transformed)
  return dot(normal, center) < 0.0f
}

function shadeFace(face: ObjFace, transformed: Vec3[]): FaceShading {
  first := transformed[face.indices[0]]
  second := transformed[face.indices[1]]
  third := transformed[face.indices[2]]
  let normal = faceNormal(first, second, third)
  center := faceCenter(face, transformed)
  if dot(normal, center) > 0.0f {
    normal = Vec3 {
      x: -normal.x,
      y: -normal.y,
      z: -normal.z,
    }
  }

  unitNormal := normalizeOrZero(normal)
  lightDirection := normalizeOrZero(Vec3 {
    x: -0.45f,
    y: 0.7f,
    z: -0.55f,
  })
  diffuse := clamp(dot(unitNormal, lightDirection), 0.0f, 1.0f)
  averageDepth := averageFaceDepth(face, transformed)
  depthFade := clamp(4.0f / averageDepth, 0.25f, 1.0f)
  lightMix := 0.22f + 0.78f * diffuse
  brightness := depthFade * lightMix
  return FaceShading {
    red: int(28.0f + 132.0f * brightness),
    green: int(70.0f + 150.0f * brightness),
    blue: int(95.0f + 145.0f * brightness),
    wireRed: int(12.0f + 38.0f * brightness),
    wireGreen: int(22.0f + 48.0f * brightness),
    wireBlue: int(28.0f + 52.0f * brightness),
  }
}

function drawAxes(viewer: NativeLineViewer, state: ViewerState, pixelWidth: float, pixelHeight: float): void {
  origin := projectPoint(transformPoint(Vec3 {}, state), pixelWidth, pixelHeight)
  xPoint := projectPoint(transformPoint(Vec3 { x: 1.4f }, state), pixelWidth, pixelHeight)
  yPoint := projectPoint(transformPoint(Vec3 { y: 1.4f }, state), pixelWidth, pixelHeight)
  zPoint := projectPoint(transformPoint(Vec3 { z: 1.4f }, state), pixelWidth, pixelHeight)

  if origin.visible && xPoint.visible {
    viewer.drawLine(origin.x, origin.y, xPoint.x, xPoint.y, 210, 90, 90)
  }
  if origin.visible && yPoint.visible {
    viewer.drawLine(origin.x, origin.y, yPoint.x, yPoint.y, 90, 210, 130)
  }
  if origin.visible && zPoint.visible {
    viewer.drawLine(origin.x, origin.y, zPoint.x, zPoint.y, 90, 140, 220)
  }
}

function renderFrame(viewer: NativeLineViewer, model: ObjModel, state: ViewerState): void {
  pixelWidth := float(viewer.width())
  pixelHeight := float(viewer.height())

  viewer.clear(11, 16, 23)

  transformed: Vec3[] := []
  projected: ScreenPoint[] := []
  for vertex of model.vertices {
    world := transformVertex(model, vertex, state)
    transformed.push(world)
    projected.push(projectPoint(world, pixelWidth, pixelHeight))
  }

  drawAxes(viewer, state, pixelWidth, pixelHeight)

  for face of model.faces {
    if face.indices.length < 3 {
      continue
    }

    let allVisible = true
    for index of face.indices {
      if !projected[index].visible {
        allVisible = false
      }
    }
    if !allVisible || !isFrontFacingFace(face, transformed) {
      continue
    }

    shading := shadeFace(face, transformed)
    for triIndex of 1..<(face.indices.length - 1) {
      indexA := face.indices[0]
      indexB := face.indices[triIndex]
      indexC := face.indices[triIndex + 1]

      pointA := projected[indexA]
      pointB := projected[indexB]
      pointC := projected[indexC]
      if !pointA.visible || !pointB.visible || !pointC.visible {
        continue
      }

      viewer.drawTriangle(
        pointA.x,
        pointA.y,
        pointA.depth,
        pointB.x,
        pointB.y,
        pointB.depth,
        pointC.x,
        pointC.y,
        pointC.depth,
        shading.red,
        shading.green,
        shading.blue,
      )
    }

    for edgeIndex of 0..<face.indices.length {
      nextEdgeIndex := if edgeIndex + 1 < face.indices.length then edgeIndex + 1 else 0
      startPoint := projected[face.indices[edgeIndex]]
      endPoint := projected[face.indices[nextEdgeIndex]]
      viewer.drawDepthLine(
        startPoint.x,
        startPoint.y,
        startPoint.depth,
        endPoint.x,
        endPoint.y,
        endPoint.depth,
        shading.wireRed,
        shading.wireGreen,
        shading.wireBlue,
      )
    }
  }
}

function loadModel(path: string): Result<ObjModel, string> {
  try text := readTextFile(path)
  return case parseObj(text, path) {
    s: Success -> Success { value: s.value },
    f: Failure -> Failure { error: formatObjError(f.error) }
  }
}

function openViewer(title: string): Result<NativeLineViewer, string> {
  return NativeLineViewer.create(title, 1280, 800)
}

function viewLoop(viewer: NativeLineViewer, model: ObjModel): void {
  state := ViewerState {}

  while viewer.isOpen() {
    viewer.pollEvents()

    if viewer.consumeResetRequested() {
      restoreViewerState(state)
    }

    orbitX := viewer.consumeOrbitX()
    orbitY := viewer.consumeOrbitY()
    panX := viewer.consumePanX()
    panY := viewer.consumePanY()
    zoom := viewer.consumeZoom()

    if orbitX != 0.0f || orbitY != 0.0f || panX != 0.0f || panY != 0.0f || zoom != 0.0f {
      state.autoSpin = false
    }

    state.yaw += orbitX
    state.pitch = clamp(state.pitch + orbitY, -float(PI) * 0.45f, float(PI) * 0.45f)
    state.panX += panX * state.distance * 0.9f
    state.panY += panY * state.distance * 0.9f

    if zoom != 0.0f {
      let zoomScale = 1.0f - zoom * 0.12f
      if zoomScale < 0.5f {
        zoomScale = 0.5f
      }
      state.distance = clamp(state.distance * zoomScale, 1.5f, 20.0f)
    }

    if state.autoSpin {
      state.yaw += 0.01f
    }

    renderFrame(viewer, model, state)
    viewer.present()
    viewer.delay(16)
  }
}

export function runViewer(path: string): Result<void, string> {
  try model := loadModel(path)
  try viewer := openViewer(buildWindowTitle(model, path))
  viewLoop(viewer, model)
  viewer.close()
  return Success()
}