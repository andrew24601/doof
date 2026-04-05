// Move validation, dealing, auto-move, and win detection

import { Suit, Rank, PlayingCard, Card, foundationSuit } from "cardgame/cards"
import {
  Pile, SolitaireState, updateCardPositions,
  CARD_VERTICAL_OFFSET
} from "./game"
import { PI } from "cardgame/math"

// --- Move validation ---

// Can the given card be placed on top of a tableau pile?
// Rule: opposite color and one rank lower, or King on empty pile.
export function canPlaceOnTableau(
  card: PlayingCard,
  pile: Pile,
  cardInfo: PlayingCard[]
): bool {
  if pile.isEmpty() {
    return card.rank == .King
  }

  topIdx := pile.topCardIndex()
  topCard := cardInfo[topIdx]

  // Must be opposite color
  if card.isRed() == topCard.isRed() { return false }

  // Must be one rank lower
  return card.rankValue() == topCard.rankValue() - 1
}

// Can the given card be placed on a foundation pile?
// Rule: matching suit, ascending from Ace.
export function canPlaceOnFoundation(
  card: PlayingCard,
  foundationIndex: int,
  pile: Pile,
  cardInfo: PlayingCard[]
): bool {
  // Must match the designated suit
  requiredSuit := foundationSuit(foundationIndex)
  if card.suit != requiredSuit { return false }

  if pile.isEmpty() {
    return card.rank == .Ace
  }

  topIdx := pile.topCardIndex()
  topCard := cardInfo[topIdx]

  // Must be one rank higher (suit already verified)
  return card.rankValue() == topCard.rankValue() + 1
}

// --- Reveal top card after removal ---

// When the top card of a tableau pile is removed, check if the new
// top card needs to be flipped face-up and start its flip animation.
export function tryRevealTopCard(state: SolitaireState, pile: Pile): void {
  if pile.isEmpty() { return }

  newTopIdx := pile.cardIndices.length - 1
  if pile.firstFaceUpIndex > newTopIdx {
    pile.firstFaceUpIndex = newTopIdx

    cardIdx := pile.cardIndices[newTopIdx]
    if cardIdx < 0 || cardIdx >= state.cards.length { return }

    card := state.cards[cardIdx]
    card.faceUp = false
    card.currentRotation = PI
    card.currentLift = 0.0f
    card.flipPhase = 1          // Lifting
    card.flipProgress = 0.0f
    card.flipTargetFaceUp = true
  }
}

// --- Deal from stock ---

// Deal one card from stock to waste, or recycle the waste back to stock.
export function dealFromStock(state: SolitaireState): void {
  if state.dealAnimActive { return }

  if state.stock.isEmpty() {
    // Recycle: reverse waste back to stock, all face-down
    recycled: int[] := []
    for let i = state.waste.cardIndices.length - 1; i >= 0; i -= 1 {
      recycled.push(state.waste.cardIndices[i])
    }
    state.stock.cardIndices = recycled
    state.waste.cardIndices = []

    for idx of state.stock.cardIndices {
      if idx < 0 || idx >= state.cards.length { continue }
      state.cards[idx].faceUp = false
      state.cards[idx].currentRotation = 0.0f
    }
    updateCardPositions(state)
  } else {
    // Deal one card from stock to waste with animation
    cardIdx := state.stock.popCard()
    if cardIdx < 0 || cardIdx >= state.cards.length { return }
    state.waste.cardIndices.push(cardIdx)

    card := state.cards[cardIdx]
    state.dealAnimActive = true
    state.dealCardIndex = cardIdx
    state.dealProgress = 0.0f
    state.dealStartX = state.stock.x
    state.dealStartZ = state.stock.z
    state.dealEndX = state.waste.x
    state.dealEndZ = state.waste.z

    card.x = state.stock.x
    card.z = state.stock.z
    card.faceUp = false
    card.currentRotation = PI
    card.currentLift = 0.0f
    card.flipPhase = 1          // Lifting
    card.flipProgress = 0.0f
    card.flipTargetFaceUp = true

    updateCardPositions(state)
  }
}

// --- Auto-move to foundation ---

// Helper: start a move animation to a foundation pile
export function startMoveAnim(
  state: SolitaireState,
  cardIdx: int,
  foundationIdx: int,
  startX: float,
  startZ: float
): void {
  if cardIdx < 0 || cardIdx >= state.cards.length { return }
  fPile := state.foundation(foundationIdx)

  state.moveAnimActive = true
  state.moveCardIndex = cardIdx
  state.moveProgress = 0.0f
  state.moveStartX = startX
  state.moveStartZ = startZ
  state.moveEndX = fPile.x
  state.moveEndZ = fPile.z
  state.cards[cardIdx].currentLift = 20.0f
}

// Try to auto-move one card to a foundation. Called repeatedly after each
// successful move to chain the animation.
export function attemptAutoMove(state: SolitaireState): void {
  if state.moveAnimActive || state.dealAnimActive { return }

  // Try waste pile first
  if !state.waste.isEmpty() {
    cardIdx := state.waste.topCardIndex()
    if cardIdx >= 0 && cardIdx < state.cards.length {
      card := state.cardInfo[cardIdx]
      startX := state.cards[cardIdx].x
      startZ := state.cards[cardIdx].z

      for i of 0..3 {
        fPile := state.foundation(i)
        if canPlaceOnFoundation(card, i, fPile, state.cardInfo) {
          state.waste.popCard()
          fPile.cardIndices.push(cardIdx)
          startMoveAnim(state, cardIdx, i, startX, startZ)
          return
        }
      }
    }
  }

  // Try each tableau pile's top card
  for t of 0..6 {
    tab := state.tableau(t)
    if tab.isEmpty() { continue }

    cardIdx := tab.topCardIndex()
    if cardIdx < 0 || cardIdx >= state.cards.length { continue }
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
        return
      }
    }
  }
}

