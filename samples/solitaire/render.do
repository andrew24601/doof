// Render ordering — determines which cards to draw in what order
//
// Separates the WHAT (ordering, animation flags) from the HOW
// (Metal vertices, textures). The C++ bridge reads this plan
// and generates platform-specific render batches.

import { SolitaireState } from "./game"
import { CardLibrary } from "cardgame/sprite"
import { RenderDraw, WorldRenderPlan } from "cardgame/render-plan"
import {
  RenderVertex,
  pushCardVertices,
  pushCardVerticesWithAlpha,
  pushAnimatedCardVertices
} from "cardgame/vertex"

// Describes a single card to render.
export class RenderCard {
  cardIndex: int = -1
  isAnimating: bool = false
  // true = flip animation (needs animated vertex generation with cos/sin)
  // false = static or move/deal animation (normal vertex generation)
  isFlipping: bool = false
}

// Describes a placeholder to render when a pile is empty.
export class RenderPlaceholder {
  x: float = 0.0f
  z: float = 0.0f
  // What sprite to show: "ace_spades", "ace_hearts", etc. for foundations,
  // "card_back" for tableau/stock
  spriteHint: string = ""
  alpha: float = 0.3f
}

// Complete render plan for one frame.
export class RenderPlan {
  // Placeholders drawn first (behind everything)
  placeholders: RenderPlaceholder[] = []
  // Non-animating cards (drawn in order, first = back, last = front)
  staticCards: RenderCard[] = []
  // Animating cards (drawn on top of everything)
  animatingCards: RenderCard[] = []
}

export { RenderDraw, WorldRenderPlan } from "cardgame/render-plan"

// Build a render plan from the current game state.
// The plan determines draw order without touching any platform-specific types.
export function buildRenderPlan(state: SolitaireState): RenderPlan {
  plan := RenderPlan {}

  // --- Placeholders ---

  // Foundation placeholders: show ace of each suit when empty
  suitNames := ["0_1", "1_1", "2_1", "3_1"]  // card_<suit>_<rank=Ace>
  for i of 0..3 {
    fPile := state.foundation(i)
    plan.placeholders.push(RenderPlaceholder {
      x: fPile.x, z: fPile.z,
      spriteHint: `card_${suitNames[i]}`,
      alpha: 0.3f
    })
  }

  // Tableau placeholders when empty
  for i of 0..6 {
    tab := state.tableau(i)
    if tab.isEmpty() {
      plan.placeholders.push(RenderPlaceholder {
        x: tab.x, z: tab.z,
        spriteHint: "card_back",
        alpha: 0.3f
      })
    }
  }

  // Stock placeholder when empty
  if state.stock.isEmpty() {
    plan.placeholders.push(RenderPlaceholder {
      x: state.stock.x, z: state.stock.z,
      spriteHint: "card_back",
      alpha: 0.3f
    })
  }

  // --- Build ordered card list ---
  // Order: foundation → stock → waste → tableau (row-by-row) → dragged last

  ordered: int[] := []

  // Foundation piles (at back)
  for i of 0..3 {
    fPile := state.foundation(i)
    for idx of fPile.cardIndices {
      ordered.push(idx)
    }
  }

  // Stock pile
  for idx of state.stock.cardIndices {
    ordered.push(idx)
  }

  // Waste pile
  for idx of state.waste.cardIndices {
    ordered.push(idx)
  }

  // Tableau piles — render row by row (all bottom cards first, then next row)
  let maxDepth = 0
  for i of 0..6 {
    tab := state.tableau(i)
    if tab.cardIndices.length > maxDepth {
      maxDepth = tab.cardIndices.length
    }
  }

  for let depth = 0; depth < maxDepth; depth += 1 {
    for pile of 0..6 {
      tab := state.tableau(pile)
      if depth < tab.cardIndices.length {
        ordered.push(tab.cardIndices[depth])
      }
    }
  }

  // Collect dragged card indices (to move them to end)
  let draggedCards: int[] = []
  let draggedSet: Set<int> = []
  if state.isDragging && state.selectedPileType >= 0 {
    if state.selectedPileType == 0 {
      srcPile := state.tableau(state.selectedPileIndex)
      draggedCards = srcPile.cardIndices.slice(state.selectedCardIndex, srcPile.cardIndices.length)
    } else if state.selectedPileType == 1 {
      if !state.waste.isEmpty() {
        draggedCards = [state.waste.topCardIndex()]
      }
    } else if state.selectedPileType == 2 {
      srcPile := state.foundation(state.selectedPileIndex)
      if !srcPile.isEmpty() {
        draggedCards = [srcPile.topCardIndex()]
      }
    }
  }

  for idx of draggedCards {
    draggedSet.add(idx)
  }

  // Separate into static and animating, moving dragged cards to top
  for idx of ordered {
    if idx < 0 || idx >= state.cards.length { continue }

    // Skip dragged cards — they'll be added at the end
    if draggedSet.has(idx) { continue }

    card := state.cards[idx]
    isFlipping := card.flipPhase != 0
    animating := isFlipping ||
                 (state.moveAnimActive && idx == state.moveCardIndex) ||
                 (state.dealAnimActive && idx == state.dealCardIndex)

    rc := RenderCard { cardIndex: idx, isAnimating: animating, isFlipping }

    if animating {
      plan.animatingCards.push(rc)
    } else {
      plan.staticCards.push(rc)
    }
  }

  // Add dragged cards last (on top of everything, as static cards)
  for idx of draggedCards {
    if idx < 0 || idx >= state.cards.length { continue }

    card := state.cards[idx]
    isFlipping := card.flipPhase != 0
    rc := RenderCard { cardIndex: idx, isAnimating: isFlipping, isFlipping }

    if isFlipping {
      plan.animatingCards.push(rc)
    } else {
      plan.staticCards.push(rc)
    }
  }

  return plan
}

