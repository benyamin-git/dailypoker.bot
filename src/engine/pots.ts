export function potTotal(players: { contribution: number }[]): number {
  let total = 0;
  for (const player of players) {
    total += player.contribution;
  }
  return total;
}

export function splitPot(pot: number, winners: number[], order: number[]): Map<number, number> {
  const payouts = new Map<number, number>();
  if (winners.length === 0 || pot <= 0) {
    return payouts;
  }
  const sorted = [...winners].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const base = Math.floor(pot / sorted.length);
  let remainder = pot % sorted.length;
  for (const userId of sorted) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    payouts.set(userId, base + extra);
  }
  return payouts;
}