// --- Win detection ---

// The game is won when all four foundation piles have 13 cards.
export function checkWin(state: SolitaireState): bool {
  for i of 0..3 {
    if state.foundation(i).cardIndices.length != 13 { return false }
  }
  return true
}

// --- Animation updates ---

// Easing function: ease-in-out cubic
function easeInOutCubic(t: float): float {
  if t < 0.5f {
    return 4.0f * t * t * t
  }
  v := -2.0f * t + 2.0f
  return 1.0f - (v * v * v) / 2.0f
}

// Update the card flip animation for a single card
export function updateCardFlip(card: Card, deltaTime: float): void {
  if card.flipPhase == 0 { return }

  phaseDuration := card.flipDuration / 3.0f
  step := deltaTime / phaseDuration
  card.flipProgress = card.flipProgress + step

  if card.flipProgress >= 1.0f {
    card.flipProgress = 0.0f

    if card.flipPhase == 1 {
      // Lifting → Rotating
      card.flipPhase = 2
    } else if card.flipPhase == 2 {
      // Rotating → Lowering
      card.flipPhase = 3
    } else if card.flipPhase == 3 {
      // Lowering → Done
      card.flipPhase = 0
      card.faceUp = card.flipTargetFaceUp
      card.currentLift = 0.0f
      card.currentRotation = if card.faceUp then 0.0f else PI
    }
  } else {
    if card.flipPhase == 1 {
      // Lifting phase: raise card
      card.currentLift = card.flipLiftHeight * card.flipProgress
    } else if card.flipPhase == 2 {
      // Rotating phase: spin card
      card.currentLift = card.flipLiftHeight
      if card.flipTargetFaceUp {
        card.currentRotation = PI * (1.0f - card.flipProgress)
      } else {
        card.currentRotation = PI * card.flipProgress
      }
    } else if card.flipPhase == 3 {
      // Lowering phase: lower card back down
      card.currentLift = card.flipLiftHeight * (1.0f - card.flipProgress)
    }
  }
}

// Update the deal animation (stock → waste with flip)
export function updateDealAnimation(state: SolitaireState, deltaTime: float): void {
  if !state.dealAnimActive { return }
  if state.dealCardIndex < 0 || state.dealCardIndex >= state.cards.length {
    state.dealAnimActive = false
    state.dealCardIndex = -1
    return
  }

  card := state.cards[state.dealCardIndex]

  // Overall progress derived from flip phase
  let overallProgress: float = 0.0f
  if card.flipPhase == 1 {
    overallProgress = card.flipProgress * 0.33f
  } else if card.flipPhase == 2 {
    overallProgress = 0.33f + card.flipProgress * 0.34f
  } else if card.flipPhase == 3 {
    overallProgress = 0.67f + card.flipProgress * 0.33f
  } else {
    overallProgress = 1.0f
  }

  eased := easeInOutCubic(overallProgress)
  card.x = state.dealStartX + (state.dealEndX - state.dealStartX) * eased
  card.z = state.dealStartZ + (state.dealEndZ - state.dealStartZ) * eased

  // Complete when flip is done
  if card.flipPhase == 0 {
    state.dealAnimActive = false
    state.dealCardIndex = -1
    updateCardPositions(state)
  }
}

// Update the auto-move animation (card sliding to foundation)
export function updateMoveAnimation(state: SolitaireState, deltaTime: float): void {
  if !state.moveAnimActive { return }
  if state.moveCardIndex < 0 || state.moveCardIndex >= state.cards.length {
    state.moveAnimActive = false
    state.moveCardIndex = -1
    return
  }

  card := state.cards[state.moveCardIndex]
  state.moveProgress = state.moveProgress + deltaTime / state.moveAnimDuration

  if state.moveProgress >= 1.0f {
    // Animation complete
    state.moveProgress = 1.0f
    card.x = state.moveEndX
    card.z = state.moveEndZ
    card.currentLift = 0.0f

    state.moveAnimActive = false
    state.moveCardIndex = -1

    updateCardPositions(state)
    attemptAutoMove(state)   // Chain next move if available
  } else {
    t := easeInOutCubic(state.moveProgress)
    card.x = state.moveStartX + (state.moveEndX - state.moveStartX) * t
    card.z = state.moveStartZ + (state.moveEndZ - state.moveStartZ) * t

    // Arc motion: lift in the middle
    liftT := 1.0f - (2.0f * state.moveProgress - 1.0f) * (2.0f * state.moveProgress - 1.0f)
    card.currentLift = 40.0f * liftT
  }
}

// Update all animations for one frame. Returns true if anything is still animating.
export function updateAnimations(state: SolitaireState, deltaTime: float): bool {
  // Update individual card flips
  for card of state.cards {
    updateCardFlip(card, deltaTime)
  }

  updateDealAnimation(state, deltaTime)
  updateMoveAnimation(state, deltaTime)

  // Check if still animating
  if state.dealAnimActive || state.moveAnimActive { return true }
  for card of state.cards {
    if card.flipPhase != 0 { return true }
  }
  return false
}
