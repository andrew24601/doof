// Seahaven Towers game state, move rules, drag-and-drop, and text rendering.

import { Suit, Rank, PlayingCard, Card, createDeck, cardId, foundationSuit, cardLabel, suitLabel } from "cardgame/cards"
import { abs } from "cardgame/math"

const TABLEAU_START_X: float = -420.0f
const TABLEAU_SPACING: float = 92.0f
const TABLEAU_Z: float = 90.0f
const RESERVE_START_X: float = -420.0f
const RESERVE_SPACING: float = 92.0f
const RESERVE_Z: float = -70.0f
const FOUNDATION_START_X: float = 60.0f
const FOUNDATION_SPACING: float = 92.0f
const FOUNDATION_Z: float = -70.0f
export const CARD_VERTICAL_OFFSET: float = 24.0f

export class Pile {
  label: string = ""
  cardIndices: int[] = []
  x: float = 0.0f
  z: float = 0.0f

  isEmpty(): bool => cardIndices.length == 0

  topCardIndex(): int {
    if cardIndices.length == 0 { return -1 }
    return cardIndices[cardIndices.length - 1]
  }

  popCard(): int {
    if cardIndices.length == 0 { return -1 }
    idx := cardIndices[cardIndices.length - 1]
    cardIndices = cardIndices.slice(0, cardIndices.length - 1)
    return idx
  }

  pushCard(cardIndex: int): void {
    cardIndices.push(cardIndex)
  }

  popCardsFrom(startIndex: int): int[] {
    if startIndex < 0 || startIndex >= cardIndices.length { return [] }

    moved := cardIndices.slice(startIndex, cardIndices.length)
    cardIndices = cardIndices.slice(0, startIndex)
    return moved
  }

  pushCards(cardIndexes: int[]): void {
    for cardIndex of cardIndexes {
      cardIndices.push(cardIndex)
    }
  }
}

export class Random {
  state: long = 0L

  nextInt(bound: int): int {
    if bound <= 0 { return 0 }

    state = (state * 1103515245L + 12345L) % 2147483648L
    if state < 0L {
      state = state + 2147483648L
    }

    return int(state % long(bound))
  }
}

export function shuffle(arr: int[], rng: Random): void {
  for let i = arr.length - 1; i > 0; i -= 1 {
    j := rng.nextInt(i + 1)
    temp := arr[i]
    arr[i] = arr[j]
    arr[j] = temp
  }
}

export class SeahavenState {
  seed: int = 0
  cards: Card[] = []
  cardInfo: PlayingCard[] = []
  tableaus: Pile[] = []
  reserves: Pile[] = []
  foundations: Map<Suit, Pile> = {}
  movesPlayed: int = 0
  undoStack: SeahavenSnapshot[] = []
  redoStack: SeahavenSnapshot[] = []

  selectedPileType: int = -1   // -1=none, 0=tableau, 1=reserve
  selectedPileIndex: int = -1
  selectedCardIndex: int = -1
  isDragging: bool = false
  dragOffsetX: float = 0.0f
  dragOffsetZ: float = 0.0f

  moveAnimActive: bool = false
  moveCardIndex: int = -1
  moveProgress: float = 0.0f
  moveStartX: float = 0.0f
  moveStartZ: float = 0.0f
  moveEndX: float = 0.0f
  moveEndZ: float = 0.0f
  moveAnimDuration: float = 0.22f

  tableau(i: int): Pile {
    return tableaus[i]
  }

  reserve(i: int): Pile {
    return reserves[i]
  }

  foundation(i: int): Pile {
    return foundations[foundationSuit(i)]
  }
}

export class SeahavenSnapshot {
  tableaus: int[][]
  reserves: int[][]
  foundations: Map<Suit, int[]>
  movesPlayed: int
}

export class CardHit {
  pileType: int = -1     // 0=tableau, 1=reserve, 2=foundation
  pileIndex: int = -1
  cardIndex: int = -1
  found: bool = false
}

function foundationSuitAt(index: int): Suit {
  return case index {
    0 -> Suit.Spades,
    1 -> Suit.Hearts,
    2 -> Suit.Diamonds,
    _ -> Suit.Clubs
  }
}

function resetPiles(state: SeahavenState): void {
  state.tableaus = []
  for i of 0..9 {
    state.tableaus.push(Pile { label: `T${i + 1}` })
  }

  state.reserves = []
  for i of 0..3 {
    state.reserves.push(Pile { label: `R${i + 1}` })
  }

  state.foundations = {
    .Spades: Pile { label: "FS" },
    .Hearts: Pile { label: "FH" },
    .Diamonds: Pile { label: "FD" },
    .Clubs: Pile { label: "FC" }
  }

  for i of 0..9 {
    state.tableau(i).x = -420.0f + float(i) * 92.0f
    state.tableau(i).z = 90.0f
  }

  for i of 0..3 {
    state.reserve(i).x = -420.0f + float(i) * 92.0f
    state.reserve(i).z = -70.0f
    foundation := state.foundation(i)
    foundation.x = 60.0f + float(i) * 92.0f
    foundation.z = -70.0f
  }
}

