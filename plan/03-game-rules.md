# 03 — Game Rules (normative)

This is the exact ruleset for `dailypoker.bot` v1. Where behavior is ambiguous, this document
is the authority; the engine tests must encode every clause here.

---

## 1. Terms

- **Balance** — per-group play chips owned by a player.
- **Match** — one poker hand; the complete game loop.
- **Ante (preblind)** — 10 chips paid by every player at deal.
- **Contribution** — total chips a player has put in this match (ante included).
- **Cap** — 100 chips total contribution per player per match. Reaching the cap = all-in.
- **Room** — `100 − contribution`; the maximum additional chips a player may put in.
- **Hand order** — the shuffled acting order for this match (redrawn every match).

## 2. Economy

- Players claim **+200 chips** via `/daily` in DM. Cooldown: **rolling 24 hours** from last
  claim. Claims stack with the current balance. Bankroll is per group.
- A small teaser line is posted in the group when a claim happens.
- Balance only changes by: daily claims, losing contributions, winning pots.
- **Eligibility:** a player may open a lobby or join a match only if `balance ≥ 100`.
  (Guarantees the cap is coverable; prevents negative balances.)

## 3. Match lifecycle

1. **Open lobby** — any eligible player runs `/newmatch` (or taps `New match`). The bot posts
   the lobby message (pinned). Only one lobby/match may exist per group at a time.
2. **Join / leave** — eligible players tap `Join` (`/join`) or `Leave` (`/leave`) while the
   lobby is open. 2–9 players.
3. **Lobby expiry** — if no new join occurs for 15 minutes, the lobby expires and the message
   updates to "Lobby expired".
4. **Deal** — the starter taps `Deal` (`/deal`) once at least 2 players have joined. All
   balances are re-checked (`≥ 100`); if a player fails, the deal is blocked with a message
   naming them.
5. **Antes** — at deal, 10 chips are deducted from every player (escrow) and paid into the
   pot. The hand then proceeds automatically.
6. **Cancel** — the starter may cancel before the deal.

## 4. Dealing

- One standard 52-card deck. Shuffle: Fisher–Yates using a CSPRNG
  (`crypto.getRandomValues`). No deck hash is published (owner decision G10).
- **Hand order is re-randomized every match** (shuffle the seating order at deal). It defines
  acting order for the whole hand. There are no blinds and no button.
- Each player receives 2 hole cards (delivered by DM). Five community cards are dealt on the
  board as the streets progress.

## 5. Betting

Streets: **preflop → flop → turn → river → showdown**.

- **Preflop first actor**: top of the hand order (check or bet).
- **Postflop first actor**: first remaining (non-folded) player in hand order.
- **Action options**: Fold, Check (when `to call = 0`), Call, Bet/Raise, All-in.
- **Bet/raise amounts**: multiples of 10 only.
- **Initial bet**: minimum 10.
- **Minimum raise**: the raise must increase the current street bet by **at least the
  previous raise increment**. Initial increment is 10.
  Example: bet 20 → min raise to 40; raise to 40 (increment 20) → min re-raise to 60.
- **Cap**: contribution may never exceed 100 (ante included). Moving to exactly 100 is
  **all-in** ("all-in" here means *cap reached*, not *bankrupt* — a player with 1,000 chips
  who commits 100 is all-in for the match). A player whose room cannot cover a full minimum
  raise may still call, and may also move all-in if that exceeds the call amount; the
  resulting raise is smaller than the minimum — a **short all-in raise** — and it is legal.
- **A short all-in that is called ends all betting.** The shover lands exactly at the cap
  (100), and any caller matching the street total lands at the cap too. Since no active
  player ever has more room than another at a decision point, the standard poker clause "an
  incomplete raise does not reopen betting" can **never bind in this format** — nobody is
  left with room to re-raise anyway. The engine needs no "betting reopened" state; legal
  actions derive purely from the current bet and remaining room. (Proof: §8; example: §10.)
- **No side pots exist.** All players have identical effective stacks (cap 100, join
  requirement ≥100), so every player can always match any legal bet in full. Folded
  contributions become dead money in the single pot. (See §8 proof.)
