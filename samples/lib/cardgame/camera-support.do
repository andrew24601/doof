import { Mat4 } from "./matrix"
import { sin, cos, sqrt, abs, min, max, clamp, PI } from "./math"

export class Camera {
  targetX: float = 0.0f
  targetY: float = 0.0f
  targetZ: float = 0.0f
  distance: float = 700.0f
  pitch: float = 0.7854f

  frameScale: float = 1.0f
  framePanX: float = 0.0f
  framePanY: float = 0.0f

  targetVelocityX: float = 0.0f
  targetVelocityZ: float = 0.0f
  pitchVelocity: float = 0.0f
  scaleVelocity: float = 0.0f
  panXVelocity: float = 0.0f
  panYVelocity: float = 0.0f
}

export class CameraFrame {
  targetX: float = 0.0f
  targetY: float = 0.0f
  targetZ: float = 0.0f
  distance: float = 700.0f
  pitch: float = 0.7854f
  scale: float = 1.0f
  panX: float = 0.0f
  panY: float = 0.0f
}

export class BoundingBox {
  minX: float = 0.0f
  maxX: float = 0.0f
  minZ: float = 0.0f
  maxZ: float = 0.0f
}

export class WorldHit {
  x: float = 0.0f
  z: float = 0.0f
}

const CAMERA_MIN_PITCH: float = 1.0471976f
const CAMERA_MAX_PITCH: float = 1.4765485f
const CAMERA_MIN_DEPTH: float = 400.0f
const CAMERA_MAX_DEPTH: float = 600.0f
const CAMERA_DISTANCE: float = 700.0f
const CAMERA_NEAR_PLANE: float = 0.1f
const CAMERA_FAR_PLANE: float = 2000.0f
const CAMERA_VIEWPORT_USAGE: float = 0.96f
const CAMERA_TOP_PADDING: float = 0.15f
const CAMERA_MIN_SCALE: float = 0.5f
const CAMERA_MAX_SCALE: float = 3.0f

export function expandBounds(
  bounds: BoundingBox,
  px: float, pz: float,
  halfW: float, halfH: float
): void {
  if px - halfW < bounds.minX { bounds.minX = px - halfW }
  if px + halfW > bounds.maxX { bounds.maxX = px + halfW }
  if pz - halfH < bounds.minZ { bounds.minZ = pz - halfH }
  if pz + halfH > bounds.maxZ { bounds.maxZ = pz + halfH }
}

class SmoothResult {
  value: float = 0.0f
  velocity: float = 0.0f
}

function smoothDamp(
  current: float,
  target: float,
  velocity: float,
  smoothTime: float,
  deltaTime: float
): SmoothResult {
  st := if smoothTime < 0.0001f then 0.0001f else smoothTime

  omega := 2.0f / st
  x := omega * deltaTime
  expFactor := 1.0f / (1.0f + x + 0.48f * x * x + 0.235f * x * x * x)

  let change = current - target
  originalTo := target
  maxChange := 1000.0f * st
  if change > maxChange { change = maxChange }
  if change < -maxChange { change = -maxChange }

  adjustedTarget := current - change
  temp := (velocity + omega * change) * deltaTime
  newVelocity := (velocity - omega * temp) * expFactor
  let result = adjustedTarget + (change + temp) * expFactor

  overshoot := (originalTo - current > 0.0f) == (result > originalTo)
  if overshoot {
    result = originalTo
    return SmoothResult { value: result, velocity: (result - originalTo) / deltaTime }
  }

  return SmoothResult { value: result, velocity: newVelocity }
}

export function applyCameraFrame(camera: Camera, frame: CameraFrame): void {
  camera.targetX = frame.targetX
  camera.targetY = frame.targetY
  camera.targetZ = frame.targetZ
  camera.distance = frame.distance
  camera.pitch = frame.pitch
  camera.frameScale = frame.scale
  camera.framePanX = frame.panX
  camera.framePanY = frame.panY
}