function foundationPile(state: SeahavenState, suit: Suit): Pile {
  return state.foundations[suit]
}

function createVisualCards(cardInfo: PlayingCard[]): Card[] {
  cards: Card[] := []
  for i of 0..<cardInfo.length {
    info := cardInfo[i]
    cards.push(Card {
      cardId: cardId(info.suit, info.rank),
      faceUp: true
    })
  }
  return cards
}

function describePileCards(state: SeahavenState, pile: Pile): string {
  if pile.isEmpty() { return "--" }

  let text = ""
  for i of 0..<pile.cardIndices.length {
    if i > 0 {
      text += " "
    }
    text += cardLabel(state.cardInfo[pile.cardIndices[i]])
  }
  return text
}

function describeTopCard(state: SeahavenState, pile: Pile): string {
  if pile.isEmpty() { return "--" }
  return cardLabel(state.cardInfo[pile.topCardIndex()])
}

function moveTopCard(source: Pile, target: Pile): int {
  cardIndex := source.popCard()
  if cardIndex >= 0 {
    target.pushCard(cardIndex)
  }
  return cardIndex
}

function tableauCardLabel(state: SeahavenState, tableauIndex: int): string {
  pile := state.tableaus[tableauIndex]
  if pile.isEmpty() { return "--" }
  return cardLabel(state.cardInfo[pile.topCardIndex()])
}

function reserveCardLabel(state: SeahavenState, reserveIndex: int): string {
  pile := state.reserves[reserveIndex]
  if pile.isEmpty() { return "--" }
  return cardLabel(state.cardInfo[pile.topCardIndex()])
}

function clearSelection(state: SeahavenState): void {
  state.selectedPileType = -1
  state.selectedPileIndex = -1
  state.selectedCardIndex = -1
  state.isDragging = false
  state.dragOffsetX = 0.0f
  state.dragOffsetZ = 0.0f
}

function cloneCardIndices(cardIndices: int[]): int[] {
  return cardIndices.slice(0, cardIndices.length)
}

function captureSnapshot(state: SeahavenState): SeahavenSnapshot {
  tableaus: int[][] := []
  for pile of state.tableaus {
    tableaus.push(cloneCardIndices(pile.cardIndices))
  }

  reserves: int[][] := []
  for pile of state.reserves {
    reserves.push(cloneCardIndices(pile.cardIndices))
  }

  foundations := {
    Suit.Spades: cloneCardIndices(foundationPile(state, Suit.Spades).cardIndices),
    Suit.Hearts: cloneCardIndices(foundationPile(state, Suit.Hearts).cardIndices),
    Suit.Diamonds: cloneCardIndices(foundationPile(state, Suit.Diamonds).cardIndices),
    Suit.Clubs: cloneCardIndices(foundationPile(state, Suit.Clubs).cardIndices)
  }

  return SeahavenSnapshot {
    tableaus: tableaus,
    reserves: reserves,
    foundations: foundations,
    movesPlayed: state.movesPlayed
  }
}

function restoreSnapshot(state: SeahavenState, snapshot: SeahavenSnapshot): void {
  for i of 0..<state.tableaus.length {
    if i < snapshot.tableaus.length {
      state.tableaus[i].cardIndices = cloneCardIndices(snapshot.tableaus[i])
    } else {
      state.tableaus[i].cardIndices = []
    }
  }

  for i of 0..<state.reserves.length {
    if i < snapshot.reserves.length {
      state.reserves[i].cardIndices = cloneCardIndices(snapshot.reserves[i])
    } else {
      state.reserves[i].cardIndices = []
    }
  }

  foundationPile(state, Suit.Spades).cardIndices = cloneCardIndices(snapshot.foundations[Suit.Spades])
  foundationPile(state, Suit.Hearts).cardIndices = cloneCardIndices(snapshot.foundations[Suit.Hearts])
  foundationPile(state, Suit.Diamonds).cardIndices = cloneCardIndices(snapshot.foundations[Suit.Diamonds])
  foundationPile(state, Suit.Clubs).cardIndices = cloneCardIndices(snapshot.foundations[Suit.Clubs])
  state.movesPlayed = snapshot.movesPlayed
  updateCardPositions(state)
  clearSelection(state)
}

function commitRecordedMove(state: SeahavenState, before: SeahavenSnapshot, moveCount: int): bool {
  state.undoStack.push(before)
  state.redoStack = []
  state.movesPlayed += moveCount
  updateCardPositions(state)
  return true
}

export function createEmptyState(): SeahavenState {
  state := SeahavenState {}
  state.cardInfo = createDeck()
  state.cards = createVisualCards(state.cardInfo)
  resetPiles(state)
  clearSelection(state)
  updateCardPositions(state)
  return state
}

