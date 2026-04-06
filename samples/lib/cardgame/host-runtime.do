import { TEXTURE_PLAYING_CARDS, playingCardTexturePaths } from "./content"
import { Mat4 } from "./matrix"
import { WorldRenderPlan } from "./render-plan"
import { NativeBoardgameEventKind, NativeBoardgameKey } from "./types"

export { NativeBoardgameEventKind, NativeBoardgameKey } from "./types"

export import class NativeBoardgameEvent from "./native_boardgame_host.hpp" as doof_boardgame_host::NativeBoardgameEvent {
  kind(): NativeBoardgameEventKind
  x(): float
  y(): float
  wheelY(): float
  key(): NativeBoardgameKey
}

export import class NativeBoardgameHost from "./native_boardgame_host.hpp" as doof_boardgame_host::NativeBoardgameHost {
  static create(title: string, width: int, height: int): Result<NativeBoardgameHost, string>
  isOpen(): bool
  pollEvents(canNap: bool): NativeBoardgameEvent[]
  frameDeltaSeconds(): float
  windowWidth(): int
  windowHeight(): int
  pixelWidth(): int
  pixelHeight(): int
  dpiScale(): float
  assetBasePath(): string
  loadTextureWithId(textureId: int, path: string): bool
  createSolidColorTexture(r: int, g: int, b: int, a: int): int
  ticks(): int
  render(world: WorldRenderPlan, worldMvp: Mat4, ui: WorldRenderPlan, uiMvp: Mat4): void
  close(): void
}

export function loadSharedCardAtlas(host: NativeBoardgameHost, fallbackAtlasPath: string): Result<void, string> {
  paths := playingCardTexturePaths(host.assetBasePath(), fallbackAtlasPath)
  for path of paths {
    if host.loadTextureWithId(TEXTURE_PLAYING_CARDS, path) {
      return Success()
    }
  }

  return Failure { error: "Failed to load playing card atlas from any known sample path." }
}
