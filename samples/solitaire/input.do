// User interaction — click handling, drag-and-drop, card finding

import { PlayingCard, Card } from "cardgame/cards"
import {
  Pile, SolitaireState, updateCardPositions,
  CARD_VERTICAL_OFFSET
} from "./game"
import {
  canPlaceOnTableau, canPlaceOnFoundation,
  tryRevealTopCard, dealFromStock, attemptAutoMove,
  startMoveAnim
} from "./rules"
import { abs } from "cardgame/math"

// Result of finding a card at a screen position
export class CardHit {
  pileType: int = -1     // 0=tableau, 1=waste, 2=foundation, 3=stock
  pileIndex: int = -1
  cardIndex: int = -1    // Index within the pile's cardIndices
  found: bool = false
}

// Check if a point is inside a card's bounding rectangle
function pointInCard(px: float, pz: float, card: Card): bool {
  halfW := card.width * 0.5f
  halfH := card.height * 0.5f
  return px >= card.x - halfW && px <= card.x + halfW &&
         pz >= card.z - halfH && pz <= card.z + halfH
}

// Find which card (if any) is at the given world coordinates.
// Checks piles in priority order: tableau (back-to-front), waste, foundation, stock.
export function findCardAtPosition(state: SolitaireState, worldX: float, worldZ: float): CardHit {
  hit := CardHit {}

  // Check tableau piles (right-to-left so top-rendered piles win)
  for let i = 6; i >= 0; i -= 1 {
    pile := state.tableau(i)

    // Check from top card to bottom
    for let j = pile.cardIndices.length - 1; j >= 0; j -= 1 {
      cardIdx := pile.cardIndices[j]
      if cardIdx < 0 || cardIdx >= state.cards.length { continue }
      card := state.cards[cardIdx]

      if pointInCard(worldX, worldZ, card) {
        // Only allow clicking face-up cards
        if j >= pile.firstFaceUpIndex {
          hit.pileType = 0
          hit.pileIndex = i
          hit.cardIndex = j
          hit.found = true
          return hit
        }
        return hit  // Clicked face-down card — no hit
      }
    }
  }

  // Check waste pile (top card only)
  if !state.waste.isEmpty() {
    cardIdx := state.waste.topCardIndex()
    if cardIdx < 0 || cardIdx >= state.cards.length { return hit }
    card := state.cards[cardIdx]
    if pointInCard(worldX, worldZ, card) {
      hit.pileType = 1
      hit.pileIndex = 0
      hit.cardIndex = state.waste.cardIndices.length - 1
      hit.found = true
      return hit
    }
  }

  // Check foundation piles
  for i of 0..3 {
    fPile := state.foundation(i)
    if !fPile.isEmpty() {
      cardIdx := fPile.topCardIndex()
      if cardIdx < 0 || cardIdx >= state.cards.length { continue }
      card := state.cards[cardIdx]
      if pointInCard(worldX, worldZ, card) {
        hit.pileType = 2
        hit.pileIndex = i
        hit.cardIndex = fPile.cardIndices.length - 1
        hit.found = true
        return hit
      }
    }
  }

  // Check stock pile (for dealing)
  if !state.stock.isEmpty() {
    cardIdx := state.stock.topCardIndex()
    if cardIdx < 0 || cardIdx >= state.cards.length { return hit }
    card := state.cards[cardIdx]
    if pointInCard(worldX, worldZ, card) {
      hit.pileType = 3
      hit.pileIndex = 0
      hit.cardIndex = 0
      hit.found = true
      return hit
    }
  } else {
    // Empty stock — click to recycle waste
    halfW := 80.0f * 0.5f
    halfH := 120.0f * 0.5f
    if worldX >= state.stock.x - halfW && worldX <= state.stock.x + halfW &&
       worldZ >= state.stock.z - halfH && worldZ <= state.stock.z + halfH {
      hit.pileType = 3
      hit.pileIndex = 0
      hit.cardIndex = 0
      hit.found = true
      return hit
    }
  }

  return hit
}

// --- Click handling ---

