// Seahaven Towers — interactive sample entry module.

import { Suit, Rank, PlayingCard, Card, createDeck, cardId, cardBackId, foundationSuit, suitLabel, rankLabel, cardLabel } from "cardgame/cards"
import {
  Pile, Random, SeahavenState,
  initializeGame, updateCardPositions, isAnimating,
  createEmptyState, createGame,
  canPlaceOnTableau, canPlaceOnFoundation,
  moveTableauToReserve, moveReserveToReserve, moveReserveToTableau, moveTableauToTableau,
  moveReserveToFoundation, moveTableauToFoundation,
  autoMoveAvailableToFoundation, attemptAutoMove, checkWin,
  renderState, listLegalMoves,
  CardHit, findCardAtPosition,
  handleClick, handleDragStart, handleDragMove, handleDragEnd, cancelSelection,
  updateAnimations, CARD_VERTICAL_OFFSET
} from "./seahaven"
export {
  Pile, Random, SeahavenState,
  initializeGame, updateCardPositions, isAnimating,
  createEmptyState, createGame,
  canPlaceOnTableau, canPlaceOnFoundation,
  moveTableauToReserve, moveReserveToReserve, moveReserveToTableau, moveTableauToTableau,
  moveReserveToFoundation, moveTableauToFoundation,
  autoMoveAvailableToFoundation, attemptAutoMove, checkWin,
  renderState, listLegalMoves,
  CardHit, findCardAtPosition,
  handleClick, handleDragStart, handleDragMove, handleDragEnd, cancelSelection,
  updateAnimations, CARD_VERTICAL_OFFSET
} from "./seahaven"

import { CardSprite, CardDefinition, CardLibrary, spriteFromAtlasIndex, spriteFromAtlasGrid } from "cardgame/sprite"
import { RenderVertex, pushCardVertices, pushCardVerticesWithAlpha, pushAnimatedCardVertices } from "cardgame/vertex"
import { Camera, CameraFrame, BoundingBox, WorldHit, computeSeahavenBounds, updateAutoCamera, hasCameraMoved, computeIdealFrame, screenToWorld, computeWorldMVP, computeUIMVP } from "./camera"
import { Mat4 } from "cardgame/matrix"
import { RenderCard, RenderPlaceholder, RenderPlan, RenderDraw, WorldRenderPlan, buildRenderPlan, buildWorldRenderPlan } from "./render"
import { GameButton, layoutTopRight, hitTest, onMouseDown, onMouseUp, onMouseMove, cancelPress, buttonAlpha, triggerSpin, updateButtonAnimation, buttonRotation, pushButtonBackgroundVertices, pushButtonIconVertices, buildUIRenderPlan } from "./button"
import { loadPlayingCardLibrary, TEXTURE_PLAYING_CARDS, playingCardTexturePaths } from "cardgame/content"
import { PI, sin, cos, tan, sqrt, abs, floor, ceil, fmod, min, max, clamp } from "cardgame/math"
import { AppState, createApp, appNewGame, appUpdate, appClick, appDragStart, appDragMove, appDragEnd, appCancelInteraction, appAutoComplete, appIsWon } from "./app-state"
import { HostInput, initCamera, hostMouseDown, hostMouseUp, hostMouseMove, hostCancelInteraction, hostUpdate } from "./host"