export function updateAutoCamera(
  camera: Camera,
  target: CameraFrame,
  deltaTime: float,
  smoothTime: float
): bool {
  rTargetX := smoothDamp(camera.targetX, target.targetX, camera.targetVelocityX, smoothTime, deltaTime)
  camera.targetX = rTargetX.value
  camera.targetVelocityX = rTargetX.velocity

  rTargetZ := smoothDamp(camera.targetZ, target.targetZ, camera.targetVelocityZ, smoothTime, deltaTime)
  camera.targetZ = rTargetZ.value
  camera.targetVelocityZ = rTargetZ.velocity

  rPitch := smoothDamp(camera.pitch, target.pitch, camera.pitchVelocity, smoothTime, deltaTime)
  camera.pitch = rPitch.value
  camera.pitchVelocity = rPitch.velocity

  rScale := smoothDamp(camera.frameScale, target.scale, camera.scaleVelocity, smoothTime, deltaTime)
  camera.frameScale = rScale.value
  camera.scaleVelocity = rScale.velocity

  rPanX := smoothDamp(camera.framePanX, target.panX, camera.panXVelocity, smoothTime, deltaTime)
  camera.framePanX = rPanX.value
  camera.panXVelocity = rPanX.velocity

  rPanY := smoothDamp(camera.framePanY, target.panY, camera.panYVelocity, smoothTime, deltaTime)
  camera.framePanY = rPanY.value
  camera.panYVelocity = rPanY.velocity

  camera.distance = target.distance

  dTargetX := camera.targetX - target.targetX
  dTargetZ := camera.targetZ - target.targetZ
  dPitch := camera.pitch - target.pitch
  dScale := camera.frameScale - target.scale
  dPanX := camera.framePanX - target.panX
  dPanY := camera.framePanY - target.panY

  distSq := dTargetX * dTargetX +
             dTargetZ * dTargetZ +
             dPitch * dPitch * 100.0f +
             dScale * dScale +
             dPanX * dPanX +
             dPanY * dPanY

  return distSq > 0.0001f
}

export function hasCameraMoved(
  camera: Camera,
  lastFrameScale: float,
  lastFramePanX: float,
  lastFramePanY: float,
  lastPitch: float,
  lastTargetX: float,
  lastTargetZ: float
): bool {
  epsilon := 0.0001f
  dScale := abs(camera.frameScale - lastFrameScale)
  dPanX := abs(camera.framePanX - lastFramePanX)
  dPanY := abs(camera.framePanY - lastFramePanY)
  dPitch := abs(camera.pitch - lastPitch)
  dTargetX := abs(camera.targetX - lastTargetX)
  dTargetZ := abs(camera.targetZ - lastTargetZ)

  return dScale > epsilon || dPanX > epsilon || dPanY > epsilon ||
         dPitch > epsilon || dTargetX > epsilon || dTargetZ > epsilon
}

export function computeIdealFrame(
  bounds: BoundingBox,
  aspectRatio: float,
  fovY: float
): CameraFrame {
  frame := CameraFrame {}

  boundsDepth := bounds.maxZ - bounds.minZ
  let t = (boundsDepth - CAMERA_MIN_DEPTH) / (CAMERA_MAX_DEPTH - CAMERA_MIN_DEPTH)
  t = clamp(t, 0.0f, 1.0f)
  t = t * t * (3.0f - 2.0f * t)

  frame.pitch = CAMERA_MIN_PITCH + t * (CAMERA_MAX_PITCH - CAMERA_MIN_PITCH)
  frame.targetX = (bounds.minX + bounds.maxX) * 0.5f
  frame.targetY = 0.0f
  frame.targetZ = (bounds.minZ + bounds.maxZ) * 0.5f
  frame.distance = CAMERA_DISTANCE

  cameraX := frame.targetX
  cameraY := frame.distance * sin(frame.pitch)
  cameraZ := frame.targetZ - frame.distance * cos(frame.pitch)

  proj := Mat4.perspective(fovY, aspectRatio, CAMERA_NEAR_PLANE, CAMERA_FAR_PLANE)
  view := Mat4.lookAt(cameraX, cameraY, cameraZ, frame.targetX, frame.targetY, frame.targetZ)
  mvp := Mat4.multiply(proj, view)

  c0x := mvp.projectX(bounds.minX, 0.0f, bounds.minZ)
  c0y := mvp.projectY(bounds.minX, 0.0f, bounds.minZ)
  c1x := mvp.projectX(bounds.maxX, 0.0f, bounds.minZ)
  c1y := mvp.projectY(bounds.maxX, 0.0f, bounds.minZ)
  c2x := mvp.projectX(bounds.minX, 0.0f, bounds.maxZ)
  c2y := mvp.projectY(bounds.minX, 0.0f, bounds.maxZ)
  c3x := mvp.projectX(bounds.maxX, 0.0f, bounds.maxZ)
  c3y := mvp.projectY(bounds.maxX, 0.0f, bounds.maxZ)

  ndcMinX := min(min(c0x, c1x), min(c2x, c3x))
  ndcMaxX := max(max(c0x, c1x), max(c2x, c3x))
  ndcMinY := min(min(c0y, c1y), min(c2y, c3y))
  ndcMaxY := max(max(c0y, c1y), max(c2y, c3y))

  ndcWidth := ndcMaxX - ndcMinX
  ndcHeight := ndcMaxY - ndcMinY
  viewportSize := 2.0f * CAMERA_VIEWPORT_USAGE
  scaleX := viewportSize / ndcWidth
  scaleY := (viewportSize - CAMERA_TOP_PADDING) / ndcHeight
  frame.scale = clamp(min(scaleX, scaleY), CAMERA_MIN_SCALE, CAMERA_MAX_SCALE)

  ndcCenterX := (ndcMinX + ndcMaxX) * 0.5f
  ndcCenterY := (ndcMinY + ndcMaxY) * 0.5f
  frame.panX = -ndcCenterX * frame.scale
  frame.panY = -ndcCenterY * frame.scale - CAMERA_TOP_PADDING * 0.5f

  return frame
}

