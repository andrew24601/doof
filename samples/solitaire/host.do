// Host-level input handling for the native boardgame event loop.
// Manages mouse state, drag detection, button interaction, debug camera keys,
// and per-frame camera/animation updates in Doof.

import {
  AppState, appNewGame, appClick, appDragStart, appDragMove, appDragEnd,
  appCancelInteraction, appUpdate
} from "./app-state"
import {
  computeIdealFrame, computeSolitaireBounds,
  updateAutoCamera, hasCameraMoved, screenToWorld
} from "./camera"
import {
  HostInput,
  applyInitialCamera,
  clearPointerState,
  beginPointerState,
  updatePointerState,
  pointerTravel,
  captureCameraState,
  setDebugKeyState,
  debugMoveX,
  debugMoveZ,
  debugZoomDirection
} from "cardgame/host-support"
import { layoutTopRight, onMouseDown, onMouseUp, onMouseMove, cancelPress } from "cardgame/button"
export { HostInput, setDebugKeyState, debugMoveX, debugMoveZ, debugZoomDirection }

const CLICK_THRESHOLD: float = 5.0f

// Snap camera to the ideal frame for the current game state.
export function initCamera(app: AppState, input: HostInput, aspect: float, fovY: float): void {
  bounds := computeSolitaireBounds(app.state)
  frame := computeIdealFrame(bounds, aspect, fovY)
  applyInitialCamera(app.camera, input, frame)
}

// Handle mouse/touch down.  Returns 1 if the UI button consumed the event, 0 otherwise.
export function hostMouseDown(
  input: HostInput, app: AppState,
  x: float, y: float, dpiScale: float
): int {
  if onMouseDown(app.button, x, y, dpiScale) {
    return 1
  }
  beginPointerState(input, x, y)
  return 0
}

// Handle mouse/touch up.  Returns 0 = no-op, 1 = handled, 2 = new-game requested.
export function hostMouseUp(
  input: HostInput, app: AppState,
  x: float, y: float,
  windowW: float, windowH: float,
  fovY: float, dpiScale: float
): int {
  if onMouseUp(app.button, x, y, dpiScale) {
    clearPointerState(input)
    return 2
  }

  hit := screenToWorld(app.camera, x, y, windowW, windowH, fovY)

  if input.mouseDown && !input.isDragging {
    appClick(app, hit.x, hit.z)
  } else if input.isDragging {
    appDragEnd(app, hit.x, hit.z)
  }

  clearPointerState(input)
  return 1
}

// Handle mouse/touch motion — drag detection, card dragging, debug camera pan.
export function hostMouseMove(
  input: HostInput, app: AppState,
  x: float, y: float,
  windowW: float, windowH: float,
  fovY: float, dpiScale: float
): void {
  onMouseMove(app.button, x, y, dpiScale)

  if input.mouseDown {
    if !input.isDragging {
      if pointerTravel(input, x, y) > CLICK_THRESHOLD {
        input.isDragging = true
        hit := screenToWorld(app.camera, input.mouseDownX, input.mouseDownY, windowW, windowH, fovY)
        appDragStart(app, hit.x, hit.z)
      }
    }

    if input.isDragging && app.state.isDragging {
      hit := screenToWorld(app.camera, x, y, windowW, windowH, fovY)
      appDragMove(app, hit.x, hit.z)
    }

    updatePointerState(input, x, y)
  }
}

// Cancel any in-progress pointer or card interaction.
export function hostCancelInteraction(input: HostInput, app: AppState): bool {
  let handled = clearPointerState(input)

  if cancelPress(app.button) {
    handled = true
  }

  if appCancelInteraction(app) {
    handled = true
  }

  return handled
}
// Per-frame update: animations, auto-camera, change detection, button layout.
// Returns true when the frame should be rendered.
export function hostUpdate(
  input: HostInput, app: AppState,
  deltaTime: float, pixelW: int, pixelH: int, fovY: float
): bool {
  let needsRender: bool = input.wasAnimating

  currentlyAnimating := appUpdate(app, deltaTime)
  input.wasAnimating = currentlyAnimating
  if currentlyAnimating || app.state.isDragging {
    needsRender = true
  }

  if !app.state.isDragging {
    aspect := if float(pixelW) > 0.0f && float(pixelH) > 0.0f then float(pixelW) / float(pixelH) else 1.0f
    bounds := computeSolitaireBounds(app.state)
    idealFrame := computeIdealFrame(bounds, aspect, fovY)
    updateAutoCamera(app.camera, idealFrame, deltaTime, 0.6f)
  }

  if hasCameraMoved(
    app.camera, input.lastFrameScale, input.lastFramePanX,
    input.lastFramePanY, input.lastPitch, input.lastTargetX, input.lastTargetZ
  ) {
    needsRender = true
  }

  captureCameraState(input, app.camera)

  layoutTopRight(app.button, pixelW, pixelH, 20.0f)

  return needsRender
}