export function createGame(seed: int): SeahavenState {
  state := createEmptyState()
  initializeGame(state, seed)
  return state
}

export function initializeGame(state: SeahavenState, seed: int): void {
  state.seed = seed
  state.cardInfo = createDeck()
  state.cards = createVisualCards(state.cardInfo)
  state.movesPlayed = 0
  state.undoStack = []
  state.redoStack = []
  state.moveAnimActive = false
  state.moveCardIndex = -1
  state.moveProgress = 0.0f
  resetPiles(state)
  clearSelection(state)

  deck: int[] := []
  for i of 0..51 {
    deck.push(i)
  }

  rng := Random { state: seed }
  shuffle(deck, rng)

  let deckIndex = 0

  for reserve of 0..1 {
    state.reserve(reserve).pushCard(deck[deckIndex])
    deckIndex += 1
  }

  for tableau of 0..9 {
    for cardSlot of 0..4 {
      state.tableau(tableau).pushCard(deck[deckIndex])
      deckIndex += 1
    }
  }

  updateCardPositions(state)
}

export function updateCardPositions(state: SeahavenState): void {
  for reserve of state.reserves {
    for i of 0..<reserve.cardIndices.length {
      cardIdx := reserve.cardIndices[i]
      if cardIdx < 0 || cardIdx >= state.cards.length { continue }
      card := state.cards[cardIdx]
      card.x = reserve.x
      card.z = reserve.z
      card.y = 0.0f
      card.faceUp = true
    }
  }

  for i of 0..3 {
    pile := state.foundation(i)
    for j of 0..<pile.cardIndices.length {
      cardIdx := pile.cardIndices[j]
      if cardIdx < 0 || cardIdx >= state.cards.length { continue }
      card := state.cards[cardIdx]
      card.x = pile.x
      card.z = pile.z
      card.y = 0.0f
      card.faceUp = true
    }
  }

  for tableau of state.tableaus {
    let currentZ = tableau.z
    for i of 0..<tableau.cardIndices.length {
      cardIdx := tableau.cardIndices[i]
      if cardIdx < 0 || cardIdx >= state.cards.length { continue }
      card := state.cards[cardIdx]
      card.x = tableau.x
      card.z = currentZ
      card.y = 0.0f
      card.faceUp = true
      currentZ += CARD_VERTICAL_OFFSET
    }
  }
}

export function isAnimating(state: SeahavenState): bool => state.moveAnimActive

function startMoveAnim(
  state: SeahavenState,
  cardIndex: int,
  foundationIndex: int,
  startX: float,
  startZ: float
): void {
  if cardIndex < 0 || cardIndex >= state.cards.length { return }

  target := state.foundation(foundationIndex)
  state.moveAnimActive = true
  state.moveCardIndex = cardIndex
  state.moveProgress = 0.0f
  state.moveStartX = startX
  state.moveStartZ = startZ
  state.moveEndX = target.x
  state.moveEndZ = target.z
  state.cards[cardIndex].y = 0.0f
}

export function canPlaceOnTableau(
  card: PlayingCard,
  pile: Pile,
  cards: PlayingCard[]
): bool {
  if pile.isEmpty() {
    return true
  }

  topCard := cards[pile.topCardIndex()]
  return card.suit == topCard.suit && card.rankValue() == topCard.rankValue() - 1
}

function isMovableTableauRun(pile: Pile, startIndex: int, cards: PlayingCard[]): bool {
  if startIndex < 0 || startIndex >= pile.cardIndices.length { return false }

  for i of startIndex..<(pile.cardIndices.length - 1) {
    lowerCard := cards[pile.cardIndices[i]]
    upperCard := cards[pile.cardIndices[i + 1]]
    if lowerCard.suit != upperCard.suit {
      return false
    }
    if upperCard.rankValue() != lowerCard.rankValue() - 1 {
      return false
    }
  }

  return true
}

function countEmptyReserves(state: SeahavenState): int {
  let emptyCount = 0
  for reserve of state.reserves {
    if reserve.isEmpty() {
      emptyCount += 1
    }
  }
  return emptyCount
}

function countUsableEmptyTableaus(state: SeahavenState, fromTableauIndex: int, toTableauIndex: int): int {
  let emptyCount = 0
  for tableau of 0..<state.tableaus.length {
    if tableau == fromTableauIndex { continue }
    if tableau == toTableauIndex && state.tableaus[tableau].isEmpty() { continue }
    if state.tableaus[tableau].isEmpty() {
      emptyCount += 1
    }
  }
  return emptyCount
}

export function maxSupermoveLength(
  state: SeahavenState,
  fromTableauIndex: int,
  toTableauIndex: int
): int {
  let capacity = countEmptyReserves(state) + 1
  emptyTableaus := countUsableEmptyTableaus(state, fromTableauIndex, toTableauIndex)
  for i of 0..<emptyTableaus {
    capacity *= 2
  }
  return capacity
}

