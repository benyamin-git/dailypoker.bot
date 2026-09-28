import { describe, expect, it } from "vitest";

import { potTotal, splitPot } from "../../src/engine/pots";

describe("potTotal", () => {
  it("sums contributions including dead money", () => {
    expect(potTotal([{ contribution: 50 }, { contribution: 10 }, { contribution: 100 }])).toBe(160);
  });
});

describe("splitPot", () => {
  it("gives the whole pot to a single winner", () => {
    const payouts = splitPot(310, [222], [111, 222, 333]);
    expect(payouts.get(222)).toBe(310);
    expect(payouts.size).toBe(1);
  });

  it("splits evenly between two winners", () => {
    const payouts = splitPot(300, [111, 222], [111, 222, 333]);
    expect(payouts.get(111)).toBe(150);
    expect(payouts.get(222)).toBe(150);
  });

  it("sends odd remainders to the earliest players in hand order", () => {
    const payouts = splitPot(100, [333, 111, 222], [111, 222, 333]);
    expect(payouts.get(111)).toBe(34);
    expect(payouts.get(222)).toBe(33);
    expect(payouts.get(333)).toBe(33);
  });

  it("handles a three-way tie with dead money exactly as the rules example", () => {
    const payouts = splitPot(100, [222, 333, 111], [111, 222, 333]);
    expect(payouts.get(111)).toBe(34);
    expect(payouts.get(222)).toBe(33);
    expect(payouts.get(333)).toBe(33);
  });

  it("returns nothing for an empty winner list", () => {
    expect(splitPot(100, [], [111]).size).toBe(0);
  });

  it("conserves chips", () => {
    const payouts = splitPot(97, [1, 2, 3], [3, 1, 2]);
    const total = [...payouts.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(97);
  });
});
