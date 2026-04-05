// Application state — wraps all game objects into a single root.

import { SolitaireState, initializeGame, updateCardPositions } from "./game"
import { Camera } from "./camera"
import { CardLibrary } from "cardgame/sprite"
import { GameButton, updateButtonAnimation } from "cardgame/button"
import { createPlayingCardLibrary, createNewGameButton } from "cardgame/app-support"
import { updateAnimations, attemptAutoMove, checkWin } from "./rules"
import {
  handleClick, handleDragStart, handleDragMove, handleDragEnd, cancelSelection
} from "./input"

export class AppState {
  state: SolitaireState
  camera: Camera
  cardLibrary: CardLibrary
  button: GameButton
}

// Create a fully initialized application.
export function createApp(seed: int): AppState {
  state := SolitaireState {}
  initializeGame(state, seed)

  camera := Camera {}
  cardLibrary := createPlayingCardLibrary()
  button := createNewGameButton("New Game")

  return AppState {
    state: state,
    camera: camera,
    cardLibrary: cardLibrary,
    button: button
  }
}

// Start a new game, preserving camera and card library.
export function appNewGame(app: AppState, seed: int): void {
  app.state = SolitaireState {}
  initializeGame(app.state, seed)
}

// Advance animations. Returns true if still animating.
export function appUpdate(app: AppState, deltaTime: float): bool {
  worldAnimating := updateAnimations(app.state, deltaTime)
  buttonAnimating := updateButtonAnimation(app.button, deltaTime)
  return worldAnimating || buttonAnimating
}

export function appClick(app: AppState, worldX: float, worldZ: float): bool {
  return handleClick(app.state, worldX, worldZ)
}

export function appDragStart(app: AppState, worldX: float, worldZ: float): void {
  handleDragStart(app.state, worldX, worldZ)
}

export function appDragMove(app: AppState, worldX: float, worldZ: float): void {
  handleDragMove(app.state, worldX, worldZ)
}

export function appDragEnd(app: AppState, worldX: float, worldZ: float): void {
  handleDragEnd(app.state, worldX, worldZ)
}

export function appCancelInteraction(app: AppState): bool {
  if !app.state.isDragging && app.state.selectedPileType < 0 {
    return false
  }

  updateCardPositions(app.state)
  cancelSelection(app.state)
  return true
}

export function appAutoComplete(app: AppState): void {
  attemptAutoMove(app.state)
}

export function appIsWon(app: AppState): bool {
  return checkWin(app.state)
}
