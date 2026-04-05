// UI button state — hit testing and interaction tracking
//
import { RenderVertex } from "./vertex"
import { RenderDraw, WorldRenderPlan } from "./render-plan"
import { cos, sin, PI } from "./math"

// A tappable button on screen.
export class GameButton {
  label: string = ""
  x: float = 0.0f       // Screen position (top-left corner in pixels)
  y: float = 0.0f
  width: float = 120.0f
  height: float = 40.0f
  padding: float = 10.0f

  hovered: bool = false
  pressed: bool = false
  spinTimeRemaining: float = 0.0f
}

const BUTTON_SPIN_DURATION: float = 0.28f
const BUTTON_SPIN_TURNS: float = 1.0f

// Position button at top-right corner of screen.
export function layoutTopRight(
  button: GameButton, pixelW: int, pixelH: int, margin: float
): void {
  button.x = float(pixelW) - button.width - margin
  button.y = margin
}

// Check if a screen point is inside the button.
export function hitTest(
  button: GameButton, sx: float, sy: float, dpiScale: float
): bool {
  px := sx * dpiScale
  py := sy * dpiScale
  return px >= button.x && px <= button.x + button.width &&
         py >= button.y && py <= button.y + button.height
}

// Handle mouse/touch down. Returns true if button was pressed.
export function onMouseDown(
  button: GameButton, sx: float, sy: float, dpiScale: float
): bool {
  if hitTest(button, sx, sy, dpiScale) {
    button.pressed = true
    return true
  }
  return false
}

// Handle mouse/touch up. Returns true if a click should fire.
export function onMouseUp(
  button: GameButton, sx: float, sy: float, dpiScale: float
): bool {
  wasPressed := button.pressed
  button.pressed = false

  if wasPressed && hitTest(button, sx, sy, dpiScale) {
    triggerSpin(button)
    return true
  }
  return false
}

// Clear any in-progress button press state.
export function cancelPress(button: GameButton): bool {
  wasPressed := button.pressed
  button.pressed = false
  return wasPressed
}

// Handle mouse move for hover effects.
export function onMouseMove(
  button: GameButton, sx: float, sy: float, dpiScale: float
): void {
  button.hovered = hitTest(button, sx, sy, dpiScale)

  // Cancel press if mouse moves outside
  if button.pressed && !button.hovered {
    button.pressed = false
  }
}

// Get the alpha for button background based on interaction state.
export function buttonAlpha(button: GameButton): float {
  if button.pressed { return 0.95f }
  if button.hovered { return 0.9f }
  return 0.85f
}

// Start the refresh icon spin.
export function triggerSpin(button: GameButton): void {
  button.spinTimeRemaining = BUTTON_SPIN_DURATION
}

// Advance the refresh icon spin. Returns true while the icon is still rotating.
export function updateButtonAnimation(button: GameButton, deltaTime: float): bool {
  if button.spinTimeRemaining <= 0.0f {
    return false
  }

  let nextTime = button.spinTimeRemaining - deltaTime
  if nextTime < 0.0f {
    nextTime = 0.0f
  }
  button.spinTimeRemaining = nextTime
  return nextTime > 0.0f
}

// Get the current icon rotation in radians.
export function buttonRotation(button: GameButton): float {
  if button.spinTimeRemaining <= 0.0f {
    return 0.0f
  }

  progress := 1.0f - button.spinTimeRemaining / BUTTON_SPIN_DURATION
  eased := 1.0f - (1.0f - progress) * (1.0f - progress)
  return PI * 2.0f * BUTTON_SPIN_TURNS * eased
}

function pushRotatedIconVertex(
  verts: RenderVertex[],
  centerX: float,
  centerY: float,
  x: float,
  y: float,
  rotationCos: float,
  rotationSin: float,
  u: float,
  v: float,
  alpha: float
): void {
  dx := x - centerX
  dy := y - centerY
  rx := centerX + dx * rotationCos - dy * rotationSin
  ry := centerY + dx * rotationSin + dy * rotationCos
  verts.push({ x: rx, y: ry, z: 0.0f, u: u, v: v, alpha: alpha })
}

