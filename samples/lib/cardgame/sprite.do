export class CardSprite {
  textureId: int = -1
  u0: float = 0.0f
  v0: float = 0.0f
  u1: float = 1.0f
  v1: float = 1.0f

  isValid(): bool => textureId >= 0
}

export function spriteFromAtlasGrid(
  textureId: int, col: int, row: int, cols: int, rows: int
): CardSprite {
  let colF: float = col
  let rowF: float = row
  let colsF: float = cols
  let rowsF: float = rows
  uSize := 1.0f / colsF
  vSize := 1.0f / rowsF

  return CardSprite {
    textureId,
    u0: colF * uSize,
    v0: rowF * vSize,
    u1: (colF + 1.0f) * uSize,
    v1: (rowF + 1.0f) * vSize
  }
}

export function spriteFromAtlasIndex(
  textureId: int, index: int, cols: int, rows: int
): CardSprite {
  col := index % cols
  row := index \ cols
  return spriteFromAtlasGrid(textureId, col, row, cols, rows)
}

export class CardDefinition {
  id: string = ""
  front: CardSprite = {}
  back: CardSprite = {}
  width: float = 80.0f
  height: float = 120.0f
}

export class CardLibrary {
  private ids: string[] = []
  private defs: CardDefinition[] = []

  addCard(def: CardDefinition): void {
    for i of 0..<ids.length {
      if ids[i] == def.id {
        defs[i] = def
        return
      }
    }
    ids.push(def.id)
    defs.push(def)
  }

  getCard(id: string): CardDefinition | null {
    for i of 0..<ids.length {
      if ids[i] == id {
        return defs[i]
      }
    }
    return null
  }

  hasCard(id: string): bool {
    for existingId of ids {
      if existingId == id { return true }
    }
    return false
  }

  count(): int => ids.length
}