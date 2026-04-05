import { Card } from "./cards"
import { CardSprite } from "./sprite"
import { cos, sin } from "./math"

export class RenderVertex {
  x: float = 0.0f
  y: float = 0.0f
  z: float = 0.0f
  u: float = 0.0f
  v: float = 0.0f
  alpha: float = 1.0f
}

class Corner3 {
  x: float = 0.0f
  y: float = 0.0f
  z: float = 0.0f
}

export function pushCardVertices(
  verts: RenderVertex[],
  card: Card,
  sprite: CardSprite
): void {
  if !sprite.isValid() { return }

  halfW := card.width * 0.5f
  halfH := card.height * 0.5f

  x0 := card.x - halfW
  x1 := card.x + halfW
  z0 := card.z - halfH
  z1 := card.z + halfH

  verts.push(RenderVertex { x: x0, y: card.y, z: z1, u: sprite.u0, v: sprite.v1 })
  verts.push(RenderVertex { x: x1, y: card.y, z: z1, u: sprite.u1, v: sprite.v1 })
  verts.push(RenderVertex { x: x0, y: card.y, z: z0, u: sprite.u0, v: sprite.v0 })
  verts.push(RenderVertex { x: x1, y: card.y, z: z1, u: sprite.u1, v: sprite.v1 })
  verts.push(RenderVertex { x: x1, y: card.y, z: z0, u: sprite.u1, v: sprite.v0 })
  verts.push(RenderVertex { x: x0, y: card.y, z: z0, u: sprite.u0, v: sprite.v0 })
}

export function pushCardVerticesWithAlpha(
  verts: RenderVertex[],
  x: float, z: float, y: float,
  width: float, height: float,
  sprite: CardSprite,
  alpha: float
): void {
  if !sprite.isValid() { return }

  halfW := width * 0.5f
  halfH := height * 0.5f

  x0 := x - halfW
  x1 := x + halfW
  z0 := z - halfH
  z1 := z + halfH

  verts.push(RenderVertex { x: x0, y: y, z: z1, u: sprite.u0, v: sprite.v1, alpha: alpha })
  verts.push(RenderVertex { x: x1, y: y, z: z1, u: sprite.u1, v: sprite.v1, alpha: alpha })
  verts.push(RenderVertex { x: x0, y: y, z: z0, u: sprite.u0, v: sprite.v0, alpha: alpha })
  verts.push(RenderVertex { x: x1, y: y, z: z1, u: sprite.u1, v: sprite.v1, alpha: alpha })
  verts.push(RenderVertex { x: x1, y: y, z: z0, u: sprite.u1, v: sprite.v0, alpha: alpha })
  verts.push(RenderVertex { x: x0, y: y, z: z0, u: sprite.u0, v: sprite.v0, alpha: alpha })
}

export function pushAnimatedCardVertices(
  frontVerts: RenderVertex[],
  backVerts: RenderVertex[],
  card: Card,
  frontSprite: CardSprite,
  backSprite: CardSprite
): void {
  if !frontSprite.isValid() || !backSprite.isValid() { return }

  rot := card.currentRotation
  halfW := card.width * 0.5f
  halfH := card.height * 0.5f
  cx := card.x
  cz := card.z
  cy := card.y + card.currentLift
  cosR := cos(rot)
  sinR := sin(rot)

  c0 := rotateCorner(cx, cy, cz, -halfW, -halfH, cosR, sinR)
  c1 := rotateCorner(cx, cy, cz, halfW, -halfH, cosR, sinR)
  c2 := rotateCorner(cx, cy, cz, -halfW, halfH, cosR, sinR)
  c3 := rotateCorner(cx, cy, cz, halfW, halfH, cosR, sinR)

  frontVerts.push(RenderVertex { x: c2.x, y: c2.y, z: c2.z, u: frontSprite.u0, v: frontSprite.v1 })
  frontVerts.push(RenderVertex { x: c3.x, y: c3.y, z: c3.z, u: frontSprite.u1, v: frontSprite.v1 })
  frontVerts.push(RenderVertex { x: c0.x, y: c0.y, z: c0.z, u: frontSprite.u0, v: frontSprite.v0 })
  frontVerts.push(RenderVertex { x: c3.x, y: c3.y, z: c3.z, u: frontSprite.u1, v: frontSprite.v1 })
  frontVerts.push(RenderVertex { x: c1.x, y: c1.y, z: c1.z, u: frontSprite.u1, v: frontSprite.v0 })
  frontVerts.push(RenderVertex { x: c0.x, y: c0.y, z: c0.z, u: frontSprite.u0, v: frontSprite.v0 })

  backVerts.push(RenderVertex { x: c2.x, y: c2.y, z: c2.z, u: backSprite.u1, v: backSprite.v1 })
  backVerts.push(RenderVertex { x: c0.x, y: c0.y, z: c0.z, u: backSprite.u1, v: backSprite.v0 })
  backVerts.push(RenderVertex { x: c3.x, y: c3.y, z: c3.z, u: backSprite.u0, v: backSprite.v1 })
  backVerts.push(RenderVertex { x: c3.x, y: c3.y, z: c3.z, u: backSprite.u0, v: backSprite.v1 })
  backVerts.push(RenderVertex { x: c0.x, y: c0.y, z: c0.z, u: backSprite.u1, v: backSprite.v0 })
  backVerts.push(RenderVertex { x: c1.x, y: c1.y, z: c1.z, u: backSprite.u0, v: backSprite.v0 })
}

function rotateCorner(
  cx: float,
  cy: float,
  cz: float,
  localX: float,
  localZ: float,
  cosR: float,
  sinR: float
): Corner3 {
  rx := localX * cosR
  ry := localX * sinR
  return Corner3 { x: cx + rx, y: cy + ry, z: cz + localZ }
}