// Generate the refresh icon geometry for the button.
export function pushButtonIconVertices(verts: RenderVertex[], button: GameButton): void {
  cx := button.x + button.width * 0.5f
  cy := button.y + button.height * 0.5f
  r := button.width * 0.3f
  thickness := 6.0f
  rotation := buttonRotation(button)
  rotationCos := cos(rotation)
  rotationSin := sin(rotation)

  let alpha = 1.0f
  if button.pressed { alpha = 0.8f }

  segments := 24
  startAngle := -PI * 0.2f
  endAngle := PI * 1.4f

  for let i = 0; i < segments; i += 1 {
    t0 := float(i) / float(segments)
    t1 := float(i + 1) / float(segments)

    a0 := startAngle + (endAngle - startAngle) * t0
    a1 := startAngle + (endAngle - startAngle) * t1

    c0 := cos(a0)
    s0 := sin(a0)
    c1 := cos(a1)
    s1 := sin(a1)

    rInner := r - thickness * 0.5f
    rOuter := r + thickness * 0.5f

    x0In := cx + c0 * rInner
    y0In := cy + s0 * rInner
    x1In := cx + c1 * rInner
    y1In := cy + s1 * rInner

    x0Out := cx + c0 * rOuter
    y0Out := cy + s0 * rOuter
    x1Out := cx + c1 * rOuter
    y1Out := cy + s1 * rOuter

    pushRotatedIconVertex(verts, cx, cy, x0In, y0In, rotationCos, rotationSin, 0.0f, 0.0f, alpha)
    pushRotatedIconVertex(verts, cx, cy, x0Out, y0Out, rotationCos, rotationSin, 1.0f, 0.0f, alpha)
    pushRotatedIconVertex(verts, cx, cy, x1In, y1In, rotationCos, rotationSin, 0.0f, 1.0f, alpha)
    pushRotatedIconVertex(verts, cx, cy, x0Out, y0Out, rotationCos, rotationSin, 1.0f, 0.0f, alpha)
    pushRotatedIconVertex(verts, cx, cy, x1Out, y1Out, rotationCos, rotationSin, 1.0f, 1.0f, alpha)
    pushRotatedIconVertex(verts, cx, cy, x1In, y1In, rotationCos, rotationSin, 0.0f, 1.0f, alpha)
  }

  arrowSize := thickness * 3.5f
  angle := endAngle
  c := cos(angle)
  s := sin(angle)
  tx := -s
  ty := c
  nx := c
  ny := s

  p0x := cx + c * r + tx * arrowSize * 0.5f
  p0y := cy + s * r + ty * arrowSize * 0.5f

  p1x := cx + c * r - tx * arrowSize * 0.5f + nx * arrowSize * 0.6f
  p1y := cy + s * r - ty * arrowSize * 0.5f + ny * arrowSize * 0.6f

  p2x := cx + c * r - tx * arrowSize * 0.5f - nx * arrowSize * 0.6f
  p2y := cy + s * r - ty * arrowSize * 0.5f - ny * arrowSize * 0.6f

  pushRotatedIconVertex(verts, cx, cy, p0x, p0y, rotationCos, rotationSin, 0.0f, 0.0f, alpha)
  pushRotatedIconVertex(verts, cx, cy, p1x, p1y, rotationCos, rotationSin, 1.0f, 0.0f, alpha)
  pushRotatedIconVertex(verts, cx, cy, p2x, p2y, rotationCos, rotationSin, 0.0f, 1.0f, alpha)
}

// Build a WorldRenderPlan for the UI button (background + icon).
// The caller provides platform-specific texture IDs.
export function buildUIRenderPlan(
  button: GameButton,
  buttonTextureId: int,
  iconTextureId: int
): WorldRenderPlan {
  plan := WorldRenderPlan {}

  iconVerts: RenderVertex[] := []
  pushButtonIconVertices(iconVerts, button)
  if iconVerts.length > 0 {
    plan.draws.push({ textureId: iconTextureId, vertices: iconVerts })
  }

  return plan
}
