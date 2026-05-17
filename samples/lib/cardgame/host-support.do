import { sqrt } from "./math"
import { NativeBoardgameKey } from "./types"
import { Camera, CameraFrame, applyCameraFrame } from "./camera-support"

export class HostInput {
  mouseDown: bool = false
  isDragging: bool = false
  mouseDownX: float = 0.0f
  mouseDownY: float = 0.0f
  lastMouseX: float = 0.0f
  lastMouseY: float = 0.0f
  wasAnimating: bool = false
  keyW: bool = false
  keyA: bool = false
  keyS: bool = false
  keyD: bool = false
  keyQ: bool = false
  keyE: bool = false

  lastFrameScale: float = 0.0f
  lastFramePanX: float = 0.0f
  lastFramePanY: float = 0.0f
  lastPitch: float = 0.0f
  lastTargetX: float = 0.0f
  lastTargetZ: float = 0.0f
}

export function applyInitialCamera(
  camera: Camera,
  input: HostInput,
  frame: CameraFrame
): void {
  applyCameraFrame(camera, frame)
  input.lastFrameScale = frame.scale
  input.lastFramePanX = frame.panX
  input.lastFramePanY = frame.panY
  input.lastPitch = frame.pitch
  input.lastTargetX = frame.targetX
  input.lastTargetZ = frame.targetZ
}

export function beginPointerState(input: HostInput, x: float, y: float): void {
  input.mouseDown = true
  input.isDragging = false
  input.mouseDownX = x
  input.mouseDownY = y
  input.lastMouseX = x
  input.lastMouseY = y
}

export function clearPointerState(input: HostInput): bool {
  if !input.mouseDown && !input.isDragging {
    return false
  }

  input.mouseDown = false
  input.isDragging = false
  return true
}

export function updatePointerState(input: HostInput, x: float, y: float): void {
  input.lastMouseX = x
  input.lastMouseY = y
}

export function pointerTravel(input: HostInput, x: float, y: float): float {
  return sqrt(
    (x - input.mouseDownX) * (x - input.mouseDownX) +
    (y - input.mouseDownY) * (y - input.mouseDownY)
  )
}

export function captureCameraState(input: HostInput, camera: Camera): void {
  input.lastFrameScale = camera.frameScale
  input.lastFramePanX = camera.framePanX
  input.lastFramePanY = camera.framePanY
  input.lastPitch = camera.pitch
  input.lastTargetX = camera.targetX
  input.lastTargetZ = camera.targetZ
}

export function setDebugKeyState(input: HostInput, key: NativeBoardgameKey, pressed: bool): bool {
  case key {
    .W -> { input.keyW = pressed }
    .A -> { input.keyA = pressed }
    .S -> { input.keyS = pressed }
    .D -> { input.keyD = pressed }
    .Q -> { input.keyQ = pressed }
    .E -> { input.keyE = pressed }
    _ -> { return false }
  }

  return true
}

export function debugMoveX(input: HostInput): float {
  let value = 0.0f
  if input.keyA { value -= 1.0f }
  if input.keyD { value += 1.0f }
  return value
}

export function debugMoveZ(input: HostInput): float {
  let value = 0.0f
  if input.keyW { value -= 1.0f }
  if input.keyS { value += 1.0f }
  return value
}

export function debugZoomDirection(input: HostInput): float {
  let value = 0.0f
  if input.keyQ { value += 1.0f }
  if input.keyE { value -= 1.0f }
  return value
}