function addDraw(world: WorldRenderPlan, textureId: int, vertices: RenderVertex[]): void {
  if textureId < 0 || vertices.length == 0 { return }
  world.draws.push(RenderDraw { textureId: textureId, vertices: vertices })
}

function addCardDraw(
  world: WorldRenderPlan,
  state: SolitaireState,
  library: CardLibrary,
  cardIndex: int
): void {
  if cardIndex < 0 || cardIndex >= state.cards.length { return }

  card := state.cards[cardIndex]
  def := library.getCard(card.cardId)
  if def == null { return }

  let sprite = def.back
  let textureId = def.back.textureId
  if card.faceUp {
    sprite = def.front
    textureId = def.front.textureId
  }

  verts: RenderVertex[] := []
  pushCardVertices(verts, card, sprite)
  addDraw(world, textureId, verts)
}

function addFlippingCard(
  world: WorldRenderPlan,
  state: SolitaireState,
  library: CardLibrary,
  cardIndex: int
): void {
  if cardIndex < 0 || cardIndex >= state.cards.length { return }

  card := state.cards[cardIndex]
  def := library.getCard(card.cardId)
  if def == null { return }

  frontVerts: RenderVertex[] := []
  backVerts: RenderVertex[] := []
  pushAnimatedCardVertices(frontVerts, backVerts, card, def.front, def.back)
  addDraw(world, def.front.textureId, frontVerts)
  addDraw(world, def.back.textureId, backVerts)
}

// Resolve static sprites and quad vertices for the current frame.
export function buildWorldRenderPlan(
  state: SolitaireState,
  library: CardLibrary
): WorldRenderPlan {
  orderedPlan := buildRenderPlan(state)
  world := WorldRenderPlan {}

  for ph of orderedPlan.placeholders {
    def := library.getCard(ph.spriteHint)
    if def == null { continue }

    verts: RenderVertex[] := []
    pushCardVerticesWithAlpha(
      verts,
      ph.x, ph.z, 0.0f,
      def.width, def.height,
      def.front,
      ph.alpha
    )
    addDraw(world, def.front.textureId, verts)
  }

  for rc of orderedPlan.staticCards {
    addCardDraw(world, state, library, rc.cardIndex)
  }

  for rc of orderedPlan.animatingCards {
    if rc.isFlipping {
      addFlippingCard(world, state, library, rc.cardIndex)
    } else {
      addCardDraw(world, state, library, rc.cardIndex)
    }
  }

  return world
}
