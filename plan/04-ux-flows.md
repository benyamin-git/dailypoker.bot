# 04 — UX Flows

Everything below is the exact UX contract for v1. Message bodies are mockups; final strings
live in `src/telegram/messages.ts`. Parse mode: **HTML** (all user names escaped).

---

## 1. Command map

**Group chat**

| Command | Who | Effect |
|---|---|---|
| `/newmatch` | any eligible player | Opens a lobby (button alias `New match`) |
| `/join` | any eligible player | Joins the open lobby |
| `/leave` | joined player | Leaves lobby (before deal) |
| `/deal` | starter | Starts the hand (≥2 players) |
| `/cancel` | starter | Cancels the lobby |
| `/takeover` | remaining lobby player | Becomes starter after the original starter left |
| `/fold` `/check` `/call` `/allin` | current actor | Betting actions |
| `/raise N` | current actor | Raise street bet to `N` (multiple of 10, cap-aware) |
| `/show` | mucked loser | Voluntarily reveal on the result message |
| `/cards` | any player in a hand | Re-DM current hole cards |
| `/balance` `/top` | anyone | Public in group (by owner decision: `/top` public; `/balance` also public in group when used there) |
| `/rules` `/help` | anyone | Rule/help text |
| `/ping` | group members | Bot liveness check (also used by M0 acceptance) |

**DM**

| Command | Effect |
|---|---|
| `/start [payload]` | Onboarding; `start=join_<id>` auto-joins a pending lobby |
| `/daily` | Claim +200 (rolling 24 h) |
| `/balance` `/stats` `/history [n]` | Personal info replies |
| `/rules` `/help` | Rule/help text |

**Owner-only (DM)**

| Command | Effect |
|---|---|
| `/version` | Worker version + webhook info summary |
| `/resetgroup` | DM-only: shows the group and a reset button; after tapping it, typing `RESET` wipes the group's storage (destructive) |

Command visibility: all group command messages **stay in the chat** (owner decision U4).
The bot never deletes player messages; the delete admin right is only for bot-housekeeping.

## 2. Onboarding (deep-link join)

1. New player taps `Join` on the lobby message.
2. They haven't started the bot → the bot answers the callback privately:
   `You need to open my DM first so I can send your cards.` (alert).
3. The lobby message permanently shows a URL button
   `📬 Open bot` → `https://t.me/<bot>?start=join_<matchId>`.
4. Tapping it opens the bot DM with a START button; pressing Start sends
   `/start join_<matchId>`.
5. Bot: validates lobby is open, player eligible (balance ≥ 100), adds them, replies in DM:
   `You're in! I'll DM your cards when the hand starts.` and updates the group lobby.
6. Players who already onboarded just get joined directly on the `Join` tap.
7. DM onboarding is tracked per player (`players.dm_started`, set on the first `/start`);
   absence of the flag is what triggers the deep-link prompt in step 2.

DM welcome text (first `/start` without payload):

```
🃏 Welcome to Daily Poker!

I run poker games in your group chat. Your cards and stats arrive here in DM.

Get chips with /daily (once per day, +200).
/rules /help /stats /balance /history
```

## 3. Daily claim

`/daily` in DM:

- Success: `✅ +200 chips claimed. Balance: 1,240. Next claim in 24h.`
- Too early: `⏳ Already claimed. Next claim in 6h 12m.`
- Group teaser: `🎁 <name> claimed their daily chips.` (single line, no reply chain)

## 4. Lobby → Hand (play-by-play messages) → Result

### Lobby state (one edited, pinned message)

```
🃏 Daily Poker — Lobby
Entry 10 each · max 100 per hand · 2–9 players

Can deal: Ali
Joined (3): Ali, Reza, Sara
Ready to deal.

[ Join ] [ Leave ]
[ 🚀 Deal ] [ Cancel ]          ← validated server-side against the starter
[ 📬 Open bot ]                 ← deep link for onboarding
```

- `Join`/`Leave` are validated per user with private alerts.
- Live `Joined` list updates on every join/leave; no new lobby messages are posted.
- If the starter leaves before Deal, `[ Take over ]` is shown; the first tap makes that player
  the starter (Deal/Cancel move to them).
- On expiry (15 min no new join): `⌛ Lobby expired. Start a new match with /newmatch.`
- On Deal the lobby message is edited to `✅ Hand #7 started — updates below.` and unpinned.

### Hand messages (one new message per action)

Every action posts a fresh group message; older ones stay in the chat as the play-by-play. The
action is the bold headline, the table state follows, and the footer says who is next. Buttons
(Fold/Check/Call/Raise ▾/🂠 Cards) are attached to every message; the bot validates the actor
per callback (`It's Reza's turn` / `You're not in this match` / `That move is no longer
available`).

**Deal**

```
🚀 Hand #7 — Reza acts first

🃏 Hand #7 — Preflop · 💰 Pot 30 · cap 100

Still in
👤 Ali — in 10
👤 Reza — in 10
👤 Sara — in 10

⏭ Next: Reza — check · 60s to act
```

**Action headlines**

| Action | Headline |
|---|---|
| fold | `❌ Sara folds` |
| check | `✅ Ali checks` |
| call | `📞 Ali calls 40` |
| bet | `🔥 Ali bets 40` |
| raise | `🔥 Reza raises to 80` |
| all-in | `🚨 Sara is all-in — 100` |
| timeout | `⏰ Reza timed out — checked` / `— folded` |

**Body and footer**