export function canPlaceOnFoundation(
  card: PlayingCard,
  suit: Suit,
  pile: Pile,
  cards: PlayingCard[]
): bool {
  if card.suit != suit {
    return false
  }

  if pile.isEmpty() {
    return card.rank == .Ace
  }

  topCard := cards[pile.topCardIndex()]
  return card.rankValue() == topCard.rankValue() + 1
}

export function moveTableauToReserve(
  state: SeahavenState,
  tableauIndex: int,
  reserveIndex: int
): bool {
  if tableauIndex < 0 || tableauIndex >= state.tableaus.length { return false }
  if reserveIndex < 0 || reserveIndex >= state.reserves.length { return false }

  source := state.tableaus[tableauIndex]
  target := state.reserves[reserveIndex]
  if source.isEmpty() || !target.isEmpty() { return false }

  before := captureSnapshot(state)
  movedCard := moveTopCard(source, target)
  if movedCard < 0 { return false }
  return commitRecordedMove(state, before, 1)
}

export function moveReserveToReserve(
  state: SeahavenState,
  fromReserveIndex: int,
  toReserveIndex: int
): bool {
  if fromReserveIndex < 0 || fromReserveIndex >= state.reserves.length { return false }
  if toReserveIndex < 0 || toReserveIndex >= state.reserves.length { return false }
  if fromReserveIndex == toReserveIndex { return false }

  source := state.reserves[fromReserveIndex]
  target := state.reserves[toReserveIndex]
  if source.isEmpty() || !target.isEmpty() { return false }

  before := captureSnapshot(state)
  movedCard := moveTopCard(source, target)
  if movedCard < 0 { return false }
  return commitRecordedMove(state, before, 1)
}

export function moveReserveToTableau(
  state: SeahavenState,
  reserveIndex: int,
  tableauIndex: int
): bool {
  if reserveIndex < 0 || reserveIndex >= state.reserves.length { return false }
  if tableauIndex < 0 || tableauIndex >= state.tableaus.length { return false }

  source := state.reserves[reserveIndex]
  target := state.tableaus[tableauIndex]
  if source.isEmpty() { return false }

  card := state.cardInfo[source.topCardIndex()]
  if !canPlaceOnTableau(card, target, state.cardInfo) { return false }

  before := captureSnapshot(state)
  movedCard := moveTopCard(source, target)
  if movedCard < 0 { return false }
  return commitRecordedMove(state, before, 1)
}

export function moveTableauRunToTableau(
  state: SeahavenState,
  fromTableauIndex: int,
  startCardIndex: int,
  toTableauIndex: int
): bool {
  if fromTableauIndex < 0 || fromTableauIndex >= state.tableaus.length { return false }
  if toTableauIndex < 0 || toTableauIndex >= state.tableaus.length { return false }
  if fromTableauIndex == toTableauIndex { return false }

  source := state.tableaus[fromTableauIndex]
  target := state.tableaus[toTableauIndex]
  if source.isEmpty() { return false }
  if !isMovableTableauRun(source, startCardIndex, state.cardInfo) { return false }

  runLength := source.cardIndices.length - startCardIndex
  if runLength <= 0 { return false }

  leadingCard := state.cardInfo[source.cardIndices[startCardIndex]]
  if !canPlaceOnTableau(leadingCard, target, state.cardInfo) { return false }
  if runLength > maxSupermoveLength(state, fromTableauIndex, toTableauIndex) {
    return false
  }

  before := captureSnapshot(state)
  movedCards := source.popCardsFrom(startCardIndex)
  if movedCards.length != runLength { return false }

  target.pushCards(movedCards)
  return commitRecordedMove(state, before, 1)
}

export function moveTableauToTableau(
  state: SeahavenState,
  fromTableauIndex: int,
  toTableauIndex: int
): bool {
  if fromTableauIndex < 0 || fromTableauIndex >= state.tableaus.length { return false }
  source := state.tableaus[fromTableauIndex]
  if source.isEmpty() { return false }
  return moveTableauRunToTableau(
    state,
    fromTableauIndex,
    source.cardIndices.length - 1,
    toTableauIndex
  )
}

function moveReserveToFoundationInternal(
  state: SeahavenState,
  reserveIndex: int,
  recordHistory: bool
): bool {
  if reserveIndex < 0 || reserveIndex >= state.reserves.length { return false }

  source := state.reserves[reserveIndex]
  if source.isEmpty() { return false }

  card := state.cardInfo[source.topCardIndex()]
  target := foundationPile(state, card.suit)
  if !canPlaceOnFoundation(card, card.suit, target, state.cardInfo) { return false }

  before := captureSnapshot(state)
  movedCard := moveTopCard(source, target)
  if movedCard < 0 { return false }

  if recordHistory {
    return commitRecordedMove(state, before, 1)
  }

  state.movesPlayed += 1
  updateCardPositions(state)
  return true
}

