import { describe, expect, it } from "vitest";

import type { MatchState, PlayerState } from "../../src/engine/types";
import { raiseKeyboard, raiseOptions } from "../../src/telegram/keyboards";
import { en } from "../../src/telegram/messages/en";
import { fa } from "../../src/telegram/messages/fa";

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    userId: 1,
    seat: 0,
    hole: null,
    contribution: 10,
    streetContribution: 0,
    folded: false,
    allIn: false,
    shown: false,
    hasActed: false,
    ...overrides,
  };
}

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    chatId: -100,
    matchId: 7,
    handNo: 1,
    status: "active",
    street: "preflop",
    players: [],
    order: [],
    board: [],
    deck: [],
    pot: 20,
    currentBet: 0,
    lastRaiseIncrement: 10,
    actorUserId: 1,
    turnId: 3,
    runout: false,
    revealed: false,
    winners: [],
    deltas: {},
    ...overrides,
  };
}

describe("raiseOptions", () => {
  it("offers every legal bet as its own button", () => {
    const options = raiseOptions(makeState(), makePlayer(), en.labels);
    expect(options.map((option) => option.to)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(options.every((option) => option.kind === "bet")).toBe(true);
    expect(options[0]?.label).toBe("Bet 10");
    expect(options[8]?.label).toBe("Bet 90");
  });

  it("offers every legal raise from the minimum to the cap", () => {
    const state = makeState({ currentBet: 20, lastRaiseIncrement: 20 });
    const options = raiseOptions(state, makePlayer(), en.labels);
    expect(options.map((option) => option.to)).toEqual([40, 50, 60, 70, 80, 90]);
    expect(options.every((option) => option.kind === "raise")).toBe(true);
    expect(options[0]?.label).toBe("Raise 40");
    expect(options[5]?.label).toBe("Raise 90");
  });

  it("keeps a short all-in as its own button", () => {
    const state = makeState({ currentBet: 60, lastRaiseIncrement: 50 });
    const options = raiseOptions(state, makePlayer(), en.labels);
    expect(options).toEqual([{ label: "All-in — 90", kind: "allin", to: 90 }]);
  });

  it("localizes every amount button", () => {
    const options = raiseOptions(makeState(), makePlayer(), fa.labels);
    expect(options[0]?.label).toBe("شرط 10");
    expect(options[8]?.label).toBe("شرط 90");
  });
});

describe("raiseKeyboard", () => {
  it("wraps amount buttons into rows and keeps the callback amounts", () => {
    const options = raiseOptions(makeState(), makePlayer(), en.labels);
    const keyboard = raiseKeyboard({ matchId: 7, turnId: 3, options });
    expect(keyboard.inline_keyboard.map((row) => row.length)).toEqual([5, 4]);
    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data).toBe("m:7:3:bet:10");
    expect(keyboard.inline_keyboard[1]?.[3]?.callback_data).toBe("m:7:3:bet:90");
  });

  it("keeps a single row when there are few options", () => {
    const keyboard = raiseKeyboard({
      matchId: 7,
      turnId: 3,
      options: [{ label: "All-in — 90", kind: "allin", to: 90 }],
    });
    expect(keyboard.inline_keyboard).toEqual([
      [{ text: "All-in — 90", callback_data: "m:7:3:allin:90" }],
    ]);
  });
});