// Handle a click on the game board. Returns true if something happened.
export function handleClick(state: SolitaireState, worldX: float, worldZ: float): bool {
  if state.moveAnimActive || state.dealAnimActive { return false }

  hit := findCardAtPosition(state, worldX, worldZ)
  if !hit.found { return false }

  // Stock: deal a card
  if hit.pileType == 3 {
    dealFromStock(state)
    return true
  }

  // Waste: try auto-move top card to foundation
  if hit.pileType == 1 {
    cardIdx := state.waste.topCardIndex()
    if cardIdx < 0 || cardIdx >= state.cards.length { return false }
    card := state.cardInfo[cardIdx]
    startX := state.cards[cardIdx].x
    startZ := state.cards[cardIdx].z

    for i of 0..3 {
      fPile := state.foundation(i)
      if canPlaceOnFoundation(card, i, fPile, state.cardInfo) {
        state.waste.popCard()
        fPile.cardIndices.push(cardIdx)
        startMoveAnim(state, cardIdx, i, startX, startZ)
        return true
      }
    }
  }

  // Tableau: try auto-move top card to foundation
  if hit.pileType == 0 {
    tab := state.tableau(hit.pileIndex)
    // Only auto-move if clicking the top card
    if hit.cardIndex == tab.cardIndices.length - 1 {
      cardIdx := tab.topCardIndex()
      if cardIdx < 0 || cardIdx >= state.cards.length { return false }
      card := state.cardInfo[cardIdx]
      startX := state.cards[cardIdx].x
      startZ := state.cards[cardIdx].z

      for i of 0..3 {
        fPile := state.foundation(i)
        if canPlaceOnFoundation(card, i, fPile, state.cardInfo) {
          tab.popCard()
          tryRevealTopCard(state, tab)
          fPile.cardIndices.push(cardIdx)
          startMoveAnim(state, cardIdx, i, startX, startZ)
          return true
        }
      }
    }
  }

  return false
}

// --- Drag handling ---

function cardIndexForHit(state: SolitaireState, hit: CardHit): int {
  if hit.pileType == 0 {
    pile := state.tableau(hit.pileIndex)
    if hit.cardIndex < 0 || hit.cardIndex >= pile.cardIndices.length { return -1 }
    return pile.cardIndices[hit.cardIndex]
  }
  if hit.pileType == 1 {
    if hit.cardIndex < 0 || hit.cardIndex >= state.waste.cardIndices.length { return -1 }
    return state.waste.cardIndices[hit.cardIndex]
  }
  if hit.pileType == 2 {
    pile := state.foundation(hit.pileIndex)
    if hit.cardIndex < 0 || hit.cardIndex >= pile.cardIndices.length { return -1 }
    return pile.cardIndices[hit.cardIndex]
  }
  return -1
}

function collectDraggedCardIndices(state: SolitaireState): int[] {
  if state.selectedPileType == 0 {
    pile := state.tableau(state.selectedPileIndex)
    return pile.cardIndices.slice(state.selectedCardIndex, pile.cardIndices.length)
  } else if state.selectedPileType == 1 {
    if !state.waste.isEmpty() {
      return [state.waste.topCardIndex()]
    }
  } else if state.selectedPileType == 2 {
    pile := state.foundation(state.selectedPileIndex)
    if !pile.isEmpty() {
      return [pile.topCardIndex()]
    }
  }

  return []
}

// Begin dragging from a clicked position.
export function handleDragStart(state: SolitaireState, worldX: float, worldZ: float): void {
  hit := findCardAtPosition(state, worldX, worldZ)
  if !hit.found { return }

  // Can't drag from stock
  if hit.pileType == 3 { return }

  // Waste and foundation can only drag the top card
  if hit.pileType == 1 && hit.cardIndex != state.waste.cardIndices.length - 1 { return }
  if hit.pileType == 2 && hit.cardIndex != state.foundation(hit.pileIndex).cardIndices.length - 1 {
    return
  }

  cardIdx := cardIndexForHit(state, hit)
  if cardIdx < 0 || cardIdx >= state.cards.length { return }

  state.selectedPileType = hit.pileType
  state.selectedPileIndex = hit.pileIndex
  state.selectedCardIndex = hit.cardIndex
  state.isDragging = true

  // Calculate drag offset
  state.dragOffsetX = state.cards[cardIdx].x - worldX
  state.dragOffsetZ = state.cards[cardIdx].z - worldZ
}