export function moveReserveToFoundation(
  state: SeahavenState,
  reserveIndex: int
): bool => moveReserveToFoundationInternal(state, reserveIndex, true)

function moveTableauToFoundationInternal(
  state: SeahavenState,
  tableauIndex: int,
  recordHistory: bool
): bool {
  if tableauIndex < 0 || tableauIndex >= state.tableaus.length { return false }

  source := state.tableaus[tableauIndex]
  if source.isEmpty() { return false }

  card := state.cardInfo[source.topCardIndex()]
  target := foundationPile(state, card.suit)
  if !canPlaceOnFoundation(card, card.suit, target, state.cardInfo) { return false }

  before := captureSnapshot(state)
  movedCard := moveTopCard(source, target)
  if movedCard < 0 { return false }

  if recordHistory {
    return commitRecordedMove(state, before, 1)
  }

  state.movesPlayed += 1
  updateCardPositions(state)
  return true
}

export function moveTableauToFoundation(
  state: SeahavenState,
  tableauIndex: int
): bool => moveTableauToFoundationInternal(state, tableauIndex, true)

function startReserveFoundationAutoMove(state: SeahavenState, reserveIndex: int): bool {
  if state.moveAnimActive { return false }
  if reserveIndex < 0 || reserveIndex >= state.reserves.length { return false }

  source := state.reserves[reserveIndex]
  if source.isEmpty() { return false }

  cardIndex := source.topCardIndex()
  if cardIndex < 0 || cardIndex >= state.cards.length { return false }

  card := state.cardInfo[cardIndex]
  target := foundationPile(state, card.suit)
  if !canPlaceOnFoundation(card, card.suit, target, state.cardInfo) { return false }

  startX := state.cards[cardIndex].x
  startZ := state.cards[cardIndex].z
  movedCard := moveTopCard(source, target)
  if movedCard < 0 { return false }

  state.movesPlayed += 1
  startMoveAnim(state, movedCard, card.suit.value, startX, startZ)
  return true
}

function startTableauFoundationAutoMove(state: SeahavenState, tableauIndex: int): bool {
  if state.moveAnimActive { return false }
  if tableauIndex < 0 || tableauIndex >= state.tableaus.length { return false }

  source := state.tableaus[tableauIndex]
  if source.isEmpty() { return false }

  cardIndex := source.topCardIndex()
  if cardIndex < 0 || cardIndex >= state.cards.length { return false }

  card := state.cardInfo[cardIndex]
  target := foundationPile(state, card.suit)
  if !canPlaceOnFoundation(card, card.suit, target, state.cardInfo) { return false }

  startX := state.cards[cardIndex].x
  startZ := state.cards[cardIndex].z
  movedCard := moveTopCard(source, target)
  if movedCard < 0 { return false }

  state.movesPlayed += 1
  startMoveAnim(state, movedCard, card.suit.value, startX, startZ)
  return true
}

function tryStartNextFoundationAutoMove(state: SeahavenState): bool {
  if state.moveAnimActive { return false }

  for reserve of 0..<state.reserves.length {
    if startReserveFoundationAutoMove(state, reserve) {
      return true
    }
  }

  for tableau of 0..<state.tableaus.length {
    if startTableauFoundationAutoMove(state, tableau) {
      return true
    }
  }

  return false
}

function autoMoveAvailableToFoundationInternal(state: SeahavenState, recordHistory: bool): int {
  let movedCount = 0
  let keepGoing = true
  before := captureSnapshot(state)

  while keepGoing {
    keepGoing = false

    for reserve of 0..<state.reserves.length {
      if moveReserveToFoundationInternal(state, reserve, false) {
        movedCount += 1
        keepGoing = true
      }
    }

    if keepGoing { continue }

    for tableau of 0..<state.tableaus.length {
      if moveTableauToFoundationInternal(state, tableau, false) {
        movedCount += 1
        keepGoing = true
      }
    }
  }

  if recordHistory && movedCount > 0 {
    state.undoStack.push(before)
    state.redoStack = []
  }

  return movedCount
}

function completeManualFoundationSequence(state: SeahavenState, before: SeahavenSnapshot): bool {
  state.undoStack.push(before)
  state.redoStack = []
  return true
}

function moveReserveToFoundationAndContinue(
  state: SeahavenState,
  reserveIndex: int
): bool {
  if state.moveAnimActive { return false }
  before := captureSnapshot(state)
  if !startReserveFoundationAutoMove(state, reserveIndex) {
    return false
  }
  return completeManualFoundationSequence(state, before)
}

function moveTableauToFoundationAndContinue(
  state: SeahavenState,
  tableauIndex: int
): bool {
  if state.moveAnimActive { return false }
  before := captureSnapshot(state)
  if !startTableauFoundationAutoMove(state, tableauIndex) {
    return false
  }
  return completeManualFoundationSequence(state, before)
}

