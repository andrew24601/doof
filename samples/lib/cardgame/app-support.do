import { GameButton } from "./button"
import { loadPlayingCardLibrary } from "./content"
import { CardLibrary } from "./sprite"

export function createPlayingCardLibrary(): CardLibrary {
  library := CardLibrary {}
  loadPlayingCardLibrary(library)
  return library
}

export function createNewGameButton(label: string): GameButton {
  button := GameButton {}
  button.label = label
  button.width = 80.0f
  button.height = 80.0f
  return button
}