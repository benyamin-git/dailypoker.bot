import type { Card } from "./types";

import { RANKS } from "./types";

const RANK_VALUE = new Map<string, number>(RANKS.map((rank, index) => [rank, index]));

const RANK_NAMES = [
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Jack",
  "Queen",
  "King",
  "Ace",
] as const;

export const HAND_CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export interface HandRank {
  score: number;
  category: number;
  name: string;
}

function rankValue(card: Card): number {
  return RANK_VALUE.get(card[0] as string) as number;
}

function rankName(value: number): string {
  return RANK_NAMES[value] as string;
}

function rankPlural(value: number): string {
  return `${rankName(value)}s`;
}

function pack(category: number, kickers: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) {
    score = score * 16 + (kickers[i] ?? 0);
  }
  return score;
}

function make(category: number, kickers: number[], name: string): HandRank {
  return { score: pack(category, kickers), category, name };
}

function straightHigh(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  for (let i = 0; i + 4 < unique.length; i++) {
    if ((unique[i] as number) - (unique[i + 4] as number) === 4) {
      return unique[i] as number;
    }
  }
  const has = (value: number) => unique.includes(value);
  if (has(12) && has(3) && has(2) && has(1) && has(0)) {
    return 3;
  }
  return null;
}

export function evaluate7(cards: Card[]): HandRank {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluate7 expects 5 to 7 cards, got ${cards.length}`);
  }

  const suitCounts = new Map<string, number[]>();
  const rankCounts = new Map<number, number>();
  for (const card of cards) {
    const rank = rankValue(card);
    const suit = card[1] as string;
    const list = suitCounts.get(suit);
    if (list) {
      list.push(rank);
    } else {
      suitCounts.set(suit, [rank]);
    }
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }

  const flushSuit = [...suitCounts.values()].find((values) => values.length >= 5);
  if (flushSuit) {
    const straightFlushHigh = straightHigh(flushSuit);
    if (straightFlushHigh !== null) {
      return make(
        HAND_CATEGORY.STRAIGHT_FLUSH,
        [straightFlushHigh],
        `Straight flush, ${rankName(straightFlushHigh)} high`,
      );
    }
  }

  const groups = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]) as [
    number,
    number,
  ][];
  const allRanks = groups.map(([rank]) => rank).sort((a, b) => b - a);

  const quad = groups.find(([, count]) => count === 4);
  if (quad) {
    const kicker = allRanks.find((rank) => rank !== quad[0]) as number;
    return make(
      HAND_CATEGORY.FOUR_OF_A_KIND,
      [quad[0], kicker],
      `Four of a kind, ${rankPlural(quad[0])}`,
    );
  }

  const trips = groups.filter(([, count]) => count >= 3).map(([rank]) => rank);
  if (trips.length >= 1) {
    const tripRank = trips[0] as number;
    const pairRank =
      trips[1] ?? groups.find(([rank, count]) => count >= 2 && rank !== tripRank)?.[0];
    if (pairRank !== undefined) {
      return make(
        HAND_CATEGORY.FULL_HOUSE,
        [tripRank, pairRank],
        `Full house, ${rankPlural(tripRank)} over ${rankPlural(pairRank)}`,
      );
    }
  }

  if (flushSuit) {
    const topFive = [...flushSuit].sort((a, b) => b - a).slice(0, 5);
    return make(HAND_CATEGORY.FLUSH, topFive, `Flush, ${rankName(topFive[0] as number)} high`);
  }

  const straight = straightHigh(allRanks);
  if (straight !== null) {
    return make(HAND_CATEGORY.STRAIGHT, [straight], `Straight, ${rankName(straight)} high`);
  }

  if (trips.length >= 1) {
    const tripRank = trips[0] as number;
    const kickers = allRanks.filter((rank) => rank !== tripRank).slice(0, 2);
    return make(
      HAND_CATEGORY.THREE_OF_A_KIND,
      [tripRank, ...kickers],
      `Three of a kind, ${rankPlural(tripRank)}`,
    );
  }

  const pairs = groups.filter(([, count]) => count === 2).map(([rank]) => rank);
  if (pairs.length >= 2) {
    const [highPair, lowPair] = pairs as [number, number];
    const kicker = allRanks.find((rank) => rank !== highPair && rank !== lowPair) as number;
    return make(
      HAND_CATEGORY.TWO_PAIR,
      [highPair, lowPair, kicker],
      `Two pair, ${rankPlural(highPair)} and ${rankPlural(lowPair)}`,
    );
  }
  if (pairs.length === 1) {
    const pairRank = pairs[0] as number;
    const kickers = allRanks.filter((rank) => rank !== pairRank).slice(0, 3);
    return make(HAND_CATEGORY.PAIR, [pairRank, ...kickers], `Pair of ${rankPlural(pairRank)}`);
  }

  const topFive = allRanks.slice(0, 5);
  return make(HAND_CATEGORY.HIGH_CARD, topFive, `High card, ${rankName(topFive[0] as number)}`);
}

export function compareHands(a: HandRank, b: HandRank): number {
  return a.score - b.score;
}
