/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.test.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const TEST_NAME_PATTERN = /(?:it|test)\(\s*"([^"]+)"/g;

function collectTestNames(): Set<string> {
  const names = new Set<string>();
  for (const source of Object.values(SOURCES)) {
    for (const match of source.matchAll(TEST_NAME_PATTERN)) {
      names.add(match[1] as string);
    }
  }
  return names;
}

const TEST_NAMES = collectTestNames();

const CONFORMANCE: Record<string, string> = {
  "Balance exactly 100": "allows a player with exactly the minimum balance to join",
  "Action by a non-player / spectator": "alerts a non-player privately and changes nothing",
  "Action when not your turn": "alerts a non-actor privately and changes nothing",
  "Tap on stale buttons (previous turn)": "rejects stale turn ids with a private alert",
  "Double tap / duplicate callback": "processes a duplicate update_id exactly once",
  "Player joins lobby twice": "treats a second join as idempotent",
  "Starter leaves their own lobby": "hands the lobby over when the starter leaves",
  "/takeover by a non-member or while the starter is present":
    "rejects take over from a non-member",
  "Lobby reaches 9 players": "caps the lobby at nine players",
  "All players fold to one": "ends the hand immediately without revealing cards",
  "Split pot with dead money": "splits with the odd remainder to the earliest hand order",
  "Tie with all players all-in": "splits the pot when all-in players tie",
  "Daily claim during an active hand": "allows a daily claim during an active hand",
  "Bot kicked from group": "stops processing updates after the bot is removed",
  "10-minute silence in a live hand": "folds when facing a bet",
  "to call = 0 and check is legal": "only allows a check when there is nothing to call",
  "All-in when already at cap": "rejects an all-in when the player is already at the cap",
  "Raise command exceeding cap": "rejects a full raise that would exceed the cap",
  "Short all-in raised over, then called":
    "lands the shover and callers exactly at the cap and ends betting",
  "Short all-in, everyone folds": "lets a short shover take the pot when everyone folds",
  "Split pot remainder": "sends odd remainders to the earliest players in hand order",
  "Effects flag off": "sends no dice messages when effects are disabled",
};

const PENDING_M3 = new Set<string>([]);

describe("edge case conformance (03-game-rules §11)", () => {
  it("maps every edge case row to a named test", () => {
    const rows = Object.keys(CONFORMANCE);
    expect(rows).toHaveLength(22);
    for (const row of rows) {
      expect(CONFORMANCE[row], row).toBeTruthy();
    }
  });

  it("every mapped test exists unless explicitly pending for M2/M3", () => {
    const missing: string[] = [];
    for (const [row, testName] of Object.entries(CONFORMANCE)) {
      if (PENDING_M3.has(row)) {
        continue;
      }
      if (!TEST_NAMES.has(testName)) {
        missing.push(`${row} -> "${testName}"`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps the pending list honest: entries are real rows and their tests are coming", () => {
    for (const row of PENDING_M3) {
      expect(CONFORMANCE[row], `unknown pending row: ${row}`).toBeTruthy();
      expect(TEST_NAMES.has(CONFORMANCE[row] as string)).toBe(false);
    }
  });
});
