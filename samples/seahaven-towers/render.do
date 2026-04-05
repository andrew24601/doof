// Render ordering for Seahaven Towers.

import { SeahavenState } from "./seahaven"
import { CardLibrary } from "cardgame/sprite"
import { RenderDraw, WorldRenderPlan } from "cardgame/render-plan"
import {
  RenderVertex,
  pushCardVertices,
  pushCardVerticesWithAlpha
} from "cardgame/vertex"

export class RenderCard {
  cardIndex: int = -1
  isAnimating: bool = false
  isFlipping: bool = false
}

export class RenderPlaceholder {
  x: float = 0.0f
  z: float = 0.0f
  spriteHint: string = ""
  alpha: float = 0.3f
}

export class RenderPlan {
  placeholders: RenderPlaceholder[] = []
  staticCards: RenderCard[] = []
  animatingCards: RenderCard[] = []
}

export { RenderDraw, WorldRenderPlan } from "cardgame/render-plan"

export function buildRenderPlan(state: SeahavenState): RenderPlan {
  plan := RenderPlan {}

  suitNames := ["0_1", "1_1", "2_1", "3_1"]
  for i of 0..3 {
    foundation := state.foundation(i)
    plan.placeholders.push(RenderPlaceholder {
      x: foundation.x,
      z: foundation.z,
      spriteHint: `card_${suitNames[i]}`,
      alpha: 0.3f
    })
  }

  for reserve of state.reserves {
    if reserve.isEmpty() {
      plan.placeholders.push(RenderPlaceholder {
        x: reserve.x,
        z: reserve.z,
        spriteHint: "card_back",
        alpha: 0.18f
      })
    }
  }

  for tableau of state.tableaus {
    if tableau.isEmpty() {
      plan.placeholders.push(RenderPlaceholder {
        x: tableau.x,
        z: tableau.z,
        spriteHint: "card_back",
        alpha: 0.22f
      })
    }
  }

  ordered: int[] := []

  for i of 0..3 {
    for idx of state.foundation(i).cardIndices {
      ordered.push(idx)
    }
  }

  for reserve of state.reserves {
    for idx of reserve.cardIndices {
      ordered.push(idx)
    }
  }

  let maxDepth = 0
  for tableau of state.tableaus {
    if tableau.cardIndices.length > maxDepth {
      maxDepth = tableau.cardIndices.length
    }
  }

  for let depth = 0; depth < maxDepth; depth += 1 {
    for tableau of 0..<state.tableaus.length {
      pile := state.tableaus[tableau]
      if depth < pile.cardIndices.length {
        ordered.push(pile.cardIndices[depth])
      }
    }
  }

  let draggedCards: int[] = []
  let movingCard = -1
  if state.isDragging && state.selectedPileType == 0 {
    pile := state.tableau(state.selectedPileIndex)
    if state.selectedCardIndex >= 0 && state.selectedCardIndex < pile.cardIndices.length {
      draggedCards = pile.cardIndices.slice(state.selectedCardIndex, pile.cardIndices.length)
    }
  } else if state.isDragging && state.selectedPileType == 1 {
    cardIndex := state.reserve(state.selectedPileIndex).topCardIndex()
    if cardIndex >= 0 {
      draggedCards = [cardIndex]
    }
  }

  if state.moveAnimActive {
    movingCard = state.moveCardIndex
  }

  for idx of ordered {
    if idx < 0 || idx >= state.cards.length { continue }
    if draggedCards.contains(idx) { continue }
    if idx == movingCard { continue }
    plan.staticCards.push(RenderCard { cardIndex: idx })
  }

  for idx of draggedCards {
    if idx < 0 || idx >= state.cards.length { continue }
    plan.staticCards.push(RenderCard { cardIndex: idx })
  }

  if movingCard >= 0 && movingCard < state.cards.length {
    plan.animatingCards.push(RenderCard { cardIndex: movingCard, isAnimating: true })
  }

  return plan
}

function addDraw(world: WorldRenderPlan, textureId: int, vertices: RenderVertex[]): void {
  if textureId < 0 || vertices.length == 0 { return }
  world.draws.push(RenderDraw { textureId: textureId, vertices: vertices })
}

function addCardDraw(
  world: WorldRenderPlan,
  state: SeahavenState,
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

export function buildWorldRenderPlan(
  state: SeahavenState,
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
    addCardDraw(world, state, library, rc.cardIndex)
  }

  return world
}