// Camera state, auto-framing, bounds, and projection for Seahaven Towers.

import { SeahavenState } from "./seahaven"
import { Suit } from "cardgame/cards"
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

export function computeSeahavenBounds(state: SeahavenState): BoundingBox {
  bounds := BoundingBox {}
  let first = true
  halfW := 40.0f
  halfH := 60.0f

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

  for pile of state.tableaus {
    expandBounds(bounds, pile.x, pile.z, halfW, halfH)
  }
  for pile of state.reserves {
    expandBounds(bounds, pile.x, pile.z, halfW, halfH)
  }
  suits: Suit[] := [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs]
  for suit of suits {
    pile := state.foundations[suit]
    expandBounds(bounds, pile.x, pile.z, halfW, halfH)
  }

  return bounds
}