```
🃏 Hand #7 — Flop · 💰 Pot 90 · cap 100

Board: A♠ K♦ 7♣ — —          ← board line omitted before the flop

Still in
👤 Ali — in 20
👤 Reza — in 60

Out
✖ Sara — in 10

⏭ Next: Ali — call 40 · 60s to act
```

- `in N` is the player's total committed this hand (entry included); the numbers sum to the pot.
- All-in players show `all-in 100`; folded players move under `Out` (section omitted when
  nobody folded); live hands appear next to names once revealed.
- The footer states the 60 s limit, not a live countdown: the timeout auto-action posts its own
  message.
- `Call` becomes `Check` when `to call = 0`. `Raise ▾` edits only the keyboard of the message
  it was pressed on into one button per legal amount — every multiple of 10 from the minimum
  raise to the all-in cap that hand, e.g. `[ Raise 60 ] [ Raise 70 ] [ Raise 80 ] [ Raise 90 ]`
  (a preflop bet menu shows `Bet 10` … `Bet 90`, laid out 5 per row). A short all-in that is
  not a full raise keeps its own `All-in — N` button. Picking an amount posts the new action
  message; `/raise <amount>` remains the typed fallback.
- `🂠 Cards` shows the player's hole cards in a **private alert** (also available via `/cards` DM).

### All-in runout

When every remaining player is all-in:
- a single animated `🎲` dice message is sent (if `EFFECTS_ENABLED`),
- the action message footer says `⏭ Next: running out the board…`,
- each street posts its own message (`🎲 Flop: A♠ K♦ 7♣`, `🎲 Turn: 4♥`, `🎲 River: 2♠`) with
  a ~2 s delay and **all live hands revealed** next to the player names.

### Result (separate message)

The final action message says `⏭ Hand over — result below`; the result is a fresh message
(not pinned):

```
🏆 Reza wins 210 (+120) — A♠ A♦
Board: A♠ K♦ 7♣ 4♥ 2♠

[ Show my hand ]   [ 🔁 Rematch ]
```

- `Show my hand` reveals a mucked loser's cards by editing the result message (private alert
  if not applicable).
- `Rematch` opens a new lobby with the same players pre-invited (they still must tap Join).
- `Effects`: `🎰` for pots ≥ 200 on top of the result (if enabled).

## 5. DM flows

**Hole cards at deal**

```
🂠 Your hand — Hand #7
A♠ K♥

Board and betting happen in the group.
```

**Turn reminder**: none (owner decision U5). Players follow the latest action message.

**`/cards`**: re-sends the above (private alert with the cards as a fallback for speed).

**`/balance`**

```
💰 Balance: 1,240 chips
🌅 Daily: ready now / next in 6h 12m
📈 Record: 18 hands · 7 wins · +310 chips
```

**`/stats`**

```
📊 Your stats (Family Poker)
Hands: 18 · Wins: 7 (39%)
Net: +310 · Biggest pot: 320
Best hand: Full house, Aces over Kings
```

**`/history [n]`** (default 5, max 20)

```
📜 Last hands
#7  🏆 you +90    A♠A♦ vs K♠K♥
#6  💔 you −40    board: Q♣J♦9♠
…
```

**`/top`** (public in group)

```
🏆 Leaderboard — Family Poker
1. Reza  2,410
2. Ali   1,980
3. Sara  1,240
```

## 6. Errors & edge UX

| Situation | Response |
|---|---|
| Non-actor presses a betting button | Private alert only; no group noise |
| Stale button (previous turn/state) | Private alert `That move is no longer available` |
| `/raise` above legal maximum | Alert `You can raise to at most 60` |
| `/raise` not a multiple of 10 | Alert `Amounts are multiples of 10` |
| Join attempt with balance < 100 | Alert `You need at least 100 chips to play. Claim with /daily.` |
| Join attempt on a full table | Alert `Table is full (9/9)` |
| `/deal` with < 2 players | Lobby message is edited to show the error; nothing is ever deleted (see §8) |
| Second `/newmatch` while lobby open | Alert `A match is already open` |
| Bot added to non-allowlisted group | Single polite reply (once per add), then silent; no processing |
| `/takeover` when not applicable | Private alert only (starter present or user not in lobby) |
| Unexpected internal error | Private alert `Something glitched. Try again.` + redacted log entry |

## 7. Formatting conventions

- Parse mode HTML; escape `<`, `>`, `&` in all user-controlled strings (names, usernames).
- Cards: `A♠ K♥ Q♦ J♣ 10♠` (rank + suit). Hidden card: `🂠`.
- Amounts: `1,240` with thousands separators + the word `chips` where space allows.
- Action headline is the first line, bold; the state block lines follow without `<pre>`; button
  labels stay short.
- Emoji vocabulary (fixed): 🃏 table, 👤 seated, 🚨 all-in, ✖ folded, 🏆 win, 💔 loss, 🎁 daily,
  🂠 cards, 🔁 rematch, 🚀 deal, 🎲/🎰 effects, ❌ fold, ✅ check, 📞 call, 🔥 bet/raise,
  ⏰ timeout, ⏭ next, 👁 show, 📬 DM link.
- No MarkdownV2; no external images or sticker files in v1.

## 8. UX defaults (veto anytime)

1. `/balance` used in the group replies publicly in the group; in DM it replies privately.
2. Result messages are not pinned. During a hand nothing is pinned: the lobby message is
   unpinned and edited to `✅ Hand #N started — updates below.` when the hand starts.
3. Rematch pre-invites previous players via a URL button but they must tap Join again.
4. Lobby expiry = 15 minutes without a new join.
5. Effects only on all-in runouts and pots ≥ 200; disabled entirely via `EFFECTS_ENABLED=false`.
6. No message is ever deleted in v1.
