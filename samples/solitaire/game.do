// Solitaire game state, initialization, pile management, and position updates

import { Suit, Rank, PlayingCard, Card, createDeck, cardId, cardBackId } from "cardgame/cards"

// A pile of cards — holds indices into the main cards array
export class Pile {
  cardIndices: int[] = []
  firstFaceUpIndex: int = 0
  x: float = 0.0f
  z: float = 0.0f

  isEmpty(): bool => cardIndices.length == 0

  topCardIndex(): int {
    if cardIndices.length == 0 { return -1 }
    return cardIndices[cardIndices.length - 1]
  }

  // Remove and return the last card index
  popCard(): int {
    if cardIndices.length == 0 { return -1 }
    idx := cardIndices[cardIndices.length - 1]
    cardIndices = cardIndices.slice(0, cardIndices.length - 1)
    return idx
  }

  // Remove cards from position onwards, return removed cards
  removeFrom(position: int): int[] {
    removed := cardIndices.slice(position, cardIndices.length)
    cardIndices = cardIndices.slice(0, position)
    return removed
  }

  // Add multiple card indices
  addCards(cards: int[]): void {
    for idx of cards {
      cardIndices.push(idx)
    }
  }
}

// Simple pseudo-random number generator (32-bit LCG)
export class Random {
  state: long = 0L

  // Returns a pseudo-random int in [0, bound)
  nextInt(bound: int): int {
    if bound <= 0 { return 0 }

    // Keep the LCG in 64-bit space so Release builds do not hit signed-int UB
    // in the generated C++ shuffle logic.
    state = (state * 1103515245L + 12345L) % 2147483648L
    if state < 0L {
      state = state + 2147483648L
    }

    return int(state % long(bound))
  }
}

// Shuffle an array of ints in place using Fisher-Yates
export function shuffle(arr: int[], rng: Random): void {
  for let i = arr.length - 1; i > 0; i -= 1 {
    j := rng.nextInt(i + 1)
    // Swap arr[i] and arr[j]
    temp := arr[i]
    arr[i] = arr[j]
    arr[j] = temp
  }
}

// Full solitaire game state
export class SolitaireState {
  cards: Card[] = []
  cardInfo: PlayingCard[] = []

  // The seven tableau piles
  tableau0: Pile = Pile {}
  tableau1: Pile = Pile {}
  tableau2: Pile = Pile {}
  tableau3: Pile = Pile {}
  tableau4: Pile = Pile {}
  tableau5: Pile = Pile {}
  tableau6: Pile = Pile {}

  // The four foundation piles (one per suit)
  foundations: Map<Suit, Pile> = {
    .Spades: Pile {},
    .Hearts: Pile {},
    .Diamonds: Pile {},
    .Clubs: Pile {}
  }

  // Stock (draw pile) and waste (discard pile)
  stock: Pile = Pile {}
  waste: Pile = Pile {}

  // Selection/drag state
  selectedPileType: int = -1   // -1=none, 0=tableau, 1=waste, 2=foundation, 3=stock
  selectedPileIndex: int = -1
  selectedCardIndex: int = -1
  isDragging: bool = false
  dragOffsetX: float = 0.0f
  dragOffsetZ: float = 0.0f

  // Deal animation state (stock → waste)
  dealAnimActive: bool = false
  dealCardIndex: int = -1
  dealProgress: float = 0.0f
  dealStartX: float = 0.0f
  dealStartZ: float = 0.0f
  dealEndX: float = 0.0f
  dealEndZ: float = 0.0f

  // Move animation state (auto-move to foundation)
  moveAnimActive: bool = false
  moveCardIndex: int = -1
  moveProgress: float = 0.0f
  moveStartX: float = 0.0f
  moveStartZ: float = 0.0f
  moveEndX: float = 0.0f
  moveEndZ: float = 0.0f
  moveAnimDuration: float = 0.25f

  // Access tableau by index
  tableau(i: int): Pile {
    return case i {
      0 => tableau0, 1 => tableau1, 2 => tableau2, 3 => tableau3,
      4 => tableau4, 5 => tableau5, 6 => tableau6, _ => tableau0
    }
  }

  // Access foundation by suit index (0=Spades, 1=Hearts, 2=Diamonds, 3=Clubs)
  foundation(i: int): Pile {
    suit := case i {
      0 => Suit.Spades, 1 => Suit.Hearts,
      2 => Suit.Diamonds, 3 => Suit.Clubs, _ => Suit.Spades
    }
    return foundations[suit]
  }
}

// Layout constants
const TABLEAU_START_X: float = -400.0f
const TABLEAU_SPACING: float = 100.0f
const TABLEAU_Z: float = 100.0f
const FOUNDATION_START_X: float = -100.0f
const FOUNDATION_SPACING: float = 100.0f
const FOUNDATION_Z: float = -50.0f
const STOCK_X: float = -400.0f
const STOCK_Z: float = -50.0f
const WASTE_X: float = -300.0f
const WASTE_Z: float = -50.0f
export const CARD_VERTICAL_OFFSET: float = 20.0f
const FACE_DOWN_OFFSET: float = 10.0f

