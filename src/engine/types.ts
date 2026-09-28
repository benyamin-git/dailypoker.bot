export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ["s", "h", "d", "c"] as const;
export type Suit = (typeof SUITS)[number];

export type Card = `${Rank}${Suit}`;

export type Rng = () => number;

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type ActionKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";

export interface Action {
  kind: ActionKind;
  to?: number;
}

export interface PlayerSeed {
  userId: number;
}

export interface PlayerState {
  userId: number;
  seat: number;
  hole: [Card, Card] | null;
  contribution: number;
  streetContribution: number;
  folded: boolean;
  allIn: boolean;
  shown: boolean;
  hasActed: boolean;
}

export interface MatchState {
  chatId: number;
  matchId: number;
  handNo: number;
  status: "pending" | "active" | "done";
  street: Street;
  players: PlayerState[];
  order: number[];
  board: Card[];
  deck: Card[];
  pot: number;
  currentBet: number;
  lastRaiseIncrement: number;
  actorUserId: number | null;
  turnId: number;
  runout: boolean;
  revealed: boolean;
  winners: number[];
  deltas: Record<number, number>;
}

export interface RevealedHand {
  userId: number;
  cards: [Card, Card];
}

export type EngineEvent =
  | { type: "hand_started"; handNo: number; order: number[] }
  | { type: "ante_posted"; userId: number; amount: number; pot: number }
  | { type: "hole_cards"; userId: number; cards: [Card, Card] }
  | {
      type: "action_taken";
      userId: number;
      action: Action;
      street: Street;
      toCall: number;
      pot: number;
    }
  | { type: "street_dealt"; street: Street; cards: Card[]; board: Card[] }
  | { type: "hand_revealed"; userId: number; cards: [Card, Card] }
  | {
      type: "hand_complete";
      winners: number[];
      pot: number;
      deltas: Record<number, number>;
      board: Card[];
      revealed: RevealedHand[];
    };

export interface EngineResult {
  state: MatchState;
  events: EngineEvent[];
}
