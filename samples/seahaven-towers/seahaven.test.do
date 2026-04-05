import { Suit, createDeck } from "cardgame/cards"
import {
  Pile,
  SeahavenState,
  createGame,
  createEmptyState,
  canPlaceOnTableau,
  isAnimating,
  updateCardPositions,
  moveTableauToReserve,
  moveReserveToReserve,
  moveReserveToTableau,
  moveTableauToTableau,
  moveTableauRunToTableau,
  moveReserveToFoundation,
  autoMoveAvailableToFoundation,
  attemptAutoMove,
  undoMove,
  redoMove,
  handleClick,
  handleDragEnd,
  updateAnimations
} from "./seahaven"

function fillOtherTableaus(state: SeahavenState, skipA: int, skipB: int): void {
  let filler = 20
  for tableau of 0..<state.tableaus.length {
    if tableau == skipA || tableau == skipB { continue }
    state.tableaus[tableau].cardIndices = [filler]
    filler += 1
  }
}

function finishAutoMoveAnimation(state: SeahavenState): void {
  for i of 0..7 {
    if !updateAnimations(state, 0.3f) {
      return
    }
  }
}

export function testInitialDealLayout(): void {
  state := createGame(11)

  let totalCards = 0
  for reserve of 0..<state.reserves.length {
    expected := if reserve < 2 then 1 else 0
    assert(
      state.reserves[reserve].cardIndices.length == expected,
      `expected reserve ${reserve + 1} to contain ${expected} cards`
    )
    totalCards += state.reserves[reserve].cardIndices.length
  }

  assert(state.tableaus.length == 10, "expected ten tableau piles")
  for tableau of 0..<state.tableaus.length {
    assert(
      state.tableaus[tableau].cardIndices.length == 5,
      `expected tableau ${tableau + 1} to contain five cards`
    )
    totalCards += state.tableaus[tableau].cardIndices.length
  }

  assert(totalCards == 52, "expected all cards to be dealt")
}

export function testTableauBuildRequiresDescendingSuit(): void {
  cards := createDeck()
  pile := Pile {}
  pile.cardIndices = [12]

  assert(
    canPlaceOnTableau(cards[11], pile, cards),
    "expected the queen of spades to fit on the king of spades"
  )
  assert(
    !canPlaceOnTableau(cards[24], pile, cards),
    "expected a queen of a different suit to be rejected"
  )
}

export function testEmptyTableauAcceptsAnyCard(): void {
  cards := createDeck()
  emptyPile := Pile {}

  assert(canPlaceOnTableau(cards[12], emptyPile, cards), "expected a king to fill an empty tableau")
  assert(canPlaceOnTableau(cards[11], emptyPile, cards), "expected a non-king to fill an empty tableau")
}

export function testMoveTableauToReserveRequiresEmptyReserve(): void {
  state := createEmptyState()
  state.tableaus[0].cardIndices = [0]
  state.reserves[0].cardIndices = [1]

  assert(
    !moveTableauToReserve(state, 0, 0),
    "expected a filled reserve to reject another card"
  )
  assert(
    moveTableauToReserve(state, 0, 1),
    "expected an empty reserve to accept a tableau card"
  )
}

export function testReserveToReserveAndTableauMoves(): void {
  state := createEmptyState()
  state.reserves[0].cardIndices = [11]
  state.tableaus[0].cardIndices = [12]

  assert(
    moveReserveToTableau(state, 0, 0),
    "expected the queen of spades to move onto the king of spades"
  )

  state.reserves[1].cardIndices = [25]
  assert(
    moveReserveToReserve(state, 1, 2),
    "expected a card to move between reserve cells"
  )

  state.tableaus[1].cardIndices = [12]
  state.tableaus[2].cardIndices = [11]
  assert(
    moveTableauToTableau(state, 2, 1),
    "expected descending same-suit tableau moves to succeed"
  )

  state.reserves[3].cardIndices = [24]
  state.tableaus[3].cardIndices = []
  assert(
    moveReserveToTableau(state, 3, 3),
    "expected any reserve card to move into an empty tableau"
  )
}

export function testSupermoveUsesEmptyReserves(): void {
  state := createEmptyState()
  state.tableaus[0].cardIndices = [11, 10, 9]
  state.tableaus[1].cardIndices = [12]
  fillOtherTableaus(state, 0, 1)
  state.reserves[0].cardIndices = [0]
  state.reserves[1].cardIndices = [1]

  assert(
    moveTableauRunToTableau(state, 0, 0, 1),
    "expected two empty reserves to allow a three-card supermove"
  )
  assert(state.tableaus[0].cardIndices.length == 0, "expected the source tableau to be emptied")
  assert(
    state.tableaus[1].cardIndices.length == 4,
    "expected the target tableau to contain the moved run"
  )
  assert(
    state.tableaus[1].cardIndices[3] == 9,
    "expected the moved sequence order to be preserved"
  )
}

