import pokersolver from "pokersolver";
import { describe, expect, it } from "vitest";

import { freshDeck, seededRng, shuffle } from "../../src/engine/deck";
import { evaluate7 } from "../../src/engine/evaluator";
import type { Card } from "../../src/engine/types";

const { Hand } = pokersolver;

const HEAVY = process.env.TEST_HEAVY === "1";
const RANDOM_CASES = HEAVY ? 1_000_000 : 20_000;

function score(cards: string[]): number {
  return evaluate7(cards as Card[]).score;
}

function name(cards: string[]): string {
  return evaluate7(cards as Card[]).name;
}

describe("evaluator hand-crafted comparisons", () => {
  it("ranks a straight flush above four of a kind", () => {
    const straightFlush = ["As", "Ks", "Qs", "Js", "Ts", "2d", "3c"];
    const quads = ["2h", "2s", "Qs", "Js", "2d", "2c", "9c"];
    expect(score(straightFlush)).toBeGreaterThan(score(quads));
    expect(name(straightFlush)).toBe("Straight flush, Ace high");
    expect(name(quads)).toBe("Four of a kind, Twos");
  });

  it("ranks four of a kind above a full house", () => {
    const quads = ["9h", "9s", "9d", "9c", "2h", "3d", "4c"];
    const fullHouse = ["Ah", "As", "Ad", "Kc", "Kh", "3d", "4c"];
    expect(score(quads)).toBeGreaterThan(score(fullHouse));
  });

  it("ranks a full house above a flush", () => {
    const fullHouse = ["Ah", "As", "Ad", "Kc", "Kh", "3d", "4c"];
    const flush = ["2h", "5h", "9h", "Jh", "Kh", "3d", "4c"];
    expect(score(fullHouse)).toBeGreaterThan(score(flush));
  });

  it("ranks a flush above a straight", () => {
    const flush = ["2h", "5h", "9h", "Jh", "Kh", "3d", "4c"];
    const straight = ["9s", "8d", "7c", "6h", "5s", "2d", "3c"];
    expect(score(flush)).toBeGreaterThan(score(straight));
  });

  it("describes a full house with both ranks", () => {
    expect(name(["As", "Ah", "Ad", "Kc", "Kh", "2s", "3d"])).toBe("Full house, Aces over Kings");
  });

  it("names the wheel as a five-high straight", () => {
    expect(name(["Ah", "2d", "3c", "4s", "5h", "Kd", "9c"])).toBe("Straight, Five high");
    expect(score(["Ah", "2d", "3c", "4s", "5h", "Kd", "9c"])).toBeLessThan(
      score(["2h", "3d", "4c", "5s", "6h", "Kd", "9c"]),
    );
  });

  it("recognizes the steel wheel as a five-high straight flush", () => {
    expect(name(["Ah", "2h", "3h", "4h", "5h", "Kd", "9c"])).toBe("Straight flush, Five high");
  });

  it("counts the wheel as five-high, not ace-high", () => {
    const wheel = ["Ah", "2d", "3c", "4s", "5h", "Kd", "9c"];
    const sixHigh = ["2s", "3d", "4c", "5s", "6h", "Kd", "9c"];
    expect(score(wheel)).toBeLessThan(score(sixHigh));
  });

  it("plays the board for a counterfeited two pair", () => {
    const first = ["Jc", "Tc", "As", "Ad", "Kc", "Kh", "7d"];
    const second = ["Js", "Ts", "As", "Ad", "Kc", "Kh", "7d"];
    expect(score(first)).toBe(score(second));
    expect(name(first)).toBe("Two pair, Aces and Kings");
  });

  it("breaks kicker wars on the fifth card", () => {
    const better = ["As", "Qd", "Ah", "Kd", "7c", "4s", "2h"];
    const worse = ["Ac", "Js", "Ah", "Kd", "7c", "4s", "2h"];
    expect(score(better)).toBeGreaterThan(score(worse));
  });

  it("uses the best kicker with quads", () => {
    const better = ["As", "3d", "9s", "9h", "9d", "9c", "2h"];
    const worse = ["Ks", "Qd", "9s", "9h", "9d", "9c", "2h"];
    expect(score(better)).toBeGreaterThan(score(worse));
  });

  it("breaks kicker wars on the fifth card with two pair", () => {
    const better = ["Qh", "3d", "Ah", "Ad", "Ks", "Kd", "2c"];
    const worse = ["Jh", "4d", "Ah", "Ad", "Ks", "Kd", "2c"];
    expect(score(better)).toBeGreaterThan(score(worse));
  });

  it("evaluates a five-card hand", () => {
    expect(name(["As", "Ks", "Qs", "Js", "Ts"])).toBe("Straight flush, Ace high");
  });

  it("scores higher categories above lower", () => {
    const ladder = [
      ["As", "Ks", "Qh", "Jd", "9c", "7s", "3d"],
      ["As", "Ad", "Qh", "Jd", "9c", "7s", "3d"],
      ["As", "Ad", "Kh", "Kd", "9c", "7s", "3d"],
      ["As", "Ad", "Ah", "Kd", "9c", "7s", "3d"],
      ["Ah", "Kd", "Qc", "Js", "Th", "7s", "3d"],
      ["Ah", "9h", "7h", "4h", "2h", "Ks", "3d"],
      ["As", "Ad", "Ah", "Kd", "Kh", "7s", "3d"],
      ["As", "Ad", "Ah", "Ac", "Kh", "7s", "3d"],
      ["Ah", "Kh", "Qh", "Jh", "Th", "7s", "3d"],
    ].map(score);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i] as number).toBeGreaterThan(ladder[i - 1] as number);
    }
  });
});

describe("evaluator randomized conformance against pokersolver", () => {
  it(
    `matches the oracle on ${RANDOM_CASES.toLocaleString("en-US")} random comparisons`,
    () => {
      const rng = seededRng(20260928);
      let mismatches = 0;
      const details: string[] = [];
      for (let i = 0; i < RANDOM_CASES; i++) {
        const deckA = shuffle(freshDeck(), rng).slice(0, 7);
        const deckB = shuffle(freshDeck(), rng).slice(0, 7);
        const ours = evaluate7(deckA).score - evaluate7(deckB).score;
        const solvedA = Hand.solve(deckA);
        const solvedB = Hand.solve(deckB);
        const winners = Hand.winners([solvedA, solvedB]);
        let oracle: number;
        if (winners.length === 2) {
          oracle = 0;
        } else {
          oracle = winners[0] === solvedA ? 1 : -1;
        }
        const sign = Math.sign(ours);
        if (sign !== oracle) {
          mismatches++;
          if (details.length < 5) {
            details.push(
              `${deckA.join(" ")} (${name(deckA)}) vs ${deckB.join(" ")} (${name(deckB)}): ours=${sign} oracle=${oracle}`,
            );
          }
        }
      }
      expect({ mismatches, details }).toEqual({ mismatches: 0, details: [] });
    },
    HEAVY ? 600_000 : 30_000,
  );
});
