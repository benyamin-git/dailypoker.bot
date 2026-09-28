import { ANTE, BET_MULTIPLE, CAP, MAX_PLAYERS, MIN_BET_STEP, MIN_PLAYERS } from "./constants";
import { cryptoRng, freshDeck, shuffle } from "./deck";
import { evaluate7 } from "./evaluator";
import { potTotal, splitPot } from "./pots";
import type {
  Action,
  Card,
  EngineEvent,
  EngineResult,
  MatchState,
  PlayerSeed,
  PlayerState,
  Rng,
  Street,
} from "./types";

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface CreateMatchInput {
  chatId: number;
  matchId: number;
  players: PlayerSeed[];
}

export interface StartHandOptions {
  rng?: Rng;
  deck?: Card[];
  order?: number[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function playerById(state: MatchState, userId: number): PlayerState {
  const player = state.players.find((candidate) => candidate.userId === userId);
  if (!player) {
    throw new EngineError("not_a_player", `user ${userId} is not in this match`);
  }
  return player;
}

export function room(player: PlayerState): number {
  return CAP - player.contribution;
}

export function toCall(state: MatchState, player: PlayerState): number {
  return Math.max(0, state.currentBet - player.streetContribution);
}

export function maxRaiseTo(_state: MatchState, player: PlayerState): number {
  return player.streetContribution + room(player);
}

export function minFullRaiseTo(state: MatchState, player: PlayerState): number | null {
  const target = state.currentBet + state.lastRaiseIncrement;
  return target <= maxRaiseTo(state, player) ? target : null;
}

function nextStreet(street: Street): Street {
  switch (street) {
    case "preflop":
      return "flop";
    case "flop":
      return "turn";
    case "turn":
      return "river";
    default:
      return "showdown";
  }
}

function findNextActor(state: MatchState, afterUserId: number | null): number | null {
  const count = state.order.length;
  const start = afterUserId === null ? 0 : state.order.indexOf(afterUserId) + 1;
  for (let i = 0; i < count; i++) {
    const userId = state.order[(start + i) % count] as number;
    const player = playerById(state, userId);
    if (
      !player.folded &&
      !player.allIn &&
      (!player.hasActed || player.streetContribution < state.currentBet)
    ) {
      return userId;
    }
  }
  return null;
}

function streetComplete(state: MatchState): boolean {
  return state.players.every(
    (player) =>
      player.folded ||
      player.allIn ||
      (player.hasActed && player.streetContribution === state.currentBet),
  );
}

function commitTo(player: PlayerState, streetTo: number): void {
  const additional = streetTo - player.streetContribution;
  player.contribution += additional;
  player.streetContribution = streetTo;
  if (player.contribution > CAP) {
    throw new EngineError("cap_exceeded", "contribution would exceed the cap");
  }
  if (player.contribution === CAP) {
    player.allIn = true;
  }
}

function dealStreet(state: MatchState): Card[] {
  const count = state.board.length === 0 ? 3 : 1;
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const card = state.deck.shift();
    if (!card) {
      throw new EngineError("deck_exhausted", "the deck ran out of cards");
    }
    cards.push(card);
    state.board.push(card);
  }
  return cards;
}

function settleShowdown(state: MatchState, events: EngineEvent[]): void {
  const live = state.players.filter((player) => !player.folded);
  for (const player of live) {
    if (!player.hole) {
      throw new EngineError("missing_hole_cards", "a live player has no hole cards");
    }
  }
  const ranked = live.map((player) => ({
    player,
    rank: evaluate7([...(player.hole as [Card, Card]), ...state.board]),
  }));
  const best = Math.max(...ranked.map((entry) => entry.rank.score));
  const winners = ranked
    .filter((entry) => entry.rank.score === best)
    .map((entry) => entry.player.userId);

  if (state.revealed) {
    for (const entry of ranked) {
      entry.player.shown = true;
    }
  }
  for (const entry of ranked) {
    if (winners.includes(entry.player.userId)) {
      entry.player.shown = true;
    }
  }

  const payouts = splitPot(state.pot, winners, state.order);
  const deltas: Record<number, number> = {};
  const revealed: { userId: number; cards: [Card, Card] }[] = [];
  for (const player of state.players) {
    deltas[player.userId] = (payouts.get(player.userId) ?? 0) - player.contribution;
    if (player.shown && player.hole) {
      revealed.push({ userId: player.userId, cards: player.hole });
    }
  }

  state.status = "done";
  state.street = "showdown";
  state.actorUserId = null;
  state.runout = false;
  state.winners = winners;
  state.deltas = deltas;
  events.push({
    type: "hand_complete",
    winners,
    pot: state.pot,
    deltas,
    board: [...state.board],
    revealed,
  });
}

function settleFoldOut(state: MatchState, events: EngineEvent[]): void {
  const winner = state.players.find((player) => !player.folded) as PlayerState;
  const payouts = splitPot(state.pot, [winner.userId], state.order);
  const deltas: Record<number, number> = {};
  for (const player of state.players) {
    deltas[player.userId] = (payouts.get(player.userId) ?? 0) - player.contribution;
  }
  state.status = "done";
  state.actorUserId = null;
  state.runout = false;
  state.winners = [winner.userId];
  state.deltas = deltas;
  events.push({
    type: "hand_complete",
    winners: [winner.userId],
    pot: state.pot,
    deltas,
    board: [...state.board],
    revealed: [],
  });
}

function advanceAfterBetting(state: MatchState, events: EngineEvent[]): void {
  const live = state.players.filter((player) => !player.folded);
  if (state.street === "river") {
    settleShowdown(state, events);
    return;
  }
  const canAct = live.filter((player) => !player.allIn);
  if (canAct.length <= 1) {
    state.runout = true;
    state.actorUserId = null;
    state.turnId += 1;
    return;
  }
  state.street = nextStreet(state.street);
  for (const player of state.players) {
    player.streetContribution = 0;
    player.hasActed = false;
  }
  state.currentBet = 0;
  state.lastRaiseIncrement = MIN_BET_STEP;
  const cards = dealStreet(state);
  state.actorUserId = findNextActor(state, null);
  state.turnId += 1;
  events.push({
    type: "street_dealt",
    street: state.street,
    cards,
    board: [...state.board],
  });
}

export function createMatch(input: CreateMatchInput): MatchState {
  if (input.players.length < MIN_PLAYERS || input.players.length > MAX_PLAYERS) {
    throw new EngineError(
      "bad_player_count",
      `a match needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players`,
    );
  }
  const seen = new Set<number>();
  for (const player of input.players) {
    if (seen.has(player.userId)) {
      throw new EngineError("duplicate_player", `user ${player.userId} is listed twice`);
    }
    seen.add(player.userId);
  }
  return {
    chatId: input.chatId,
    matchId: input.matchId,
    handNo: 0,
    status: "pending",
    street: "preflop",
    players: input.players.map((player, index) => ({
      userId: player.userId,
      seat: index,
      hole: null,
      contribution: 0,
      streetContribution: 0,
      folded: false,
      allIn: false,
      shown: false,
      hasActed: false,
    })),
    order: input.players.map((player) => player.userId),
    board: [],
    deck: [],
    pot: 0,
    currentBet: 0,
    lastRaiseIncrement: MIN_BET_STEP,
    actorUserId: null,
    turnId: 0,
    runout: false,
    revealed: false,
    winners: [],
    deltas: {},
  };
}

export function startHand(state: MatchState, options: StartHandOptions = {}): EngineResult {
  if (state.status !== "pending") {
    throw new EngineError("bad_state", "this hand has already started");
  }
  const rng = options.rng ?? cryptoRng();
  const next = clone(state);
  const events: EngineEvent[] = [];

  const seats = options.order ? [...options.order] : next.players.map((player) => player.userId);
  if (options.order) {
    const expected = [...next.players.map((player) => player.userId)].sort().join(",");
    const actual = [...seats].sort().join(",");
    if (expected !== actual) {
      throw new EngineError("bad_order", "the provided order must list every player once");
    }
  } else {
    shuffle(seats, rng);
  }
  next.order = seats;
  next.players.forEach((player) => {
    player.seat = seats.indexOf(player.userId);
  });

  const deck = options.deck ? [...options.deck] : shuffle(freshDeck(), rng);
  const orderedPlayers = next.order.map((userId) => playerById(next, userId));

  for (let round = 0; round < 2; round++) {
    for (const player of orderedPlayers) {
      const card = deck.shift();
      if (!card) {
        throw new EngineError("deck_exhausted", "the deck ran out during the deal");
      }
      player.hole = player.hole ? [player.hole[0], card] : [card, null as unknown as Card];
    }
  }

  events.push({ type: "hand_started", handNo: next.handNo, order: [...seats] });

  for (const player of orderedPlayers) {
    player.contribution = ANTE;
    player.streetContribution = 0;
    next.pot += ANTE;
    events.push({
      type: "ante_posted",
      userId: player.userId,
      amount: ANTE,
      pot: next.pot,
    });
  }
  for (const player of orderedPlayers) {
    events.push({ type: "hole_cards", userId: player.userId, cards: player.hole as [Card, Card] });
  }

  next.deck = deck;
  next.status = "active";
  next.street = "preflop";
  next.actorUserId = findNextActor(next, null);
  next.turnId += 1;
  return { state: next, events };
}

export function legalActions(state: MatchState, userId: number): Action[] {
  if (state.status !== "active" || state.actorUserId !== userId) {
    return [];
  }
  const player = playerById(state, userId);
  const call = toCall(state, player);
  const actions: Action[] = [{ kind: "fold" }];
  if (call === 0) {
    actions.push({ kind: "check" });
  } else if (call <= room(player)) {
    actions.push({ kind: "call" });
  }
  if (state.currentBet === 0) {
    if (room(player) >= MIN_BET_STEP) {
      actions.push({ kind: "bet", to: MIN_BET_STEP });
    }
  } else {
    const minRaise = minFullRaiseTo(state, player);
    if (minRaise !== null) {
      actions.push({ kind: "raise", to: minRaise });
    }
  }
  const maxTo = maxRaiseTo(state, player);
  if (room(player) > 0 && maxTo >= state.currentBet) {
    actions.push({ kind: "allin" });
  }
  return actions;
}

function requireAmount(action: Action): number {
  if (typeof action.to !== "number" || !Number.isSafeInteger(action.to)) {
    throw new EngineError("illegal_action", "this action needs a valid amount");
  }
  return action.to;
}

export function applyAction(state: MatchState, userId: number, action: Action): EngineResult {
  if (state.status !== "active") {
    throw new EngineError("match_done", "this match is no longer active");
  }
  if (state.actorUserId !== userId) {
    throw new EngineError("not_your_turn", "it is not your turn");
  }
  const next = clone(state);
  const player = playerById(next, userId);
  const events: EngineEvent[] = [];
  const previousCall = toCall(next, player);

  switch (action.kind) {
    case "fold": {
      player.folded = true;
      break;
    }
    case "check": {
      if (previousCall !== 0) {
        throw new EngineError("illegal_action", "you cannot check while facing a bet");
      }
      break;
    }
    case "call": {
      if (previousCall <= 0) {
        throw new EngineError("illegal_action", "there is nothing to call");
      }
      if (previousCall > room(player)) {
        throw new EngineError("illegal_action", "you cannot cover the call");
      }
      commitTo(player, next.currentBet);
      break;
    }
    case "bet": {
      if (next.currentBet !== 0) {
        throw new EngineError("illegal_action", "there is already a bet to raise");
      }
      const to = requireAmount(action);
      if (to < MIN_BET_STEP || to % BET_MULTIPLE !== 0) {
        throw new EngineError("illegal_action", "bets must be multiples of 10");
      }
      if (to > maxRaiseTo(next, player)) {
        throw new EngineError("above_cap", "that bet is above your remaining room");
      }
      commitTo(player, to);
      next.currentBet = to;
      next.lastRaiseIncrement = to;
      break;
    }
    case "raise": {
      if (next.currentBet === 0) {
        throw new EngineError("illegal_action", "there is no bet to raise");
      }
      const to = requireAmount(action);
      if (to % BET_MULTIPLE !== 0) {
        throw new EngineError("illegal_action", "raises must be multiples of 10");
      }
      if (to <= next.currentBet) {
        throw new EngineError("illegal_action", "a raise must increase the current bet");
      }
      const increment = to - next.currentBet;
      if (increment < next.lastRaiseIncrement) {
        throw new EngineError("illegal_action", "that raise is below the minimum raise");
      }
      if (to > maxRaiseTo(next, player)) {
        throw new EngineError("above_cap", "that raise is above your remaining room");
      }
      commitTo(player, to);
      next.lastRaiseIncrement = increment;
      next.currentBet = to;
      break;
    }
    case "allin": {
      if (room(player) <= 0) {
        throw new EngineError("illegal_action", "you are already at the cap");
      }
      const to = maxRaiseTo(next, player);
      if (to < next.currentBet) {
        throw new EngineError("illegal_action", "you cannot cover the current bet");
      }
      const previousBet = next.currentBet;
      commitTo(player, to);
      if (to > previousBet) {
        const increment = to - previousBet;
        if (increment >= next.lastRaiseIncrement) {
          next.lastRaiseIncrement = increment;
        }
        next.currentBet = to;
      }
      break;
    }
    default: {
      throw new EngineError("illegal_action", "unknown action");
    }
  }

  player.hasActed = true;
  next.pot = potTotal(next.players);
  next.turnId += 1;
  events.push({
    type: "action_taken",
    userId,
    action,
    street: next.street,
    toCall: previousCall,
    pot: next.pot,
  });

  const live = next.players.filter((candidate) => !candidate.folded);
  if (live.length === 1) {
    settleFoldOut(next, events);
    return { state: next, events };
  }

  if (streetComplete(next)) {
    advanceAfterBetting(next, events);
    return { state: next, events };
  }
  next.actorUserId = findNextActor(next, userId);
  return { state: next, events };
}

export function timeoutAction(state: MatchState): EngineResult {
  if (state.status !== "active" || state.actorUserId === null) {
    throw new EngineError("match_done", "there is no turn to time out");
  }
  const actor = state.actorUserId;
  const options = legalActions(state, actor);
  if (options.some((action) => action.kind === "check")) {
    return applyAction(state, actor, { kind: "check" });
  }
  return applyAction(state, actor, { kind: "fold" });
}

export function advanceRunout(state: MatchState): EngineResult {
  if (state.status !== "active" || !state.runout) {
    throw new EngineError("bad_state", "there is no runout in progress");
  }
  const next = clone(state);
  const events: EngineEvent[] = [];

  if (!next.revealed) {
    next.revealed = true;
    for (const player of next.players) {
      if (!player.folded && player.hole) {
        events.push({ type: "hand_revealed", userId: player.userId, cards: player.hole });
      }
    }
  }

  if (next.board.length < 5) {
    next.street = nextStreet(next.street);
    const cards = dealStreet(next);
    events.push({
      type: "street_dealt",
      street: next.street,
      cards,
      board: [...next.board],
    });
  }

  if (next.board.length >= 5) {
    settleShowdown(next, events);
  }
  return { state: next, events };
}

export function revealHand(state: MatchState, userId: number): EngineResult {
  if (state.status !== "done") {
    throw new EngineError("bad_state", "the hand is still running");
  }
  const player = playerById(state, userId);
  if (player.folded) {
    throw new EngineError("illegal_action", "folded hands cannot be shown");
  }
  if (player.shown) {
    throw new EngineError("already_shown", "this hand is already shown");
  }
  if (!player.hole) {
    throw new EngineError("missing_hole_cards", "this player has no hole cards");
  }
  const next = clone(state);
  const nextPlayer = playerById(next, userId);
  nextPlayer.shown = true;
  return {
    state: next,
    events: [{ type: "hand_revealed", userId, cards: nextPlayer.hole as [Card, Card] }],
  };
}
