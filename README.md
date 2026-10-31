# dailypoker.bot

dailypoker.bot is a private Telegram bot that runs No-Limit Texas Hold'em in a group chat. One
hand is played at a time; each action is posted as a group message and each control is an inline
button. Hole cards and personal stats are sent by DM. Chips are play money: there are no payments
and no chip transfers between players.

It runs as a single Bun process with a local SQLite database, connecting to Telegram's Bot API
directly over long polling. There is no player-facing web UI, no public webhook, and no inbound
port to open.

> Single-tenant by design. A deployment serves one allowlisted Telegram group with its own bot
> token. English is the default language; a group can switch to Persian with `/fa`.

The group chat is the table: results, banter and the leaderboard stay in the group, while hidden
information goes to DM. Keeping the game in the existing chat, at friend-group scale, is the
point — no player has to leave Telegram.

## What it looks like

Every action is a new group message: the action on top, the table state below it, and whose turn
is next on the last line.

```
Beny raises to 40

Hand #12 — Flop · Pot 210 · cap 100

Board: A♠ K♦ 7♣ — —

Still in
Ali — in 40
Beny — in 60
Mani — all-in 100 — Q♠ Q♦

Out
Rasa — in 10

Next: Ali — call 20 · 60s to act

[ Fold ] [ Call 20 ] [ Raise ▾ ] [ Cards ]
```

*This is an illustration of the message layout using the bot's own templates. It was not captured
from a live chat.*

## Ruleset

One hand is one match. A player opens a lobby with `/newmatch`, others join, and the starter
deals. Each group keeps its own balances and history.

| Rule | Value |
|---|---|
| Players | 2–9 |
| Entry | 10 chips each, posted at the deal (no blinds) |
| Cap | 100 chips contributed per player per hand, entry included |
| All-in | a player is all-in when their contribution reaches the cap |
| Minimum raise | matches the previous raise; bets and raises are multiples of 10 |
| Turn timer | 60 seconds; timeout checks when checking is free, otherwise folds |
| Split pots | divided evenly, with the remainder going to the earliest hand position |
| Join requirement | at least 100 chips |
| Daily chips | `/daily` in DM grants 200 chips with a 24-hour cooldown |

There are no side pots: every player has the same 100-chip effective stack, so a single pot is
always sufficient.

## Commands

Group:

| Command | Who | What |
|---|---|---|
| `/newmatch` | anyone | open a lobby |
| `/join`, `/leave` | anyone | enter or exit the lobby |
| `/deal`, `/cancel` | starter | start the hand or cancel the lobby |
| `/takeover` | anyone | become the starter |
| `/fold`, `/check`, `/call`, `/allin` | the player on turn | betting actions |
| `/raise <amount>` | the player on turn | raise; the amount is a multiple of 10 |
| `/show` | a player | reveal a mucked hand |
| `/cards` | anyone | re-send your hole cards by DM |
| `/balance` | anyone | your chip balance |
| `/top` | anyone | group leaderboard (top five with a positive balance) |
| `/rules`, `/help` | anyone | rules summary and command list |
| `/fa`, `/en` | anyone | switch the bot language |
| `/ping` | anyone | liveness check |

Private chat (DM):

| Command | What |
|---|---|
| `/start` | welcome and join links |
| `/daily` | claim 200 chips |
| `/balance`, `/stats`, `/history [n]` | balance, record, and last hands |
| `/cards` | re-send your hole cards |
| `/rules`, `/help` | rules and command list |
| `/fa`, `/en` | switch the bot language |

`/history` defaults to five hands and accepts up to 20. The language is a per-group setting
persisted in SQLite; `/fa` or `/en` from the group or DM switches every group message, button and
DM for that group's table.

Owner commands are DM-only: `/version` reports the bot version and polling status, and
`/resetgroup` replies with a button, then requires typing `RESET` to wipe the group's players,
balances and history.

## Self-hosting