// Initialize a new solitaire game with a shuffled deck
export function initializeGame(state: SolitaireState, seed: int): void {
  // Create deck info
  state.cardInfo = createDeck()

  // Create card visual objects
  cards: Card[] := []
  for i of 0..51 {
    info := state.cardInfo[i]
    cards.push(Card {
      cardId: cardId(info.suit, info.rank)
    })
  }
  state.cards = cards

  // Create shuffled indices
  deck: int[] := []
  for i of 0..51 {
    deck.push(i)
  }
  rng := Random { state: seed }
  shuffle(deck, rng)

  // Deal to tableau: pile i gets i+1 cards, last is face-up
  let deckIndex = 0
  for pile of 0..6 {
    tab := state.tableau(pile)
    tab.cardIndices = []
    tab.firstFaceUpIndex = pile  // Only last card face-up

    for card of 0..pile {
      tab.cardIndices.push(deck[deckIndex])
      deckIndex += 1
    }
  }

  // Remaining 24 cards go to stock
  state.stock.cardIndices = []
  state.stock.firstFaceUpIndex = 0
  while deckIndex < 52 {
    state.stock.cardIndices.push(deck[deckIndex])
    deckIndex += 1
  }

  // Clear waste and foundation
  state.waste.cardIndices = []
  state.waste.firstFaceUpIndex = 0
  for i of 0..3 {
    f := state.foundation(i)
    f.cardIndices = []
    f.firstFaceUpIndex = 0
  }

  // Clear selection
  state.selectedPileType = -1
  state.selectedPileIndex = -1
  state.selectedCardIndex = -1
  state.isDragging = false

  // Set pile positions
  for i of 0..6 {
    tab := state.tableau(i)
    tab.x = TABLEAU_START_X + float(i) * TABLEAU_SPACING
    tab.z = TABLEAU_Z
  }

  for i of 0..3 {
    f := state.foundation(i)
    f.x = FOUNDATION_START_X + float(i) * FOUNDATION_SPACING
    f.z = FOUNDATION_Z
  }

  state.stock.x = STOCK_X
  state.stock.z = STOCK_Z
  state.waste.x = WASTE_X
  state.waste.z = WASTE_Z

  updateCardPositions(state)
}

// Update all card positions based on their pile membership
export function updateCardPositions(state: SolitaireState): void {
  // Tableau cards: stack with offset
  for i of 0..6 {
    pile := state.tableau(i)
    let currentZ = pile.z

    for j of 0..<pile.cardIndices.length {
      cardIdx := pile.cardIndices[j]
      if cardIdx < 0 || cardIdx >= state.cards.length { continue }
      card := state.cards[cardIdx]
      card.x = pile.x
      card.z = currentZ
      card.y = 0.0f
      if card.flipPhase == 0 {
        card.faceUp = j >= pile.firstFaceUpIndex
      }

      if j >= pile.firstFaceUpIndex {
        currentZ = currentZ + CARD_VERTICAL_OFFSET
      } else {
        currentZ = currentZ + FACE_DOWN_OFFSET
      }
    }
  }

  // Foundation cards: stacked at pile position
  for i of 0..3 {
    pile := state.foundation(i)
    for j of 0..<pile.cardIndices.length {
      cardIdx := pile.cardIndices[j]
      if cardIdx < 0 || cardIdx >= state.cards.length { continue }
      c := state.cards[cardIdx]
      c.x = pile.x
      c.z = pile.z
      c.y = 0.0f
      c.faceUp = true
    }
  }

  // Stock cards: all face-down at stock position
  for i of 0..<state.stock.cardIndices.length {
    cardIdx := state.stock.cardIndices[i]
    if cardIdx < 0 || cardIdx >= state.cards.length { continue }
    c := state.cards[cardIdx]
    c.x = state.stock.x
    c.z = state.stock.z
    c.y = 0.0f
    c.faceUp = false
  }

  // Waste cards: face-up at waste position
  for i of 0..<state.waste.cardIndices.length {
    cardIdx := state.waste.cardIndices[i]
    // Skip card currently being dealt
    if state.dealAnimActive && cardIdx == state.dealCardIndex { continue }
    if cardIdx < 0 || cardIdx >= state.cards.length { continue }
    c := state.cards[cardIdx]
    c.x = state.waste.x
    c.z = state.waste.z
    c.y = 0.0f
    if c.flipPhase == 0 {
      c.faceUp = true
    }
  }
}

// Check if any animation is currently in progress
export function isAnimating(state: SolitaireState): bool {
  if state.dealAnimActive || state.moveAnimActive { return true }
  for card of state.cards {
    if card.flipPhase != 0 { return true }
  }
  return false
}