export function testSupermoveRespectsCapacity(): void {
  state := createEmptyState()
  state.tableaus[0].cardIndices = [11, 10, 9]
  state.tableaus[1].cardIndices = [12]
  fillOtherTableaus(state, 0, 1)
  state.reserves[0].cardIndices = [0]
  state.reserves[1].cardIndices = [1]
  state.reserves[2].cardIndices = [2]

  assert(
    !moveTableauRunToTableau(state, 0, 0, 1),
    "expected a three-card supermove to fail with only one empty reserve"
  )
}

export function testFoundationsBuildAscendingInSuit(): void {
  state := createEmptyState()
  state.reserves[0].cardIndices = [0]
  state.reserves[1].cardIndices = [1]

  assert(
    moveReserveToFoundation(state, 0),
    "expected the ace of spades to start the spade foundation"
  )
  assert(
    moveReserveToFoundation(state, 1),
    "expected the two of spades to follow the ace of spades"
  )
  assert(
    state.foundations[Suit.Spades].cardIndices.length == 2,
    "expected two cards on the spade foundation"
  )
}

export function testAutoMoveChainsVisibleFoundationCards(): void {
  state := createEmptyState()
  state.reserves[0].cardIndices = [0]
  state.tableaus[0].cardIndices = [1]

  moved := autoMoveAvailableToFoundation(state)
  assert(moved == 2, "expected auto-move to chain ace then two of spades")
  assert(
    state.foundations[Suit.Spades].cardIndices.length == 2,
    "expected the spade foundation to contain both cards"
  )
}

export function testClickFoundationMoveContinuesAutocompleting(): void {
  state := createEmptyState()
  state.reserves[0].cardIndices = [0]
  state.tableaus[0].cardIndices = [1]
  updateCardPositions(state)

  reserveCard := state.cards[state.reserves[0].topCardIndex()]
  assert(
    handleClick(state, reserveCard.x, reserveCard.z),
    "expected clicking a reserve ace to start foundation autocomplete"
  )
  assert(isAnimating(state), "expected clicking a foundation move to start animation")
  finishAutoMoveAnimation(state)
  assert(
    state.foundations[Suit.Spades].cardIndices.length == 2,
    "expected click autocomplete to continue until no more cards can move"
  )
  assert(undoMove(state), "expected the chained click autocomplete to be undoable")
  assert(state.foundations[Suit.Spades].cardIndices.length == 0, "expected undo to restore both autocompleted cards")
}

export function testDragFoundationMoveContinuesAutocompleting(): void {
  state := createEmptyState()
  state.reserves[0].cardIndices = [0]
  state.tableaus[0].cardIndices = [1]
  updateCardPositions(state)

  draggedCard := state.cards[state.reserves[0].topCardIndex()]
  draggedCard.x = state.foundation(0).x
  draggedCard.z = state.foundation(0).z
  state.selectedPileType = 1
  state.selectedPileIndex = 0
  state.selectedCardIndex = 0
  state.isDragging = true

  handleDragEnd(state, draggedCard.x, draggedCard.z)
  assert(isAnimating(state), "expected dropping onto a foundation to start animation")
  finishAutoMoveAnimation(state)
  assert(
    state.foundations[Suit.Spades].cardIndices.length == 2,
    "expected dropping onto a foundation to continue autocompleting"
  )
}

export function testAttemptAutoMoveAnimatesFullChain(): void {
  state := createEmptyState()
  state.reserves[0].cardIndices = [0]
  state.tableaus[0].cardIndices = [1]
  updateCardPositions(state)

  attemptAutoMove(state)
  assert(isAnimating(state), "expected explicit autocomplete to start animation")
  finishAutoMoveAnimation(state)
  assert(
    state.foundations[Suit.Spades].cardIndices.length == 2,
    "expected explicit autocomplete to finish the available chain"
  )
  assert(!isAnimating(state), "expected the animation sequence to complete")
}

export function testUndoRedoRestoresMoveHistory(): void {
  state := createEmptyState()
  state.tableaus[0].cardIndices = [0]

  assert(
    moveTableauToReserve(state, 0, 0),
    "expected the initial tableau-to-reserve move to succeed"
  )
  assert(undoMove(state), "expected undo to restore the previous layout")
  assert(state.tableaus[0].cardIndices.length == 1, "expected the source tableau card to be restored")
  assert(state.reserves[0].cardIndices.length == 0, "expected the reserve to be cleared after undo")
  assert(state.movesPlayed == 0, "expected undo to restore the move count")

  assert(redoMove(state), "expected redo to reapply the move")
  assert(state.tableaus[0].cardIndices.length == 0, "expected redo to remove the source card again")
  assert(state.reserves[0].cardIndices.length == 1, "expected redo to restore the reserve card")
  assert(state.movesPlayed == 1, "expected redo to restore the move count")
}

export function testRedoClearsAfterNewMove(): void {
  state := createEmptyState()
  state.tableaus[0].cardIndices = [0]
  state.tableaus[1].cardIndices = [1]

  assert(moveTableauToReserve(state, 0, 0), "expected the first move to succeed")
  assert(undoMove(state), "expected undo to succeed")
  assert(moveTableauToReserve(state, 1, 1), "expected the replacement move to succeed")
  assert(!redoMove(state), "expected redo history to clear after a new move")
}