Requirements: [Bun](https://bun.sh) 1.4+, a host that can reach `api.telegram.org`, and a bot token
from [@BotFather](https://t.me/BotFather). If Telegram is blocked on your network, route the bot
through a VPN or run it on a host outside the block; long polling needs a working outbound HTTPS
path.

### 1. Create the bot

In BotFather: `/newbot` to pick a name and username (for example `DailyPokerBot`) and save the
token. Disable privacy mode with `/setprivacy` → **Disable**, so the bot can read group commands.
Optionally set the description and user picture. Add the bot to the group and open a DM with it,
because hole cards are delivered there.

### 2. Configure and run

```bash
bun install
cp .env.example .env    # then fill in the token and ids
bun run start
```

The process deletes any existing webhook, installs the command menus, then long-polls Telegram.
Group ids are negative and start with `-100`; a helper bot such as `@userinfobot` reports both the
group id and your user id.

State lives in a local SQLite file (`DB_PATH`, default `data/dailypoker.db`). Back it up by copying
it while the bot is stopped. The bot needs no public URL and opens no inbound port.

Migrating from the old Cloudflare Worker: this version keeps its own SQLite state and does not read
Durable Object storage. On startup it deletes the Telegram webhook, so the old Worker stops
receiving updates; delete the old Workers in the Cloudflare dashboard when you no longer need them.

To keep the bot running after logout or reboot, install the user service:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/dailypoker.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now dailypoker.service
```

If the host does not keep a login session for your user, also run
`loginctl enable-linger "$USER"`. Check the logs with
`journalctl --user -u dailypoker.service -f`.

### 3. Play

1. Add the bot to the group. Chat ids must be in `ALLOWED_CHAT_IDS`; otherwise the bot replies
   once and stays silent.
2. `/newmatch` → everyone taps **Join** → the starter taps **Deal**.
3. Each action posts a fresh message; hole cards arrive in DM.
4. After the hand, the result message offers **Show** and **Rematch**.

### Configuration

Configuration is read from the environment; `.env` (gitignored) is loaded by Bun automatically.
See `.env.example` for a starting point.

| Name | Purpose |
|---|---|
| `BOT_TOKEN` | BotFather token |
| `BOT_USERNAME` | used in `t.me/<bot>` deep links |
| `ALLOWED_CHAT_IDS` | comma-separated group ids; exactly one is accepted |
| `OWNER_USER_ID` | numeric Telegram id for owner commands |
| `DB_PATH` | optional SQLite path (default `data/dailypoker.db`) |

## Development

```bash
bun install
bun run start        # long-poll Telegram and run the table
bun run dev          # same, restarting on file changes
bun run test         # vitest: engine, Telegram and table tests
bun run test:heavy   # TEST_HEAVY=1 oracle test against pokersolver
bun run typecheck    # tsc --noEmit
bun run lint         # biome check .
bun run format       # biome format --write .
```

Tests in `test/engine/`, `test/telegram/` and `test/table/` run in Node. `test/table/` boots the
real `Table` against an in-memory SQLite database with a mocked Telegram transport.
`test/types/` holds only the ambient `pokersolver` type declaration used by the oracle test.

User-facing strings live in `src/telegram/messages/`, one catalogue per language (`en.ts`,
`fa.ts`) behind a shared `Messages` interface. The engine in `src/engine/` imports nothing from
the rest of the codebase; a purity test enforces that, so it can be audited standalone.

Local configuration and secrets live in `.env` (gitignored; see `.env.example`).

## Architecture

```
Telegram ◀──getUpdates / Bot API──▶ bot process (src/index.ts)
                                     │ validate update, dedupe update_id
                                     ▼
                            Table (src/game/table.ts)
                              ├─ pure engine (src/engine/)
                              ├─ SQLite: players, matches, stats (src/game/store.ts)
                              ├─ 1 s deadline tick (turn, lobby, runout)
                              └─ throttled Telegram sender (src/telegram/)
```

All game state lives in SQLite, and one process owns the table.

## Security notes

- This is a play-money game: no payments, no chip transfers between players, no real-value
  settlement.
- Secrets are never committed; `.env` is gitignored and holds the bot token.
- The bot makes outbound long-poll requests only: no public webhook, no admin HTTP routes and no
  inbound port.
- User-facing strings are HTML-escaped, and callbacks validate actor, match, turn and action
  server-side. Updates are deduplicated by `update_id`.
- The SQLite file contains player names and balances; keep it readable only by the bot's user.
- Hand history is pruned to the newest 1,000 matches per group. The owner can wipe all group data
  from DM with `/resetgroup`.

## License

[MIT](LICENSE).
