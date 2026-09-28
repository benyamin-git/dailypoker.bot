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
| `/resetgroup <chat_id>` | Wipes a group's storage (destructive, confirmation required) |

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

## 4. Lobby → Table → Result (the one pinned message)

### Lobby state

```
🃏 Daily Poker — Lobby
Ante 10 · Cap 100 · 2–9 players

Starter: Ali
Joined (3): Ali, Reza, Sara
Waiting for more players…

[ Join ] [ Leave ]
[ 🚀 Deal ] [ Cancel ]          ← Deal/Cancel visible to the starter only
[ 📬 Open bot ]                 ← deep link for onboarding
```

- `Join`/`Leave` are validated per user with private alerts.
- Live `Joined` list updates on every join/leave.
- If the starter leaves before Deal, `[ Take over ]` is shown to the remaining players;
  the first tap makes that player the starter (Deal/Cancel move to them).
- On expiry (15 min no new join): `⌛ Lobby expired. Start a new match with /newmatch.`

### Table state (after Deal)

```
🃏 Daily Poker — Hand #7
Ante 10 · Pot 180 · Cap 100

🎯 Reza   room 60 · to call 60      ⏳ 52s
👤 Ali    room 60 · to call 60
👤 Sara   ALL-IN (100)

Board: A♠ K♦ 7♣ — —

[ Fold ] [ Call 60 ] [ Raise ▾ ] [ 🂠 Cards ]
```

- The **same message** is edited in place; it stays pinned.
- Buttons are the same for everyone (Telegram limitation). The bot validates the actor:
  non-actors get a private alert (`It's Reza's turn` / `You're not in this match`).
- `Call` becomes `Check` when `to call = 0`.
- `Raise ▾` opens a second keyboard level:
  `[ Min — to 60 ] [ +20 — to 80 ] [ All-in — 100 ] [ ✏️ Custom ]`
  - `Custom` alert: `Type /raise <amount> (multiples of 10).`
- `🂠 Cards` shows the player's hole cards in a **private alert** (also available via `/cards` DM).
- Timeout approaching: the ⏳ counter updates roughly every edit; no extra messages.
- Street change: board line fills in; action indicator resets.

### All-in runout

If every remaining player is at the cap:
- a single animated `🎲` dice message is sent (if `EFFECTS_ENABLED`),
- streets are dealt with a short delay (~2s between board lines, edits to the table message),
- **all live hands are revealed** on the table message as they are tabled.

### Result

Table message final state, plus a fresh short message (not pinned):

```
🏆 Reza wins 300 — A♠ A♦
Board: A♠ K♦ 7♣ 4♥ 2♠

[ Show my hand ]   [ 🔁 Rematch ]
```

- `Show my hand` visible to mucked losers; pressing it reveals their cards in the result
  message (private alert if not applicable).
- `Rematch` opens a new lobby with the same players pre-invited (they still must tap Join).
- `Effects`: `🎰` for pots ≥ 200 on top of the result (if enabled).

## 5. DM flows

**Hole cards at deal**

```
🂠 Your hand — Hand #7
A♠ K♥

Board and betting happen in the group.
```

**Turn reminder**: none (owner decision U5). Players watch the pinned table message.

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
- Table body uses `<pre>` for the board/status block to keep alignment; button labels stay short.
- Emoji vocabulary (fixed): 🃏 table, 🎯 current actor, 👤 seated, 🏆 win, 💔 loss, 🎁 daily,
  🂠 cards, 🔁 rematch, 🚀 deal, 📬 DM link, 🎲/🎰 effects.
- No MarkdownV2; no external images or sticker files in v1.

## 8. UX defaults (veto anytime)

1. `/balance` used in the group replies publicly in the group; in DM it replies privately.
2. Result messages are not pinned; only the table message is pinned.
3. Rematch pre-invites previous players via a URL button but they must tap Join again.
4. Lobby expiry = 15 minutes without a new join.
5. Effects only on all-in runouts and pots ≥ 200; disabled entirely via `EFFECTS_ENABLED=false`.
6. No message is ever deleted in v1.
