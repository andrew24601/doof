import { Suit, Rank, cardId, cardBackId } from "./cards"
import { CardDefinition, CardLibrary, spriteFromAtlasIndex } from "./sprite"

export const TEXTURE_PLAYING_CARDS: int = 0

const CARD_ATLAS_COLS: int = 14
const CARD_ATLAS_ROWS: int = 4
const CARD_WIDTH: float = 80.0f
const CARD_HEIGHT: float = 120.0f

export function loadPlayingCardLibrary(library: CardLibrary): void {
  backSprite := spriteFromAtlasIndex(
    TEXTURE_PLAYING_CARDS, 13, CARD_ATLAS_COLS, CARD_ATLAS_ROWS
  )

  library.addCard(CardDefinition {
    id: cardBackId(),
    front: backSprite,
    back: backSprite,
    width: CARD_WIDTH,
    height: CARD_HEIGHT
  })

  suits := [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs]
  ranks := [Rank.Ace, Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six,
    Rank.Seven, Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King]

  for s of 0..3 {
    for r of 0..12 {
      suit := suits[s]
      rank := ranks[r]
      atlasIndex := s * CARD_ATLAS_COLS + r

      frontSprite := spriteFromAtlasIndex(
        TEXTURE_PLAYING_CARDS, atlasIndex, CARD_ATLAS_COLS, CARD_ATLAS_ROWS
      )

      library.addCard(CardDefinition {
        id: cardId(suit, rank),
        front: frontSprite,
        back: backSprite,
        width: CARD_WIDTH,
        height: CARD_HEIGHT
      })
    }
  }
}

export function playingCardTexturePaths(basePath: string, fallbackAtlasPath: string): string[] {
  paths: string[] := []
  if basePath != "" {
    paths.push(basePath + "images/card_atlas.png")
    paths.push(basePath + "../Resources/images/card_atlas.png")
    paths.push(basePath + "../images/card_atlas.png")
    if !startsWithSlash(fallbackAtlasPath) {
      paths.push(basePath + fallbackAtlasPath)
    }
  }
  paths.push(fallbackAtlasPath)
  return paths
}

function startsWithSlash(value: string): bool {
  return value.length > 0 && value.charAt(0) == "/"
}

export function texturePaths(basePath: string): string[] {
  paths := playingCardTexturePaths(basePath, "samples/solitaire/images/card_atlas.png")
  paths.push("samples/seahaven-towers/images/card_atlas.png")
  return paths
}