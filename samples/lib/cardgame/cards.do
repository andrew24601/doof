// Shared playing-card primitives used by multiple sample games.

export enum Suit { Spades = 0, Hearts = 1, Diamonds = 2, Clubs = 3 }

export enum Rank {
  Ace = 1, Two = 2, Three = 3, Four = 4, Five = 5, Six = 6, Seven = 7,
  Eight = 8, Nine = 9, Ten = 10, Jack = 11, Queen = 12, King = 13
}

export class PlayingCard {
  suit: Suit = .Spades
  rank: Rank = .Ace

  isRed(): bool => suit == .Hearts || suit == .Diamonds
  isBlack(): bool => suit == .Spades || suit == .Clubs
  rankValue(): int => rank.value
}

export class Card {
  cardId: string = ""
  x: float = 0.0f
  z: float = 0.0f
  y: float = 0.0f
  width: float = 80.0f
  height: float = 120.0f
  faceUp: bool = true
  currentLift: float = 0.0f
  currentRotation: float = 0.0f

  flipPhase: int = 0
  flipProgress: float = 0.0f
  flipLiftHeight: float = 80.0f
  flipDuration: float = 0.8f
  flipTargetFaceUp: bool = true
}

export function createDeck(): PlayingCard[] {
  cards: PlayingCard[] := []
  suits: Suit[] := [.Spades, .Hearts, .Diamonds, .Clubs]
  ranks: Rank[] := [
    .Ace, .Two, .Three, .Four, .Five, .Six,
    .Seven, .Eight, .Nine, .Ten, .Jack, .Queen, .King
  ]

  for s of 0..3 {
    for r of 0..12 {
      cards.push(PlayingCard { suit: suits[s], rank: ranks[r] })
    }
  }

  return cards
}

export function cardId(suit: Suit, rank: Rank): string {
  return `card_${suit.value}_${rank.value}`
}

export function cardBackId(): string => "card_back"

export function foundationSuit(index: int): Suit {
  return Suit.fromValue(index) ?? .Spades
}

export function suitLabel(suit: Suit): string {
  if suit == .Spades { return "S" }
  if suit == .Hearts { return "H" }
  if suit == .Diamonds { return "D" }
  return "C"
}

export function rankLabel(rank: Rank): string {
  if rank == .Ace { return "A" }
  if rank == .Jack { return "J" }
  if rank == .Queen { return "Q" }
  if rank == .King { return "K" }
  if rank == .Ten { return "10" }
  return string(rank.value)
}

export function cardLabel(card: PlayingCard): string {
  return `${rankLabel(card.rank)}${suitLabel(card.suit)}`
}