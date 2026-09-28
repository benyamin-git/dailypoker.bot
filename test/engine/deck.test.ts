import { describe, expect, it } from "vitest";

import { cryptoRng, freshDeck, seededRng, shuffle } from "../../src/engine/deck";
import type { Card } from "../../src/engine/types";

describe("freshDeck", () => {
  it("contains 52 unique cards covering every rank and suit", () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    for (const suit of ["s", "h", "d", "c"]) {
      expect(deck.filter((card) => card.endsWith(suit))).toHaveLength(13);
    }
  });
});

describe("seededRng", () => {
  it("is deterministic for the same seed", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const sequenceA = Array.from({ length: 20 }, () => a());
    const sequenceB = Array.from({ length: 20 }, () => b());
    expect(sequenceA).toEqual(sequenceB);
  });

  it("differs across seeds", () => {
    const a = seededRng(1);
    const b = seededRng(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const rng = seededRng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("cryptoRng", () => {
  it("stays within [0, 1)", () => {
    const rng = cryptoRng();
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("shuffle", () => {
  it("keeps every card exactly once", () => {
    const deck = freshDeck();
    const shuffled = shuffle([...deck], seededRng(3));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled).size).toBe(52);
    expect([...shuffled].sort()).toEqual([...deck].sort());
  });

  it("is deterministic for the same seed", () => {
    const a = shuffle(freshDeck(), seededRng(9));
    const b = shuffle(freshDeck(), seededRng(9));
    expect(a).toEqual(b);
  });

  it("changes the order", () => {
    const deck = freshDeck();
    const shuffled = shuffle([...deck], seededRng(123));
    expect(shuffled).not.toEqual(deck satisfies Card[]);
  });
});
