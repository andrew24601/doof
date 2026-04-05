// Application state — wraps the Seahaven game, camera, card library, and UI.

import { SeahavenState, initializeGame, updateCardPositions, updateAnimations, attemptAutoMove, checkWin, handleClick, handleDragStart, handleDragMove, handleDragEnd, cancelSelection, undoMove, redoMove } from "./seahaven"
import { Camera } from "./camera"
import { CardLibrary } from "cardgame/sprite"
import { GameButton, updateButtonAnimation } from "cardgame/button"
import { createPlayingCardLibrary, createNewGameButton } from "cardgame/app-support"

export class AppState {
  state: SeahavenState
  camera: Camera
  cardLibrary: CardLibrary
  button: GameButton
}

export function createApp(seed: int): AppState {
  state := SeahavenState {}
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

export function appNewGame(app: AppState, seed: int): void {
  app.state = SeahavenState {}
  initializeGame(app.state, seed)
}

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

export function appUndo(app: AppState): bool {
  appCancelInteraction(app)
  return undoMove(app.state)
}

export function appRedo(app: AppState): bool {
  appCancelInteraction(app)
  return redoMove(app.state)
}

export function appAutoComplete(app: AppState): void {
  attemptAutoMove(app.state)
}

export function appIsWon(app: AppState): bool {
  return checkWin(app.state)
}