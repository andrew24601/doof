// Solitaire — main entry point
// This module ties together game logic, visual layer, application state,
// and host input handling, serving as the primary import for a rendering host.
//
// Each module is imported (to generate C++ #include directives) and then
// re-exported so a host only needs to include solitaire.hpp.

// --- Game logic ---

import { Suit, Rank, PlayingCard, Card, createDeck, cardId, cardBackId, foundationSuit } from "cardgame/cards"

import {
  Pile, SolitaireState, Random, shuffle,
  initializeGame, updateCardPositions, isAnimating, CARD_VERTICAL_OFFSET
} from "./game"
export {
  Pile, SolitaireState, Random, shuffle,
  initializeGame, updateCardPositions, isAnimating, CARD_VERTICAL_OFFSET
} from "./game"

import {
  canPlaceOnTableau, canPlaceOnFoundation,
  dealFromStock, attemptAutoMove, checkWin, startMoveAnim,
  tryRevealTopCard, updateAnimations,
  updateCardFlip, updateDealAnimation, updateMoveAnimation
} from "./rules"

import {
  CardHit, findCardAtPosition,
  handleClick, handleDragStart, handleDragMove, handleDragEnd,
  cancelSelection
} from "./input"

// --- Visual layer ---

import { CardSprite, CardDefinition, CardLibrary, spriteFromAtlasIndex, spriteFromAtlasGrid } from "cardgame/sprite"

import { RenderVertex, pushCardVertices, pushCardVerticesWithAlpha, pushAnimatedCardVertices } from "cardgame/vertex"

import {
  Camera, CameraFrame, BoundingBox, WorldHit,
  computeSolitaireBounds, updateAutoCamera, hasCameraMoved,
  computeIdealFrame, screenToWorld, computeWorldMVP, computeUIMVP
} from "./camera"

import { Mat4 } from "cardgame/matrix"

import {
  RenderCard, RenderPlaceholder, RenderPlan,
  RenderDraw, WorldRenderPlan,
  buildRenderPlan, buildWorldRenderPlan
} from "./render"

import {
  GameButton, layoutTopRight, hitTest, onMouseDown, onMouseUp, onMouseMove,
  cancelPress, buttonAlpha, triggerSpin, updateButtonAnimation, buttonRotation,
  pushButtonIconVertices, buildUIRenderPlan
} from "cardgame/button"

import { loadPlayingCardLibrary, TEXTURE_PLAYING_CARDS, playingCardTexturePaths } from "cardgame/content"

import { PI, sin, cos, tan, sqrt, abs, floor, ceil, fmod, min, max, clamp } from "cardgame/math"

// --- Application state & host input ---

import {
  AppState, createApp, appNewGame, appUpdate,
  appClick, appDragStart, appDragMove, appDragEnd, appCancelInteraction,
  appAutoComplete, appIsWon
} from "./app-state"

import {
  HostInput, initCamera,
  hostMouseDown, hostMouseUp, hostMouseMove, hostCancelInteraction, hostUpdate
} from "./host"