- **Uncalled bet**: the pot (which includes the winner's own last bet) is awarded to the
  winner, producing the same net result as refunding an uncalled bet.

## 6. Streets

- A street ends when all remaining players have acted and all bets are matched (or only one
  player remains).
- If all players but one fold at any point, the hand ends immediately; the winner takes the
  pot **without revealing cards**.
- If every remaining player is all-in (or all-in for the cap), remaining streets are dealt
  with no betting; **all live hands are revealed** at showdown (standard all-in runout).
- River completes → showdown.

## 7. Showdown & results

- **Winner shows** their hand (posted in the group). Other live players are auto-mucked, but
  each gets a `Show my hand` button on the result message to voluntarily reveal.
- **Split pots**: divide evenly; if chips remain (only possible via dead money), leftover
  chips go one each to the tied players in **hand order** (earliest first).
  Example: pot 100 (dead money from a folder), three-way tie → 34/33/33.
- Result message (fresh, short): winner, pot, winning cards, board; buttons `Show my hand`
  (losers) and `Rematch`.
- The table message is updated to its final state.
- Stats + history are persisted at hand end (see `06-data-model.md`).

## 8. Invariants: no side pots; called all-ins end betting (proofs)

**No side pots.**

1. Every participant has `balance ≥ 100` at deal (checked at join and re-checked at deal).
2. Every participant's contribution is capped at exactly 100 (uniform cap).
3. Therefore every participant's maximum possible contribution is identical.
4. A side pot would require some player's maximum contribution to be lower than another's —
   impossible under (2)+(3).
5. Folded contributions are dead money in the single main pot.

**A called all-in ends all betting.**

6. At the start of every street, all active players have equal contributions: a street ends
   only when every active player has matched the highest street total (or is all-in at the
   cap — see 7), and antes are uniform.
7. A player moving all-in lands at exactly 100. A caller matching the shover's street total
   `X` reaches the same contribution (`street_start_contribution + X`) — i.e. exactly 100.
8. Hence after a called all-in every remaining player is at the cap with zero room, no raise
   is possible, and the standard "an incomplete raise does not reopen betting" clause can
   never bind.

   ∎

Consequence: the pot is always a single integer; the engine's pot module needs only
dead-money accounting and split arithmetic; and the engine needs **no "betting reopened"
state** — legal actions derive purely from the current bet and remaining room.

## 9. Turns & timers

- Every action has a **60-second** deadline.
- On timeout: auto-**check** if legal, otherwise auto-**fold**.
- The timer resets after every accepted action (including the first action of each street).
- Players who disconnect are handled by the timer; no pause mechanism in v1.

## 10. Worked example

Players A, B, C, D (all balance ≥ 100). Hand order drawn: D, A, C, B.

- **Deal/ante**: each pays 10 → pot 40; contributions all 10.
- **Preflop**: D bets 20 (contrib 30). A calls (30). C raises to 40 — legal: previous
  increment 20 → min raise to 40 (contrib 50). B folds (contrib 10, dead money). D calls
  +20 (50). A calls +20 (50). Pot = 40 + 40 + 40 + 40 + 10 = 170.
- **Flop** (order D, A, C): D checks. A bets 30 (contrib 80). C calls (80). D calls (80).
  Pot = 170 + 90 = 260.
- **Turn**: D checks. A bets 20 (contrib 100, **all-in**). C calls (100). D calls (100).
  All three at cap. Pot = 260 + 60 = 320.
- **River**: no betting possible; dealt automatically; **all three hands revealed**.
- **Showdown**: best hand wins 320. B's 10 chips stayed in the pot as dead money.

### Short all-in example (3 players, cap 100, ante 10)

Hand order: A, B, C. **Preflop**: A bets 20 (30). B raises to 40 (50). C calls (50). A calls
+20 (50). Pot 150.

**Flop**: A checks. B bets 30 (80, room 20). C calls (80, room 20). A's turn: to call is 30
(room 50); a legal full raise would need street total 60 → contribution 110 > cap —
impossible. A moves all-in to street total 50 (contribution 100): a raise of 20 over the bet,
less than the 30 minimum → **short all-in**. B and C each add 20 and land at exactly 100.

Everyone is now at the cap; betting is over. Turn and river are dealt with no action, all
three hands are revealed, and the best hand takes pot 300. Note that B and C never had room
to re-raise after A's incomplete raise — a direct consequence of the uniform cap (§8).

## 11. Edge cases (must be covered by tests)

| Case | Rule |
|---|---|
| Balance exactly 100 | Allowed to join; after losing all-in, balance 0 |
| Action by a non-player / spectator | Private alert "You're not in this match" |
| Action when not your turn | Private alert "It's <name>'s turn" |
| Tap on stale buttons (previous turn) | Private alert "That move is no longer available" |
| Double tap / duplicate callback | First processed; second gets stale alert |
| Player joins lobby twice | Idempotent (already joined) |
| Starter leaves their own lobby | Allowed; lobby stays open, `Deal` blocked until a new starter exists → lobby expires or is canceled by any remaining player? (v1: remaining players may `Leave`; a new `/newmatch` replaces the expired lobby only) |
| Lobby reaches 9 players | Further joins rejected privately ("Table full") |
| All players fold to one | Hand ends, no reveals |
| Split pot with dead money | Integer split; remainder to earliest hand order |
| Tie with all players all-in | Same split logic |
| Daily claim during an active hand | Allowed; does not affect the hand's cap |
| Bot kicked from group | `my_chat_member` → stop processing that group |
| 10-minute silence in a live hand | Impossible; the 60s timer guarantees progress |
| `to call = 0` and check is legal | `Check` button replaces `Call` |
| `All-in` when already at cap | Rejected (cannot happen through UI) |
| Raise command exceeding cap | Private alert with the legal maximum ("You can raise to at most 60") |
| Short all-in raised over, then called | Legal; shover + all callers reach exactly 100; betting ends; runout reveals all live hands |
| Short all-in, everyone folds | Shover wins the pot; their unmatched excess is returned via pot award |
| Split pot remainder | See §7 |
| Effects flag off | No dice messages (config `EFFECTS_ENABLED`) |

## 12. Configurable constants (src/config.ts)

| Constant | Value |
|---|---|
| `ANTE` | 10 |
| `CAP` | 100 |
| `MIN_JOIN_BALANCE` | 100 |
| `DAILY_AMOUNT` | 200 |
| `DAILY_COOLDOWN_MS` | 24 h |
| `MIN_BET_STEP` | 10 |
| `BET_MULTIPLE` | 10 |
| `TURN_SECONDS` | 60 |
| `MAX_PLAYERS` | 9 |
| `MIN_PLAYERS` | 2 |
| `LOBBY_TTL_MS` | 15 min |
| `HISTORY_LIMIT` | 1,000 hands |
| `CURRENCY_NAME` | "chips" |