export function screenToWorld(
  camera: Camera,
  screenX: float,
  screenY: float,
  windowWidth: float,
  windowHeight: float,
  fovY: float
): WorldHit {
  aspect := windowWidth / windowHeight
  proj := Mat4.perspective(fovY, aspect, CAMERA_NEAR_PLANE, CAMERA_FAR_PLANE)

  cosPitch := cos(camera.pitch)
  sinPitch := sin(camera.pitch)
  view := Mat4.lookAt(
    camera.targetX,
    camera.targetY + camera.distance * sinPitch,
    camera.targetZ + camera.distance * cosPitch,
    camera.targetX, camera.targetY, camera.targetZ
  )

  mvp := Mat4.multiply(proj, view)
  inverseMvp := Mat4.inverse(mvp)

  let ndcX = (screenX / windowWidth) * 2.0f - 1.0f
  let ndcY = 1.0f - (screenY / windowHeight) * 2.0f
  ndcX = (ndcX - camera.framePanX) / camera.frameScale
  ndcY = (ndcY - camera.framePanY) / camera.frameScale

  nearX := inverseMvp.projectX(ndcX, ndcY, 0.0f)
  nearY := inverseMvp.projectY(ndcX, ndcY, 0.0f)
  nearZ := inverseMvp.projectZ(ndcX, ndcY, 0.0f)
  farX := inverseMvp.projectX(ndcX, ndcY, 1.0f)
  farY := inverseMvp.projectY(ndcX, ndcY, 1.0f)
  farZ := inverseMvp.projectZ(ndcX, ndcY, 1.0f)

  let dirX: float = farX - nearX
  let dirY: float = farY - nearY
  let dirZ: float = farZ - nearZ
  len := sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ)
  if len > 0.0001f {
    dirX = dirX / len
    dirY = dirY / len
    dirZ = dirZ / len
  }

  if abs(dirY) > 0.000001f {
    t := -nearY / dirY
    if t >= 0.0f {
      return WorldHit { x: nearX + dirX * t, z: nearZ + dirZ * t }
    }
  }

  return WorldHit {}
}

export function computeWorldMVP(
  camera: Camera,
  aspectRatio: float,
  fovY: float
): Mat4 {
  proj := Mat4.perspective(fovY, aspectRatio, CAMERA_NEAR_PLANE, CAMERA_FAR_PLANE)
  cosPitch := cos(camera.pitch)
  sinPitch := sin(camera.pitch)
  view := Mat4.lookAt(
    camera.targetX,
    camera.targetY + camera.distance * sinPitch,
    camera.targetZ + camera.distance * cosPitch,
    camera.targetX, camera.targetY, camera.targetZ
  )
  viewProjection := Mat4.multiply(proj, view)
  ft := Mat4.frameTransform(camera.frameScale, camera.framePanX, camera.framePanY)
  return Mat4.multiply(ft, viewProjection)
}

export function computeUIMVP(pixelWidth: float, pixelHeight: float): Mat4 {
  return Mat4.ortho(0.0f, pixelWidth, pixelHeight, 0.0f, -1.0f, 1.0f)
}