// Camera state, auto-framing, bounding box, smooth damping, and projection.

import { SolitaireState } from "./game"
import {
  Camera,
  CameraFrame,
  BoundingBox,
  WorldHit,
  expandBounds,
  updateAutoCamera,
  hasCameraMoved,
  computeIdealFrame,
  screenToWorld,
  computeWorldMVP,
  computeUIMVP
} from "cardgame/camera-support"

export {
  Camera,
  CameraFrame,
  BoundingBox,
  WorldHit,
  updateAutoCamera,
  hasCameraMoved,
  computeIdealFrame,
  screenToWorld,
  computeWorldMVP,
  computeUIMVP
}

// Compute bounds of all visible content in the solitaire game.
export function computeSolitaireBounds(state: SolitaireState): BoundingBox {
  bounds := BoundingBox {}
  let first = true
  halfW := 40.0f   // card width 80 / 2
  halfH := 60.0f   // card height 120 / 2

  // Include all cards
  for card of state.cards {
    cHalfW := card.width * 0.5f
    cHalfH := card.height * 0.5f
    if first {
      bounds.minX = card.x - cHalfW
      bounds.maxX = card.x + cHalfW
      bounds.minZ = card.z - cHalfH
      bounds.maxZ = card.z + cHalfH
      first = false
    } else {
      if card.x - cHalfW < bounds.minX { bounds.minX = card.x - cHalfW }
      if card.x + cHalfW > bounds.maxX { bounds.maxX = card.x + cHalfW }
      if card.z - cHalfH < bounds.minZ { bounds.minZ = card.z - cHalfH }
      if card.z + cHalfH > bounds.maxZ { bounds.maxZ = card.z + cHalfH }
    }
  }

  // Include empty pile positions so camera doesn't jump when piles empty
  for i of 0..6 {
    tab := state.tableau(i)
    expandBounds(bounds, tab.x, tab.z, halfW, halfH)
  }
  for i of 0..3 {
    f := state.foundation(i)
    expandBounds(bounds, f.x, f.z, halfW, halfH)
  }
  expandBounds(bounds, state.stock.x, state.stock.z, halfW, halfH)
  expandBounds(bounds, state.waste.x, state.waste.z, halfW, halfH)

  return bounds
}