export function autoMoveAvailableToFoundation(state: SeahavenState): int {
  return autoMoveAvailableToFoundationInternal(state, false)
}

export function attemptAutoMove(state: SeahavenState): void {
  if state.moveAnimActive { return }

  before := captureSnapshot(state)
  if tryStartNextFoundationAutoMove(state) {
    state.undoStack.push(before)
    state.redoStack = []
  }
}

export function undoMove(state: SeahavenState): bool {
  if state.moveAnimActive { return false }
  if state.undoStack.length == 0 { return false }

  current := captureSnapshot(state)
  snapshot := state.undoStack[state.undoStack.length - 1]
  state.undoStack = state.undoStack.slice(0, state.undoStack.length - 1)
  state.redoStack.push(current)
  restoreSnapshot(state, snapshot)
  return true
}

export function redoMove(state: SeahavenState): bool {
  if state.moveAnimActive { return false }
  if state.redoStack.length == 0 { return false }

  current := captureSnapshot(state)
  snapshot := state.redoStack[state.redoStack.length - 1]
  state.redoStack = state.redoStack.slice(0, state.redoStack.length - 1)
  state.undoStack.push(current)
  restoreSnapshot(state, snapshot)
  return true
}

export function checkWin(state: SeahavenState): bool {
  for i of 0..3 {
    suit := foundationSuitAt(i)
    if foundationPile(state, suit).cardIndices.length != 13 {
      return false
    }
  }
  return true
}

function pointInCard(px: float, pz: float, card: Card): bool {
  halfW := card.width * 0.5f
  halfH := card.height * 0.5f
  return px >= card.x - halfW && px <= card.x + halfW &&
         pz >= card.z - halfH && pz <= card.z + halfH
}

export function findCardAtPosition(state: SeahavenState, worldX: float, worldZ: float): CardHit {
  hit := CardHit {}

  for let i = state.tableaus.length - 1; i >= 0; i -= 1 {
    pile := state.tableau(i)
    if pile.isEmpty() { continue }
    for let cardIndex = pile.cardIndices.length - 1; cardIndex >= 0; cardIndex -= 1 {
      cardIdx := pile.cardIndices[cardIndex]
      if cardIdx < 0 || cardIdx >= state.cards.length { continue }
      if pointInCard(worldX, worldZ, state.cards[cardIdx]) {
        hit.pileType = 0
        hit.pileIndex = i
        hit.cardIndex = cardIndex
        hit.found = true
        return hit
      }
    }
  }

  for let i = state.reserves.length - 1; i >= 0; i -= 1 {
    pile := state.reserve(i)
    if pile.isEmpty() { continue }
    cardIdx := pile.topCardIndex()
    if cardIdx < 0 || cardIdx >= state.cards.length { continue }
    if pointInCard(worldX, worldZ, state.cards[cardIdx]) {
      hit.pileType = 1
      hit.pileIndex = i
      hit.cardIndex = 0
      hit.found = true
      return hit
    }
  }

  for i of 0..3 {
    pile := state.foundation(i)
    if pile.isEmpty() { continue }
    cardIdx := pile.topCardIndex()
    if cardIdx < 0 || cardIdx >= state.cards.length { continue }
    if pointInCard(worldX, worldZ, state.cards[cardIdx]) {
      hit.pileType = 2
      hit.pileIndex = i
      hit.cardIndex = 0
      hit.found = true
      return hit
    }
  }

  return hit
}

function selectedDragCardIndices(state: SeahavenState): int[] {
  if state.selectedPileType == 0 {
    pile := state.tableau(state.selectedPileIndex)
    if state.selectedCardIndex < 0 || state.selectedCardIndex >= pile.cardIndices.length {
      return []
    }
    return pile.cardIndices.slice(state.selectedCardIndex, pile.cardIndices.length)
  }
  if state.selectedPileType == 1 {
    cardIndex := state.reserve(state.selectedPileIndex).topCardIndex()
    if cardIndex < 0 {
      return []
    }
    return [cardIndex]
  }
  return []
}

function dropNearPile(cardX: float, cardZ: float, pile: Pile, allowStackOffset: bool): bool {
  let pileZ = pile.z
  if allowStackOffset && !pile.isEmpty() {
    pileZ = pile.z + float(pile.cardIndices.length - 1) * CARD_VERTICAL_OFFSET
  }
  dx := abs(cardX - pile.x)
  dz := abs(cardZ - pileZ)
  return dx < 70.0f && dz < 95.0f
}

export function handleClick(state: SeahavenState, worldX: float, worldZ: float): bool {
  if state.moveAnimActive { return false }
  hit := findCardAtPosition(state, worldX, worldZ)
  if !hit.found { return false }

  if hit.pileType == 1 {
    return moveReserveToFoundationAndContinue(state, hit.pileIndex)
  }

  if hit.pileType == 0 {
    return moveTableauToFoundationAndContinue(state, hit.pileIndex)
  }

  return false
}

