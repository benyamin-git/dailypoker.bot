import { describe, expect, it } from "vitest";

import { ANTE, CAP } from "../../src/engine/constants";
import { seededRng } from "../../src/engine/deck";
import {
  advanceRunout,
  applyAction,
  createMatch,
  EngineError,
  legalActions,
  maxRaiseTo,
  minFullRaiseTo,
  playerById,
  revealHand,
  startHand,
  timeoutAction,
} from "../../src/engine/hand";
import type { Action, Card, MatchState } from "../../src/engine/types";

function newHand(
  playerCount: number,
  options: { order?: number[]; deck?: Card[]; seed?: number } = {},
): MatchState {
  const players = Array.from({ length: playerCount }, (_, index) => ({ userId: 100 + index }));
  const match = createMatch({ chatId: -100, matchId: 1, players });
  return startHand(match, {
    rng: seededRng(options.seed ?? 42),
    deck: options.deck,
    order: options.order,
  }).state;
}

function act(state: MatchState, action: Action): MatchState {
  if (state.actorUserId === null) {
    throw new Error("no actor to act");
  }
  return applyAction(state, state.actorUserId, action).state;
}

function contributions(state: MatchState): Record<number, number> {
  const result: Record<number, number> = {};
  for (const player of state.players) {
    result[player.userId] = player.contribution;
  }
  return result;
}

function deckFor(order: number[], holes: Record<number, [Card, Card]>, board: Card[]): Card[] {
  const deck: Card[] = [];
  for (let round = 0; round < 2; round++) {
    for (const userId of order) {
      deck.push(holes[userId]![round]!);
    }
  }
  deck.push(...board);
  return deck;
}