// Update dragged card positions.
export function handleDragMove(state: SolitaireState, worldX: float, worldZ: float): void {
  if !state.isDragging || state.selectedPileType < 0 { return }

  dragged := collectDraggedCardIndices(state)

  let currentZ = worldZ + state.dragOffsetZ
  for idx of dragged {
    if idx < 0 || idx >= state.cards.length { continue }
    state.cards[idx].x = worldX + state.dragOffsetX
    state.cards[idx].z = currentZ
    state.cards[idx].y = 0.0f
    currentZ = currentZ + CARD_VERTICAL_OFFSET
  }
}

// Attempt to place dragged cards at the drop position.
export function handleDragEnd(state: SolitaireState, worldX: float, worldZ: float): void {
  if !state.isDragging || state.selectedPileType < 0 {
    return
  }

  dragged := collectDraggedCardIndices(state)

  if dragged.length == 0 {
    cancelSelection(state)
    return
  }

  bottomCardIdx := dragged[0]
  if bottomCardIdx < 0 || bottomCardIdx >= state.cards.length {
    cancelSelection(state)
    return
  }

  bottomCard := state.cardInfo[bottomCardIdx]
  draggedCard := state.cards[bottomCardIdx]
  cardX := draggedCard.x
  cardZ := draggedCard.z

  let placed = false

  // Try placing on tableau
  for let i = 0; i < 7; i += 1 {
    if placed { break }
    targetPile := state.tableau(i)

    // Can't place on same pile
    if state.selectedPileType == 0 && state.selectedPileIndex == i { continue }

    if canPlaceOnTableau(bottomCard, targetPile, state.cardInfo) {
      halfW := 80.0f * 0.5f
      pileX := targetPile.x

      // Target Z for placement
      let targetZ = targetPile.z
      if !targetPile.isEmpty() {
        topIdx := targetPile.topCardIndex()
        if topIdx >= 0 && topIdx < state.cards.length {
          targetZ = state.cards[topIdx].z + 30.0f
        }
      }

      overlapMargin := halfW * 1.5f
      dx := abs(cardX - pileX)
      dz := abs(cardZ - targetZ)

      if dx < overlapMargin && dz < 120.0f {
        // Remove from source
        if state.selectedPileType == 0 {
          sourcePile := state.tableau(state.selectedPileIndex)
          sourcePile.removeFrom(state.selectedCardIndex)
          tryRevealTopCard(state, sourcePile)
        } else if state.selectedPileType == 1 {
          state.waste.popCard()
        } else if state.selectedPileType == 2 {
          state.foundation(state.selectedPileIndex).popCard()
        }

        // Add to target
        targetPile.addCards(dragged)
        placed = true
      }
    }
  }

  // Try placing on foundation (single card only)
  if !placed && dragged.length == 1 {
    for let i = 0; i < 4; i += 1 {
      if placed { break }
      fPile := state.foundation(i)

      if canPlaceOnFoundation(bottomCard, i, fPile, state.cardInfo) {
        halfW := 80.0f * 0.5f
        pileX := fPile.x
        pileZ := fPile.z

        overlapMargin := halfW * 1.5f
        dx := abs(cardX - pileX)
        dz := abs(cardZ - pileZ)

        if dx < overlapMargin && dz < 90.0f {
          if state.selectedPileType == 0 {
            sourcePile := state.tableau(state.selectedPileIndex)
            sourcePile.popCard()
            tryRevealTopCard(state, sourcePile)
          } else if state.selectedPileType == 1 {
            state.waste.popCard()
          } else if state.selectedPileType == 2 {
            state.foundation(state.selectedPileIndex).popCard()
          }

          fPile.cardIndices.push(bottomCardIdx)
          placed = true
        }
      }
    }
  }

  updateCardPositions(state)
  cancelSelection(state)
}

// Clear selection/drag state.
export function cancelSelection(state: SolitaireState): void {
  state.selectedPileType = -1
  state.selectedPileIndex = -1
  state.selectedCardIndex = -1
  state.isDragging = false
}