export function handleDragStart(state: SeahavenState, worldX: float, worldZ: float): void {
  if state.moveAnimActive { return }
  hit := findCardAtPosition(state, worldX, worldZ)
  if !hit.found { return }
  if hit.pileType == 2 { return }

  if hit.pileType == 0 {
    pile := state.tableau(hit.pileIndex)
    if !isMovableTableauRun(pile, hit.cardIndex, state.cardInfo) {
      return
    }
  }

  cardIdx := if hit.pileType == 0 then state.tableau(hit.pileIndex).cardIndices[hit.cardIndex] else state.reserve(hit.pileIndex).topCardIndex()
  if cardIdx < 0 || cardIdx >= state.cards.length { return }

  state.selectedPileType = hit.pileType
  state.selectedPileIndex = hit.pileIndex
  state.selectedCardIndex = hit.cardIndex
  state.isDragging = true
  state.dragOffsetX = state.cards[cardIdx].x - worldX
  state.dragOffsetZ = state.cards[cardIdx].z - worldZ
}

export function handleDragMove(state: SeahavenState, worldX: float, worldZ: float): void {
  if state.moveAnimActive || !state.isDragging { return }

  draggedCards := selectedDragCardIndices(state)
  if draggedCards.length == 0 { return }

  baseX := worldX + state.dragOffsetX
  baseZ := worldZ + state.dragOffsetZ
  for i of 0..<draggedCards.length {
    cardIdx := draggedCards[i]
    if cardIdx < 0 || cardIdx >= state.cards.length { continue }

    state.cards[cardIdx].x = baseX
    state.cards[cardIdx].z = baseZ + float(i) * CARD_VERTICAL_OFFSET
    state.cards[cardIdx].y = 0.0f
  }
}

export function handleDragEnd(state: SeahavenState, worldX: float, worldZ: float): void {
  if state.moveAnimActive || !state.isDragging { return }

  draggedCards := selectedDragCardIndices(state)
  if draggedCards.length == 0 {
    cancelSelection(state)
    return
  }

  movingCard := state.cardInfo[draggedCards[0]]
  draggedCard := state.cards[draggedCards[0]]
  cardX := draggedCard.x
  cardZ := draggedCard.z
  let placed = false

  if draggedCards.length == 1 {
    for reserve of 0..<state.reserves.length {
      target := state.reserve(reserve)
      if !target.isEmpty() { continue }
      if state.selectedPileType == 1 && state.selectedPileIndex == reserve { continue }
      if !dropNearPile(cardX, cardZ, target, false) { continue }

      if state.selectedPileType == 1 {
        placed = moveReserveToReserve(state, state.selectedPileIndex, reserve)
      } else {
        placed = moveTableauToReserve(state, state.selectedPileIndex, reserve)
      }
      if placed { break }
    }
  }

  if !placed {
    for tableau of 0..<state.tableaus.length {
      target := state.tableau(tableau)
      if state.selectedPileType == 0 && state.selectedPileIndex == tableau { continue }
      if !dropNearPile(cardX, cardZ, target, true) { continue }

      if state.selectedPileType == 1 {
        if !canPlaceOnTableau(movingCard, target, state.cardInfo) { continue }
        placed = moveReserveToTableau(state, state.selectedPileIndex, tableau)
      } else {
        placed = moveTableauRunToTableau(state, state.selectedPileIndex, state.selectedCardIndex, tableau)
      }
      if placed { break }
    }
  }

  if !placed && draggedCards.length == 1 {
    for foundationIndex of 0..3 {
      target := state.foundation(foundationIndex)
      if movingCard.suit != foundationSuitAt(foundationIndex) { continue }
      if !canPlaceOnFoundation(movingCard, foundationSuitAt(foundationIndex), target, state.cardInfo) { continue }
      if !dropNearPile(cardX, cardZ, target, false) { continue }

      if state.selectedPileType == 1 {
        placed = moveReserveToFoundationAndContinue(state, state.selectedPileIndex)
      } else {
        placed = moveTableauToFoundationAndContinue(state, state.selectedPileIndex)
      }
      if placed { break }
    }
  }

  if !placed {
    updateCardPositions(state)
  }
  cancelSelection(state)
}

export function cancelSelection(state: SeahavenState): void {
  clearSelection(state)
}

function easeInOutCubic(t: float): float {
  if t < 0.5f {
    return 4.0f * t * t * t
  }

  v := -2.0f * t + 2.0f
  return 1.0f - (v * v * v) / 2.0f
}

