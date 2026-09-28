declare module "pokersolver" {
  export interface SolvedHand {
    name: string;
    descr: string;
    rank: number;
    cards: string[];
  }
  export interface PokersolverHand {
    solve(cards: string[]): SolvedHand;
    winners(hands: SolvedHand[]): SolvedHand[];
  }
  const pokersolver: { Hand: PokersolverHand };
  export default pokersolver;
}