function expectEngineError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError(${code})`);
}

describe("createMatch", () => {
  it("rejects fewer than two or more than nine players", () => {
    expectEngineError(
      () => createMatch({ chatId: 1, matchId: 1, players: [{ userId: 1 }] }),
      "bad_player_count",
    );
    expectEngineError(
      () =>
        createMatch({
          chatId: 1,
          matchId: 1,
          players: Array.from({ length: 10 }, (_, index) => ({ userId: index + 1 })),
        }),
      "bad_player_count",
    );
  });

  it("rejects duplicate players", () => {
    expectEngineError(
      () =>
        createMatch({
          chatId: 1,
          matchId: 1,
          players: [{ userId: 1 }, { userId: 1 }],
        }),
      "duplicate_player",
    );
  });
});

describe("startHand", () => {
  it("posts antes, deals two hole cards each and picks the first actor", () => {
    const state = newHand(3);
    expect(state.status).toBe("active");
    expect(state.pot).toBe(3 * ANTE);
    expect(state.board).toEqual([]);
    expect(state.deck).toHaveLength(52 - 6);
    expect(Object.values(contributions(state))).toEqual([ANTE, ANTE, ANTE]);
    for (const player of state.players) {
      expect(player.hole).toHaveLength(2);
    }
    expect(state.actorUserId).toBe(state.order[0]);
    expect(state.currentBet).toBe(0);
    expect(state.lastRaiseIncrement).toBe(10);
  });

  it("re-randomizes the hand order every match", () => {
    const first = newHand(9, { seed: 1 });
    const second = newHand(9, { seed: 2 });
    expect(first.order).not.toEqual(second.order);
    expect([...first.order].sort()).toEqual(first.players.map((p) => p.userId).sort());
  });

  it("cannot start twice", () => {
    const state = newHand(2);
    expectEngineError(() => startHand(state), "bad_state");
  });
});

describe("preflop betting", () => {
  it("allows a minimum bet of 10 and rejects other amounts", () => {
    const state = newHand(3, { order: [100, 101, 102] });
    expectEngineError(() => act(state, { kind: "bet", to: 15 }), "illegal_action");
    expectEngineError(() => act(state, { kind: "bet", to: 0 }), "illegal_action");
    const afterBet = act(state, { kind: "bet", to: 10 });
    expect(playerById(afterBet, 100).contribution).toBe(ANTE + 10);
    expect(afterBet.currentBet).toBe(10);
    expect(afterBet.lastRaiseIncrement).toBe(10);
  });

  it("matches the minimum raise to the previous raise increment", () => {
    let state = newHand(4, { order: [100, 101, 102, 103] });
    state = act(state, { kind: "bet", to: 20 });
    state = act(state, { kind: "call" });
    expect(minFullRaiseTo(state, playerById(state, 102))).toBe(40);
    expectEngineError(() => act(state, { kind: "raise", to: 30 }), "illegal_action");
    state = act(state, { kind: "raise", to: 40 });
    expect(state.lastRaiseIncrement).toBe(20);
    expect(state.currentBet).toBe(40);
    expect(minFullRaiseTo(state, playerById(state, 103))).toBe(60);
    expectEngineError(() => act(state, { kind: "raise", to: 50 }), "illegal_action");
    state = act(state, { kind: "raise", to: 60 });
    expect(state.currentBet).toBe(60);
    expect(state.actorUserId).toBe(100);
  });

  it("only allows a check when there is nothing to call", () => {
    const state = newHand(3, { order: [100, 101, 102] });
    const afterBet = act(state, { kind: "bet", to: 20 });
    expectEngineError(() => act(afterBet, { kind: "check" }), "illegal_action");
    const checked = act(state, { kind: "check" });
    expect(checked.currentBet).toBe(0);
  });

  it("only allows a call when facing a bet", () => {
    const state = newHand(3, { order: [100, 101, 102] });
    expectEngineError(() => act(state, { kind: "call" }), "illegal_action");
  });

  it("folds a player out of the hand", () => {
    const state = newHand(3, { order: [100, 101, 102] });
    const afterFold = act(state, { kind: "fold" });
    expect(playerById(afterFold, 100).folded).toBe(true);
    expect(afterFold.actorUserId).toBe(101);
    expect(afterFold.pot).toBe(30);
  });
});

describe("worked example (03-game-rules §10)", () => {
  it("reproduces pot progression 160 → 250 → 310", () => {
    let state = newHand(4, { order: [103, 100, 102, 101] });
    expect(state.pot).toBe(40);

    state = act(state, { kind: "bet", to: 20 });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "raise", to: 40 });
    state = act(state, { kind: "fold" });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "call" });
    expect(state.pot).toBe(160);
    expect(contributions(state)).toEqual({ 100: 50, 101: 10, 102: 50, 103: 50 });
    expect(state.street).toBe("flop");
    expect(state.board).toHaveLength(3);
    expect(state.actorUserId).toBe(103);

    state = act(state, { kind: "check" });
    state = act(state, { kind: "bet", to: 30 });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "call" });
    expect(state.pot).toBe(250);
    expect(state.street).toBe("turn");
    expect(state.board).toHaveLength(4);

    state = act(state, { kind: "check" });
    state = act(state, { kind: "bet", to: 20 });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "call" });
    expect(state.pot).toBe(310);
    expect(contributions(state)).toEqual({ 100: 100, 101: 10, 102: 100, 103: 100 });
    expect(state.runout).toBe(true);
    expect(state.actorUserId).toBeNull();
    expect(state.players.filter((p) => p.userId !== 101).every((p) => p.allIn)).toBe(true);

    const withRiver = advanceRunout(state).state;
    expect(withRiver.board).toHaveLength(5);
    expect(withRiver.status).toBe("done");
    expect(withRiver.winners).toHaveLength(1);
    const deltas = Object.values(withRiver.deltas).reduce((sum, value) => sum + value, 0);
    expect(deltas).toBe(0);
    expect(withRiver.deltas[withRiver.winners[0] as number]).toBe(210);
    expect(withRiver.deltas[101]).toBe(-10);
  });
});

describe("short all-in (03-game-rules §10)", () => {
  it("lands the shover and callers exactly at the cap and ends betting", () => {
    let state = newHand(3, { order: [100, 101, 102] });
    state = act(state, { kind: "bet", to: 20 });
    state = act(state, { kind: "raise", to: 40 });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "call" });
    expect(state.pot).toBe(150);
    expect(state.street).toBe("flop");

    state = act(state, { kind: "check" });
    state = act(state, { kind: "bet", to: 30 });
    state = act(state, { kind: "call" });

    const options = legalActions(state, 100);
    expect(options.some((action) => action.kind === "call")).toBe(true);
    expect(options.some((action) => action.kind === "allin")).toBe(true);
    expect(options.some((action) => action.kind === "raise")).toBe(false);
    expect(minFullRaiseTo(state, playerById(state, 100))).toBeNull();
    expect(maxRaiseTo(state, playerById(state, 100))).toBe(50);

    state = act(state, { kind: "allin" });
    expect(playerById(state, 100).contribution).toBe(CAP);
    expect(state.currentBet).toBe(50);

    state = act(state, { kind: "call" });
    state = act(state, { kind: "call" });
    expect(contributions(state)).toEqual({ 100: 100, 101: 100, 102: 100 });
    expect(state.pot).toBe(300);
    expect(state.runout).toBe(true);

    const finished = advanceRunout(advanceRunout(state).state).state;
    expect(finished.status).toBe("done");
    expect(finished.board).toHaveLength(5);
    expect(finished.deltas[finished.winners[0] as number]).toBe(200);
  });

  it("rejects a full raise that would exceed the cap", () => {
    let state = newHand(3, { order: [100, 101, 102] });
    state = act(state, { kind: "bet", to: 20 });
    state = act(state, { kind: "raise", to: 40 });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "check" });
    state = act(state, { kind: "bet", to: 30 });
    state = act(state, { kind: "call" });
    expectEngineError(() => act(state, { kind: "raise", to: 60 }), "above_cap");
  });

  it("lets a short shover take the pot when everyone folds", () => {
    let state = newHand(3, { order: [100, 101, 102] });
    state = act(state, { kind: "bet", to: 20 });
    state = act(state, { kind: "raise", to: 40 });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "check" });
    state = act(state, { kind: "bet", to: 30 });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "allin" });
    expect(playerById(state, 100).contribution).toBe(CAP);
    expect(state.currentBet).toBe(50);
    state = act(state, { kind: "fold" });
    state = act(state, { kind: "fold" });
    expect(state.status).toBe("done");
    expect(state.winners).toEqual([100]);
    expect(state.pot).toBe(260);
    expect(state.deltas).toEqual({ 100: 160, 101: -80, 102: -80 });
  });
});

describe("all-in runout", () => {
  it("deals one street per step and reveals every live hand", () => {
    const order = [100, 101];
    const deck = deckFor(order, { 100: ["As", "Ah"], 101: ["Ks", "Kh"] }, [
      "Ad",
      "Kd",
      "2c",
      "3s",
      "4s",
    ]);
    let state = newHand(2, { order, deck });
    state = act(state, { kind: "allin" });
    state = act(state, { kind: "call" });
    expect(state.runout).toBe(true);
    expect(state.revealed).toBe(false);

    const flop = advanceRunout(state);
    expect(flop.state.street).toBe("flop");
    expect(flop.state.board).toEqual(["Ad", "Kd", "2c"]);
    expect(flop.state.revealed).toBe(true);
    expect(flop.events.filter((event) => event.type === "hand_revealed")).toHaveLength(2);
    expect(flop.state.status).toBe("active");

    const turn = advanceRunout(flop.state);
    expect(turn.state.street).toBe("turn");
    expect(turn.state.board).toHaveLength(4);

    const river = advanceRunout(turn.state);
    expect(river.state.status).toBe("done");
    expect(river.state.board).toHaveLength(5);
    expect(river.state.winners).toEqual([100]);
    expect(river.state.deltas).toEqual({ 100: 100, 101: -100 });
    expect(river.state.players.every((player) => player.shown)).toBe(true);
  });

  it("does not advance when no runout is pending", () => {
    const state = newHand(2, { order: [100, 101] });
    expectEngineError(() => advanceRunout(state), "bad_state");
  });
});

describe("fold-out endings", () => {
  it("ends the hand immediately without revealing cards", () => {
    let state = newHand(3, { order: [100, 101, 102] });
    state = act(state, { kind: "fold" });
    state = act(state, { kind: "fold" });
    expect(state.status).toBe("done");
    expect(state.winners).toEqual([102]);
    expect(state.board).toEqual([]);
    expect(state.deltas).toEqual({ 100: -10, 101: -10, 102: 20 });
    expect(state.players.every((player) => !player.shown)).toBe(true);
  });
});

describe("showdown and split pots", () => {
  it("splits with the odd remainder to the earliest hand order", () => {
    const order = [100, 101, 102, 103];
    const board: Card[] = ["As", "Kd", "Qc", "Jh", "Ts"];
    const deck = deckFor(
      order,
      {
        100: ["2c", "3c"],
        101: ["4c", "5c"],
        102: ["6c", "7c"],
        103: ["8c", "9c"],
      },
      board,
    );
    let state = newHand(4, { order, deck });
    state = act(state, { kind: "fold" });
    state = act(state, { kind: "bet", to: 10 });
    state = act(state, { kind: "call" });
    state = act(state, { kind: "call" });
    for (let i = 0; i < 9; i++) {
      state = act(state, { kind: "check" });
    }
    expect(state.status).toBe("done");
    expect(state.pot).toBe(70);
    expect([...state.winners].sort()).toEqual([101, 102, 103]);
    expect(state.deltas).toEqual({ 100: -10, 101: 4, 102: 3, 103: 3 });
    const winnerTotal = state.winners.reduce(
      (sum, userId) => sum + (state.deltas[userId] as number),
      0,
    );
    expect(winnerTotal).toBe(10);
  });

  it("shows the winning hand and lets a mucked loser reveal", () => {
    const order = [100, 101];
    const deck = deckFor(order, { 100: ["As", "Ah"], 101: ["Ks", "Kh"] }, [
      "Ad",
      "7d",
      "2c",
      "3s",
      "4s",
    ]);
    let state = newHand(2, { order, deck });
    state = act(state, { kind: "bet", to: 10 });
    state = act(state, { kind: "call" });
    for (let i = 0; i < 6; i++) {
      state = act(state, { kind: "check" });
    }
    expect(state.status).toBe("done");
    expect(state.winners).toEqual([100]);
    expect(playerById(state, 100).shown).toBe(true);
    expect(playerById(state, 101).shown).toBe(false);
    const revealed = revealHand(state, 101).state;
    expect(playerById(revealed, 101).shown).toBe(true);
    expectEngineError(() => revealHand(revealed, 101), "already_shown");
  });

  it("rejects revealing a hand before the match ends or after folding", () => {
    let state = newHand(3, { order: [100, 101, 102] });
    expectEngineError(() => revealHand(state, 100), "bad_state");
    state = act(state, { kind: "fold" });
    state = act(state, { kind: "fold" });
    expectEngineError(() => revealHand(state, 100), "illegal_action");
  });

  it("splits the pot when all-in players tie", () => {
    const order = [100, 101];
    const deck = deckFor(order, { 100: ["2c", "3c"], 101: ["4d", "5d"] }, [
      "As",
      "Ks",
      "Qs",
      "Js",
      "Ts",
    ]);
    let state = newHand(2, { order, deck });
    state = act(state, { kind: "allin" });
    state = act(state, { kind: "allin" });
    const finished = advanceRunout(advanceRunout(advanceRunout(state).state).state).state;
    expect(finished.status).toBe("done");
    expect([...finished.winners].sort()).toEqual([100, 101]);
    expect(finished.deltas).toEqual({ 100: 0, 101: 0 });
  });

  it("never lets a folded player win", () => {
    let state = newHand(3, { order: [100, 101, 102] });
    state = act(state, { kind: "fold" });
    state = act(state, { kind: "fold" });
    expect(state.winners).toEqual([102]);
    expect(state.status).toBe("done");
  });
});

describe("all-in legality", () => {
  it("rejects an all-in when the player is already at the cap", () => {
    const state = newHand(2, { order: [100, 101] });
    const afterShove = act(state, { kind: "allin" });
    const afterCall = act(afterShove, { kind: "call" });
    expect(afterCall.runout).toBe(true);
    const options = legalActions(afterCall, 100);
    expect(options).toEqual([]);
  });

  it("treats an all-in that exactly covers the bet as a call at the cap", () => {
    let state = newHand(2, { order: [100, 101] });
    state = act(state, { kind: "bet", to: 90 });
    expect(playerById(state, 100).allIn).toBe(true);
    const options = legalActions(state, 101);
    expect(options.some((action) => action.kind === "allin")).toBe(true);
    const afterCall = act(state, { kind: "allin" });
    expect(playerById(afterCall, 101).contribution).toBe(CAP);
    expect(playerById(afterCall, 101).allIn).toBe(true);
    expect(afterCall.currentBet).toBe(90);
    expect(afterCall.runout).toBe(true);
  });
});

describe("timeouts", () => {
  it("checks when it is free", () => {
    const state = newHand(3, { order: [100, 101, 102] });
    const afterTimeout = timeoutAction(state).state;
    expect(playerById(afterTimeout, 100).folded).toBe(false);
    expect(afterTimeout.actorUserId).toBe(101);
  });

  it("folds when facing a bet", () => {
    let state = newHand(3, { order: [100, 101, 102] });
    state = act(state, { kind: "bet", to: 20 });
    const afterTimeout = timeoutAction(state).state;
    expect(playerById(afterTimeout, 101).folded).toBe(true);
  });
});

describe("legal action sets", () => {
  it("returns nothing for non-actors and spectators", () => {
    const state = newHand(3, { order: [100, 101, 102] });
    expect(legalActions(state, 101)).toEqual([]);
    expect(legalActions(state, 999)).toEqual([]);
  });

  it("offers all-in whenever room remains", () => {
    const state = newHand(2, { order: [100, 101] });
    const options = legalActions(state, 100).map((action) => action.kind);
    expect(options).toContain("allin");
    expect(options).toContain("bet");
    expect(options).toContain("check");
    expect(options).not.toContain("call");
  });
});