function updateMoveAnimation(state: SeahavenState, deltaTime: float): void {
  if !state.moveAnimActive { return }
  if state.moveCardIndex < 0 || state.moveCardIndex >= state.cards.length {
    state.moveAnimActive = false
    state.moveCardIndex = -1
    return
  }

  card := state.cards[state.moveCardIndex]
  state.moveProgress += deltaTime / state.moveAnimDuration

  if state.moveProgress >= 1.0f {
    state.moveProgress = 1.0f
    card.x = state.moveEndX
    card.z = state.moveEndZ
    card.y = 0.0f

    state.moveAnimActive = false
    state.moveCardIndex = -1

    updateCardPositions(state)
    tryStartNextFoundationAutoMove(state)
    return
  }

  t := easeInOutCubic(state.moveProgress)
  card.x = state.moveStartX + (state.moveEndX - state.moveStartX) * t
  card.z = state.moveStartZ + (state.moveEndZ - state.moveStartZ) * t

  liftT := 1.0f - (2.0f * state.moveProgress - 1.0f) * (2.0f * state.moveProgress - 1.0f)
  card.y = 28.0f * liftT
}

export function updateAnimations(state: SeahavenState, deltaTime: float): bool {
  updateMoveAnimation(state, deltaTime)
  return state.moveAnimActive
}

export function renderState(state: SeahavenState): string {
  let text = "Reserves: "
  for i of 0..<state.reserves.length {
    if i > 0 {
      text += "  "
    }
    text += `${state.reserves[i].label}[${describeTopCard(state, state.reserves[i])}]`
  }

  text += "\nFoundations: "
  for i of 0..3 {
    if i > 0 {
      text += "  "
    }
    suit := foundationSuitAt(i)
    pile := foundationPile(state, suit)
    text += `${suitLabel(suit)}[${describeTopCard(state, pile)}:${pile.cardIndices.length}]`
  }

  text += "\nTableau:\n"
  for i of 0..<state.tableaus.length {
    pile := state.tableaus[i]
    text += `${pile.label}: ${describePileCards(state, pile)}`
    if i + 1 < state.tableaus.length {
      text += "\n"
    }
  }

  return text
}

export function listLegalMoves(state: SeahavenState): string[] {
  moves: string[] := []

  for reserve of 0..<state.reserves.length {
    source := state.reserves[reserve]
    if source.isEmpty() { continue }

    card := state.cardInfo[source.topCardIndex()]
    targetFoundation := foundationPile(state, card.suit)
    if canPlaceOnFoundation(card, card.suit, targetFoundation, state.cardInfo) {
      moves.push(`Move ${reserveCardLabel(state, reserve)} from ${source.label} to foundation ${suitLabel(card.suit)}`)
    }

    for tableau of 0..<state.tableaus.length {
      target := state.tableaus[tableau]
      if canPlaceOnTableau(card, target, state.cardInfo) {
        moves.push(`Move ${reserveCardLabel(state, reserve)} from ${source.label} to ${target.label}`)
      }
    }

    for otherReserve of 0..<state.reserves.length {
      if otherReserve == reserve { continue }
      if state.reserves[otherReserve].isEmpty() {
        moves.push(`Move ${reserveCardLabel(state, reserve)} from ${source.label} to ${state.reserves[otherReserve].label}`)
      }
    }
  }

  for tableau of 0..<state.tableaus.length {
    source := state.tableaus[tableau]
    if source.isEmpty() { continue }

    card := state.cardInfo[source.topCardIndex()]
    targetFoundation := foundationPile(state, card.suit)
    if canPlaceOnFoundation(card, card.suit, targetFoundation, state.cardInfo) {
      moves.push(`Move ${tableauCardLabel(state, tableau)} from ${source.label} to foundation ${suitLabel(card.suit)}`)
    }

    for reserve of 0..<state.reserves.length {
      if state.reserves[reserve].isEmpty() {
        moves.push(`Move ${tableauCardLabel(state, tableau)} from ${source.label} to ${state.reserves[reserve].label}`)
      }
    }

    for targetTableau of 0..<state.tableaus.length {
      if targetTableau == tableau { continue }
      target := state.tableaus[targetTableau]

      for startIndex of 0..<source.cardIndices.length {
        if !isMovableTableauRun(source, startIndex, state.cardInfo) { continue }

        runLength := source.cardIndices.length - startIndex
        runCard := state.cardInfo[source.cardIndices[startIndex]]
        if !canPlaceOnTableau(runCard, target, state.cardInfo) { continue }
        if runLength > maxSupermoveLength(state, tableau, targetTableau) { continue }

        if runLength == 1 {
          moves.push(`Move ${tableauCardLabel(state, tableau)} from ${source.label} to ${target.label}`)
        } else {
          topCard := state.cardInfo[source.cardIndices[source.cardIndices.length - 1]]
          moves.push(
            `Move ${cardLabel(runCard)}-${cardLabel(topCard)} from ${source.label} to ${target.label}`
          )
        }
      }
    }
  }

  return moves
}