import { PI, sin, cos, min, clamp } from "./math"
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
  state.yaw = PI * 0.2f
  state.pitch = -PI * 0.12f
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

function faceNormalZ(a: Vec3, b: Vec3, c: Vec3): float {
  abX := b.x - a.x
  abY := b.y - a.y
  acX := c.x - a.x
  acY := c.y - a.y
  return abX * acY - abY * acX
}

function averageFaceDepth(face: ObjFace, vertices: Vec3[]): float {
  let depth = 0.0f
  for index of face.indices {
    depth += vertices[index].z
  }
  return depth / float(face.indices.length)
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

    first := transformed[face.indices[0]]
    second := transformed[face.indices[1]]
    third := transformed[face.indices[2]]
    if first.z <= 0.2f || second.z <= 0.2f || third.z <= 0.2f {
      continue
    }

    normalZ := faceNormalZ(first, second, third)
    if normalZ >= 0.0f {
      continue
    }

    let allVisible = true
    for index of face.indices {
      if !projected[index].visible {
        allVisible = false
      }
    }
    if !allVisible {
      continue
    }

    averageDepth := averageFaceDepth(face, transformed)
    depthFade := clamp(4.0f / averageDepth, 0.25f, 1.0f)
    red := int(35.0f + 95.0f * depthFade)
    green := int(105.0f + 115.0f * depthFade)
    blue := int(155.0f + 85.0f * depthFade)

    for edgeIndex of 0..<face.indices.length {
      nextIndex := if edgeIndex + 1 < face.indices.length then edgeIndex + 1 else 0
      startPoint := projected[face.indices[edgeIndex]]
      endPoint := projected[face.indices[nextIndex]]
      viewer.drawLine(startPoint.x, startPoint.y, endPoint.x, endPoint.y, red, green, blue)
    }
  }
}

function loadModel(path: string): Result<ObjModel, string> {
  try text := readTextFile(path)
  return case parseObj(text, path) {
    s: Success => Success { value: s.value },
    f: Failure => Failure { error: formatObjError(f.error) }
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
    state.pitch = clamp(state.pitch + orbitY, -PI * 0.45f, PI * 0.45f)
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